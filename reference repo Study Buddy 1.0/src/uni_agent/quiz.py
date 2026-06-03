from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from .browser import AgentBrowser
from .locks import moodle_write_lock
from .preflight import validate_quiz_activity_url
from .quiz_state import (
    click_finish_attempt_to_summary,
    click_next_page,
    click_start_or_continue_attempt,
    detect_quiz_page_state,
    verify_questions_persisted,
)
from .safety import find_submit_risks, should_use_review_only
from .storage import create_output_run_dir, read_json, utc_now, write_json
from .subagents import generate_answer_specs_parallel


QUESTION_EXTRACTION_JS = r"""
(() => {
  const normalize = value => (value || "").replace(/\s+/g, " ").trim();
  const mathText = node => {
    if (!node) return "";
    const bits = [];
    for (const math of node.querySelectorAll("mjx-container, math, .MathJax, .MathJax_Display")) {
      bits.push(math.getAttribute("aria-label") || math.getAttribute("data-semantic-speech") || math.innerText || math.textContent || "");
    }
    return normalize(bits.join(" "));
  };
  const optionLetter = text => {
    const match = normalize(text).match(/^([a-z])\s*[.)]/i);
    return match ? match[1].toLowerCase() : null;
  };
  const questionNodes = [...document.querySelectorAll(".que, [id^='question-']")];
  const questions = questionNodes.map((node, index) => {
    const promptNode = node.querySelector(".qtext") || node;
    const visibleText = (node.innerText || "").trim();
    const numberMatch = visibleText.match(/(?:Frage|Question)\s+(\d+)/i);
    const questionNumber = numberMatch ? Number(numberMatch[1]) : index + 1;
    const options = [...node.querySelectorAll("label, .answer div, .answer span, option")]
      .map(el => (el.innerText || "").trim())
      .filter(Boolean);
    const controls = [...node.querySelectorAll("input, textarea, select")]
      .filter(el => !["hidden", "submit", "button"].includes((el.type || "").toLowerCase()))
      .map(el => {
        const labels = [...(el.labels || [])].map(label => label.innerText.trim()).filter(Boolean);
        const optionContainer = el.closest("label, .r0, .r1, .answer div, p, li");
        const optionText = labels[0] || (optionContainer ? optionContainer.innerText.trim() : "");
        const optionHtml = optionContainer ? optionContainer.innerHTML : "";
        const optionMath = mathText(optionContainer || el);
        return {
          tag: el.tagName.toLowerCase(),
          type: (el.type || el.tagName).toLowerCase(),
          id: el.id || null,
          control_id: el.id || null,
          name: el.name || null,
          value: el.value || "",
          checked: Boolean(el.checked),
          disabled: Boolean(el.disabled),
          option_text: optionText,
          letter: optionLetter(optionText),
          latex: optionMath,
          raw_html: optionHtml
        };
      });
    const optionObjects = controls
      .filter(control => ["radio", "checkbox"].includes(control.type) || control.tag === "option")
      .map(control => ({
        control_id: control.control_id,
        letter: control.letter,
        text: control.option_text,
        latex: control.latex,
        raw_html: control.raw_html,
        checked: control.checked,
        disabled: control.disabled
      }));
    const hasMath = Boolean(mathText(node));
    const optionTextComplete = optionObjects.every(option => {
      const text = normalize(option.text);
      return !/^[a-z]\s*[.)]?$/i.test(text) || Boolean(option.latex);
    });
    return {
      question_id: node.id || `question-${index + 1}`,
      question_index: questionNumber,
      page_question_index: index + 1,
      question_type: [...node.classList].find(c => c !== "que") || "unknown",
      prompt: (promptNode.innerText || "").trim(),
      prompt_text: (promptNode.innerText || "").trim(),
      prompt_latex: mathText(promptNode),
      prompt_html: promptNode.innerHTML || "",
      options: [...new Set(options)].slice(0, 20),
      option_objects: optionObjects,
      controls,
      visible_context: visibleText,
      extraction_quality: {
        has_math: hasMath,
        math_text_complete: !hasMath || Boolean(mathText(node)),
        option_text_complete: optionTextComplete
      }
    };
  });
  return JSON.stringify({
    title: document.title,
    url: location.href,
    body_text: document.body.innerText,
    questions
  });
})()
"""


START_ATTEMPT_JS = r"""
(() => {
  const labels = [
    "test versuchen",
    "attempt quiz",
    "attempt quiz now",
    "versuch beginnen",
    "versuch fortsetzen",
    "continue attempt",
    "start attempt"
  ];
  const buttons = [...document.querySelectorAll("button, input[type='submit'], a.btn, a[role='button']")];
  for (const button of buttons) {
    const text = (button.innerText || button.value || button.getAttribute("aria-label") || "").trim().toLowerCase();
    if (labels.some(label => text.includes(label))) {
      button.click();
      return JSON.stringify({ clicked: true, text });
    }
  }
  return JSON.stringify({ clicked: false });
})()
"""


NEXT_PAGE_JS = r"""
(() => {
  const deny = [
    "submit all and finish",
    "finish attempt",
    "versuch abschließen",
    "versuch abschliessen",
    "abgeben",
    "endgültig absenden",
    "endgueltig absenden"
  ];
  const allow = [
    "nächste seite",
    "naechste seite",
    "next page",
    "weiter"
  ];
  const controls = [...document.querySelectorAll("button, input[type='submit'], a.btn, a[role='button']")];
  for (const control of controls) {
    const text = (control.innerText || control.value || control.getAttribute("aria-label") || "").trim().toLowerCase();
    if (deny.some(term => text.includes(term))) continue;
    if (allow.some(term => text.includes(term))) {
      control.click();
      return JSON.stringify({ clicked: true, text });
    }
  }
  return JSON.stringify({ clicked: false });
})()
"""


def assist_quiz(url: str) -> Path:
    browser = AgentBrowser()
    browser.open(url)
    browser.wait_load()
    page = browser.eval_json(QUESTION_EXTRACTION_JS)

    review_only, risk_flags = should_use_review_only(page.get("body_text", ""))
    submit_risks = find_submit_risks(page.get("body_text", ""))
    if submit_risks:
        risk_flags.extend([f"submit-control-visible:{risk}" for risk in submit_risks])

    run_dir = create_output_run_dir("quiz-review", page.get("title") or "quiz")

    write_json(
        run_dir / "questions.json",
        {
            "captured_at": utc_now(),
            "url": page.get("url", url),
            "title": page.get("title"),
            "review_only": review_only,
            "risk_flags": sorted(set(risk_flags)),
            "questions": page.get("questions", []),
        },
    )

    review_lines = [
        f"# Quiz Review: {page.get('title') or 'Untitled'}",
        "",
        f"- Captured: {utc_now()}",
        f"- URL: {page.get('url', url)}",
        f"- Mode: {'review-only' if review_only else 'guarded-fill-eligible'}",
    ]
    if risk_flags:
        review_lines.extend(["", "## Risk Flags", ""])
        review_lines.extend(f"- {flag}" for flag in sorted(set(risk_flags)))
    review_lines.extend(["", "## Questions", ""])
    for question in page.get("questions", []):
        review_lines.append(f"### {question.get('question_id')}")
        review_lines.append("")
        review_lines.append(question.get("prompt") or "No prompt extracted.")
        options = question.get("options") or []
        if options:
            review_lines.append("")
            review_lines.extend(f"- {option}" for option in options)
        review_lines.append("")
        review_lines.append("Sources:")
        review_lines.append("- Not sufficiently sourced. Do not use as final answer.")
        review_lines.append("")

    (run_dir / "review.md").write_text("\n".join(review_lines), encoding="utf-8")
    browser.screenshot(run_dir / "page.png")
    return run_dir


def verify_quiz(url: str) -> Path:
    browser = AgentBrowser(mode="read")
    browser.open(url)
    browser.wait_load()
    verification = _verify_summary_or_visible_page(browser)
    run_dir = create_output_run_dir("quiz-verify", browser.get_title() or "quiz")
    write_json(run_dir / "summary-verification.json", verification)
    lines = [
        f"# Quiz Verification: {browser.get_title() or 'Untitled'}",
        "",
        f"- Captured: {utc_now()}",
        f"- URL: {browser.get_url()}",
        "",
        "Final submit was not clicked.",
    ]
    (run_dir / "verify-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    browser.screenshot(run_dir / "page.png")
    return run_dir


def fill_quiz(
    url: str,
    answers_path: Path | None,
    *,
    max_pages: int = 100,
    start_attempt: bool = True,
    bypass_review_only: bool = False,
    auto_answer: bool = False,
) -> Path:
    with moodle_write_lock():
        return _fill_quiz_impl(
            url,
            answers_path,
            max_pages=max_pages,
            start_attempt=start_attempt,
            bypass_review_only=bypass_review_only,
            auto_answer=auto_answer,
        )


def _fill_quiz_impl(
    url: str,
    answers_path: Path | None,
    *,
    max_pages: int = 100,
    start_attempt: bool = True,
    bypass_review_only: bool = False,
    auto_answer: bool = False,
) -> Path:
    answers = _load_answer_specs(answers_path) if answers_path else []
    if not answers and not auto_answer:
        raise RuntimeError("fill_quiz requires answers_path unless auto_answer=True.")
    browser = AgentBrowser()
    validation = None
    if "/mod/quiz/view.php" in url:
        validation = validate_quiz_activity_url({"url": url, "cmid": _cmid_from_url(url)}, browser=browser)
        if not validation.get("ok"):
            run_dir = create_output_run_dir("quiz-fill", "stale-url")
            write_json(run_dir / "preflight.json", validation)
            return _write_fill_report(
                page={"title": "stale_url", "url": url, "questions": []},
                url=url,
                fill_results=[],
                review_only=True,
                risk_flags=["stale_url"],
                message="Refused to fill because live Moodle validation failed for the quiz URL.",
                stop_reason="stale_url",
                run_dir=run_dir,
            )
    browser.open(url)
    browser.wait_load()

    page = browser.eval_json(QUESTION_EXTRACTION_JS)
    if start_attempt and not page.get("questions"):
        review_only, risk_flags = should_use_review_only(page.get("body_text", ""))
        if review_only and not bypass_review_only:
            return _write_fill_report(
                page=page,
                url=url,
                fill_results=[],
                review_only=True,
                risk_flags=risk_flags,
                message="Refused to start attempt because the quiz is not classified as safe practice/example content.",
            )
        if review_only and bypass_review_only:
            risk_flags.append("review-only-override-enabled")
        started = click_start_or_continue_attempt(browser)
        if started.get("clicked"):
            browser.wait_load()
            modal_started = click_start_or_continue_attempt(browser)
            if modal_started.get("clicked"):
                browser.wait_load()
        page = browser.eval_json(QUESTION_EXTRACTION_JS)

    first_page_url = _first_attempt_page_url(browser.get_url())
    if first_page_url:
        browser.open(first_page_url)
        browser.wait_load()

    initial_page = browser.eval_json(QUESTION_EXTRACTION_JS)
    run_dir = create_output_run_dir("quiz-fill", initial_page.get("title") or "quiz")
    if validation:
        write_json(run_dir / "preflight.json", validation)

    all_results: list[dict[str, Any]] = []
    page_results: list[dict[str, Any]] = []
    final_risk_flags: list[str] = []
    review_only = False
    if bypass_review_only:
        final_risk_flags.append("review-only-override-enabled")

    subagent_packet_root: Path | None = None
    stop_reason = "max-pages-reached"
    for page_number in range(1, max_pages + 1):
        page = browser.eval_json(QUESTION_EXTRACTION_JS)
        page_state = detect_quiz_page_state(browser)
        review_only, risk_flags = should_use_review_only(page.get("body_text", ""))
        submit_risks = find_submit_risks(page.get("body_text", ""))
        final_risk_flags.extend(risk_flags)
        final_risk_flags.extend([f"submit-control-visible:{risk}" for risk in submit_risks])

        if review_only and not bypass_review_only:
            stop_reason = "review-only"
            break
        if bypass_review_only:
            review_only = False

        if auto_answer and subagent_packet_root is None:
            subagent_packet_root = run_dir / "subagent-packets"

        page_answers = (
            generate_answer_specs_parallel(
                page.get("questions", []),
                page=page,
                browser=browser,
                packet_root=subagent_packet_root,
                page_number=page_number,
            )
            if auto_answer
            else answers
        )
        fill_results = _fill_visible_questions(browser, page.get("questions", []), page_answers)
        for result in fill_results:
            result["page_number"] = page_number
            if auto_answer:
                result["auto_answer"] = True
        all_results.extend(fill_results)

        if page_number >= max_pages:
            stop_reason = "max-pages-reached"
            break
        next_result = click_next_page(browser)
        navigation_action = "next_page"
        if not next_result.get("clicked"):
            next_result = click_finish_attempt_to_summary(browser)
            navigation_action = "finish_attempt_to_summary"
        all_results.append({"action": navigation_action, **next_result, "page_number": page_number})
        page_results.append(
            {
                "page_number": page_number,
                "state": page_state,
                "fill_results": fill_results,
                "navigation": {"action": navigation_action, **next_result},
            }
        )
        if not next_result.get("clicked"):
            stop_reason = "no-safe-next-page"
            break
        browser.wait_load()
        if navigation_action == "finish_attempt_to_summary":
            stop_reason = "summary-reached"
            break

    final_page = browser.eval_json(QUESTION_EXTRACTION_JS)
    summary_verification = _verify_summary_or_visible_page(browser)
    write_json(run_dir / "attempt-state.json", detect_quiz_page_state(browser))
    write_json(run_dir / "page-results.json", page_results)
    write_json(run_dir / "summary-verification.json", summary_verification)
    return _write_fill_report(
        page=final_page,
        url=url,
        fill_results=all_results,
        review_only=review_only,
        risk_flags=sorted(set(final_risk_flags)),
        message=(
            "Subagent-generated and filled eligible visible answers after review-only override; stopped before final submission."
            if auto_answer and bypass_review_only
            else "Subagent-generated and filled eligible visible answers; stopped before final submission."
            if auto_answer
            else "Filled eligible visible answers after review-only override and stopped before final submission."
            if bypass_review_only
            else "Filled eligible visible answers and stopped before final submission."
        ),
        stop_reason=stop_reason,
        screenshot_browser=browser,
        run_dir=run_dir,
        summary_verification=summary_verification,
    )


def _load_answer_specs(path: Path) -> list[dict[str, Any]]:
    payload = read_json(path, default=None)
    if payload is None:
        raise RuntimeError(f"Answer file not found: {path}")
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("answers"), list):
        return payload["answers"]
    raise RuntimeError("Answer file must be a list or an object with an `answers` list.")


def _first_attempt_page_url(url: str) -> str | None:
    parsed = urlparse(url)
    if not parsed.path.endswith("/mod/quiz/attempt.php"):
        return None
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if "attempt" not in query or "cmid" not in query:
        return None
    if query.get("page") == "0":
        return None
    query["page"] = "0"
    return urlunparse(parsed._replace(query=urlencode(query)))


def _cmid_from_url(url: str) -> str:
    parsed = urlparse(url)
    return str(dict(parse_qsl(parsed.query, keep_blank_values=True)).get("id") or "")


def _verify_summary_or_visible_page(browser: AgentBrowser) -> dict[str, Any]:
    state = detect_quiz_page_state(browser)
    if state.get("state") == "summary":
        rows = browser.eval_json(r"""
(() => {
  const text = document.body ? document.body.innerText : "";
  const rows = [];
  for (const tr of document.querySelectorAll("tr")) {
    const cells = [...tr.querySelectorAll("th,td")].map(cell => (cell.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (cells.length >= 2 && /^\d+$/.test(cells[0])) rows.push({ question_index: Number(cells[0]), moodle_status: cells.slice(1).join(" ") });
  }
  return JSON.stringify({ rows, body_excerpt: text.slice(0, 2000) });
})()
""")
        return {"state": state, "summary": rows, "final_submit_clicked": False}
    return {"state": state, "visible_questions": verify_questions_persisted(browser), "final_submit_clicked": False}


def _fill_visible_questions(
    browser: AgentBrowser,
    questions: list[dict[str, Any]],
    answers: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for question in questions:
        answer = _match_answer(question, answers)
        if not answer:
            results.append(
                {
                    "question_id": question.get("question_id"),
                    "question_index": question.get("question_index"),
                    "filled": False,
                    "reason": "no-answer-spec",
                }
            )
            continue
        validation_error = _validate_answer_spec(answer)
        if validation_error:
            results.append(
                {
                    "question_id": question.get("question_id"),
                    "question_index": question.get("question_index"),
                    "filled": False,
                    "reason": validation_error,
                    "answer": answer.get("answer"),
                    "answers": answer.get("answers"),
                    "confidence": answer.get("confidence"),
                    "citations": answer.get("citations", []),
                    "rationale": answer.get("rationale"),
                    "risk_flags": answer.get("risk_flags", []),
                    "generated_by": answer.get("generated_by"),
                }
            )
            continue
        result = browser.eval_json(_fill_question_js(question, answer))
        results.append(
            {
                "question_id": question.get("question_id"),
                "question_index": question.get("question_index"),
                "filled": bool(result.get("filled")),
                "reason": result.get("reason"),
                "control": result.get("control"),
                "matched_by": result.get("matched_by"),
                "answer": answer.get("answer"),
                "answers": answer.get("answers"),
                "confidence": answer.get("confidence"),
                "citations": answer.get("citations", []),
                "rationale": answer.get("rationale"),
                "risk_flags": answer.get("risk_flags", []),
                "generated_by": answer.get("generated_by"),
            }
        )
    return results


def _match_answer(question: dict[str, Any], answers: list[dict[str, Any]]) -> dict[str, Any] | None:
    prompt = str(question.get("prompt", "")).casefold()
    qid = question.get("question_id")
    qindex = question.get("question_index")
    for answer in answers:
        if answer.get("question_id") and answer.get("question_id") == qid:
            return answer
        if answer.get("question_index") and int(answer["question_index"]) == int(qindex):
            return answer
        if answer.get("index") and int(answer["index"]) == int(qindex):
            return answer
        prompt_contains = answer.get("prompt_contains")
        if prompt_contains and str(prompt_contains).casefold() in prompt:
            return answer
    return None


def _validate_answer_spec(answer: dict[str, Any]) -> str | None:
    if "answer" not in answer and "answers" not in answer:
        return "answer-missing"
    if float(answer.get("confidence", 0)) < 0.65:
        return "confidence-below-threshold"
    citations = answer.get("citations") or []
    if not citations:
        return "citations-missing"
    risk_flags = answer.get("risk_flags") or []
    if risk_flags:
        return "answer-risk-flags-present"
    return None


def _answer_values(answer: dict[str, Any]) -> list[Any]:
    if isinstance(answer.get("answers"), list):
        return answer["answers"]
    value = answer.get("answer")
    if isinstance(value, list):
        return value
    return [value]


def _fill_question_js(question: dict[str, Any], answer: dict[str, Any]) -> str:
    qid = question.get("question_id")
    answer_value = _answer_values(answer)
    return f"""
(() => {{
  const question = document.getElementById({json.dumps(qid)});
  const answer = {json.dumps(answer_value)};
  if (!question) return JSON.stringify({{ filled: false, reason: "question-not-found" }});
  const rawValues = Array.isArray(answer) ? answer : [answer];
  const values = rawValues.map(value => typeof value === "object" && value !== null ? value : {{ text: String(value) }});
  const normalize = value => String(value || "").toLowerCase().replace(/\\s+/g, " ").trim();
  const compact = value => normalize(value).replace(/\\s+/g, "");
  const letterOf = value => {{
    const match = normalize(value).match(/^([a-z])\\s*[.)]?/);
    return match ? match[1] : "";
  }};
  const collapseMathjaxDuplicate = value => {{
    const parts = normalize(value).split(" ").filter(Boolean);
    if (parts.length % 2 !== 0) return normalize(value);
    const half = parts.length / 2;
    const left = parts.slice(0, half).join(" ");
    const right = parts.slice(half).join(" ");
    return left === right ? left : normalize(value);
  }};
  const numericTokens = value => normalize(value).match(/-?\\d+(?:[.,]\\d+)?/g) || [];
  const equivalent = (expectedRaw, optionRaw) => {{
    const expected = normalize(expectedRaw);
    const option = normalize(optionRaw);
    if (!expected || !option) return false;
    if (option === expected || compact(option) === compact(expected)) return true;
    const collapsed = collapseMathjaxDuplicate(option);
    if (collapsed === expected || compact(collapsed) === compact(expected)) return true;
    const expectedNumbers = numericTokens(expected);
    const optionNumbers = numericTokens(collapsed);
    return expectedNumbers.length === 1 && optionNumbers.length === 1 && expectedNumbers[0] === optionNumbers[0];
  }};
  const textControls = [...question.querySelectorAll("input:not([type]), input[type='text'], input[type='number'], textarea")]
    .filter(el => !el.disabled && !el.readOnly && el.type !== "hidden");
  if (textControls.length) {{
    const control = textControls[0];
    control.focus();
    control.value = String(values[0].text ?? values[0].value ?? "");
    control.dispatchEvent(new Event("input", {{ bubbles: true }}));
    control.dispatchEvent(new Event("change", {{ bubbles: true }}));
    return JSON.stringify({{
      filled: true,
      reason: "filled-text",
      control: {{ id: control.id || null, name: control.name || null, type: control.type || control.tagName }}
    }});
  }}

  const choiceControls = [...question.querySelectorAll("input[type='radio'], input[type='checkbox']")]
    .filter(el => !el.disabled);
  let changed = 0;
  const matchedControls = [];
  for (const expectedSpec of values) {{
    const expected = normalize(String(expectedSpec.text ?? expectedSpec.answer ?? expectedSpec.value ?? ""));
    const expectedLetter = normalize(String(expectedSpec.letter ?? "")) || letterOf(expected);
    const expectedControlId = String(expectedSpec.control_id ?? expectedSpec.id ?? "");
    const expectedName = String(expectedSpec.name ?? "");
    const expectedValue = String(expectedSpec.value ?? "");
    let matched = null;
    let matchedBy = null;
    for (const control of choiceControls) {{
      const labels = [...(control.labels || [])].map(label => label.innerText).join(" ");
      const container = control.closest("label, .r0, .r1, .answer div, p, li");
      const optionText = normalize(labels || (container ? container.innerText : "") || control.value || "");
      const optionLetter = letterOf(optionText);
      if (expectedControlId && control.id === expectedControlId) {{
        matched = control;
        matchedBy = "control_id";
        break;
      }}
      if (expectedName && expectedValue && control.name === expectedName && String(control.value) === expectedValue) {{
        matched = control;
        matchedBy = "name_value";
        break;
      }}
      if (expectedLetter && optionLetter && expectedLetter === optionLetter) {{
        matched = control;
        matchedBy = "letter";
        break;
      }}
      if (equivalent(expected, optionText) || equivalent(expected, control.value || "")) {{
        matched = control;
        matchedBy = "text";
        break;
      }}
    }}
    if (matched) {{
      matched.checked = true;
      matched.dispatchEvent(new Event("input", {{ bubbles: true }}));
      matched.dispatchEvent(new Event("change", {{ bubbles: true }}));
      changed += 1;
      matchedControls.push({{ id: matched.id || null, name: matched.name || null, matched_by: matchedBy }});
    }}
  }}
  if (changed) {{
    return JSON.stringify({{ filled: true, reason: "filled-choice", matched_by: matchedControls.map(item => item.matched_by).join(","), control: {{ count: changed, matched: matchedControls }} }});
  }}

  const select = question.querySelector("select:not([disabled])");
  if (select) {{
    const expected = normalize(String(values[0].text ?? values[0].value ?? ""));
    const option = [...select.options].find(opt => {{
      const text = normalize(opt.text || "");
      const value = normalize(opt.value || "");
      return equivalent(expected, text) || value === expected;
    }});
    if (option) {{
      select.value = option.value;
      select.dispatchEvent(new Event("change", {{ bubbles: true }}));
      return JSON.stringify({{
        filled: true,
        reason: "filled-select",
        control: {{ id: select.id || null, name: select.name || null }}
      }});
    }}
  }}
  return JSON.stringify({{ filled: false, reason: "no-compatible-control-or-option-match" }});
}})()
"""


def _write_fill_report(
    *,
    page: dict[str, Any],
    url: str,
    fill_results: list[dict[str, Any]],
    review_only: bool,
    risk_flags: list[str],
    message: str,
    stop_reason: str = "unknown",
    screenshot_browser: AgentBrowser | None = None,
    run_dir: Path | None = None,
    summary_verification: dict[str, Any] | None = None,
) -> Path:
    if run_dir is None:
        run_dir = create_output_run_dir("quiz-fill", page.get("title") or "quiz")
    write_json(
        run_dir / "fill-results.json",
        {
            "captured_at": utc_now(),
            "url": page.get("url", url),
            "title": page.get("title"),
            "status": _fill_status(page, fill_results),
            "review_only": review_only,
            "risk_flags": sorted(set(risk_flags)),
            "message": message,
            "stop_reason": stop_reason,
            "results": fill_results,
            "questions": page.get("questions", []),
            "summary_verification": summary_verification or {},
        },
    )
    lines = [
        f"# Quiz Fill Report: {page.get('title') or 'Untitled'}",
        "",
        f"- Captured: {utc_now()}",
        f"- URL: {page.get('url', url)}",
        f"- Status: {_fill_status(page, fill_results)}",
        f"- Mode: {'review-only' if review_only else 'guarded-fill'}",
        f"- Message: {message}",
        f"- Stop reason: {stop_reason}",
        "",
        "## Results",
        "",
    ]
    if risk_flags:
        lines.extend(["## Risk Flags", ""])
        lines.extend(f"- {flag}" for flag in sorted(set(risk_flags)))
        lines.append("")
    if fill_results:
        for result in fill_results:
            if result.get("action"):
                lines.append(f"- action {result.get('action')}: clicked={result.get('clicked')} text={result.get('text')}")
                continue
            lines.append(
                f"- question {result.get('question_index')}: "
                f"{'filled' if result.get('filled') else 'not filled'} ({result.get('reason')})"
                + (f", matched_by={result.get('matched_by')}" if result.get("matched_by") else "")
            )
    else:
        lines.append("- No answers were filled.")
    if summary_verification:
        lines.extend(["", "## Moodle Persistence Verification", ""])
        summary = summary_verification.get("summary", {})
        rows = summary.get("rows", []) if isinstance(summary, dict) else []
        visible = summary_verification.get("visible_questions", [])
        for row in rows:
            lines.append(f"- question {row.get('question_index')}: {row.get('moodle_status')}")
        for item in visible:
            lines.append(f"- {item.get('question_id')}: {item.get('moodle_status')} persisted={item.get('saved')}")
    lines.extend(["", "Final submit was not clicked."])
    (run_dir / "fill-report.md").write_text("\n".join(lines), encoding="utf-8")
    if screenshot_browser:
        screenshot_browser.screenshot(run_dir / "page.png")
    return run_dir


def _fill_status(page: dict[str, Any], fill_results: list[dict[str, Any]]) -> str:
    if any(result.get("filled") for result in fill_results):
        return "filled"
    if fill_results:
        return "attempted-no-fill"
    if not page.get("questions"):
        return "no-questions-visible"
    return "no-results"
