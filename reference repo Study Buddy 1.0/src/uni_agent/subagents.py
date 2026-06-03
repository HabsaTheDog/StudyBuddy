from __future__ import annotations

import re
import subprocess
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from pathlib import Path
from typing import Any

from .browser import AgentBrowser
from .knowledge import course_brief_for_url, course_briefs_for_prompt
from .providers import AgentTask, resolve_provider
from .providers.base import result_to_dict, write_agent_transcript
from .retrieval import source_excerpts_for_question
from .storage import ROOT, create_output_run_dir, env_with_dotenv, read_json, utc_now, write_json


ANSWER_SCHEMA_PATH = ROOT / "config" / "subagent_answer.schema.json"
SCREENSHOT_VIEWPORT_WIDTH = 1600
SCREENSHOT_VIEWPORT_HEIGHT = 1400


def generate_answer_specs(
    questions: list[dict[str, Any]],
    *,
    page: dict[str, Any],
    browser: AgentBrowser | None = None,
    packet_root: Path | None = None,
    page_number: int | None = None,
) -> list[dict[str, Any]]:
    """Create isolated question packets and ask a subagent for answer specs.

    This module intentionally contains no domain-specific solving logic. It only
    extracts text/source/screenshot context, calls a configured subagent backend,
    and normalizes the returned answer contract for the Moodle orchestrator.
    """

    if packet_root is None:
        packet_root = create_output_run_dir("subagent", page.get("title") or "quiz")
    page_dir = packet_root / f"page-{page_number or 1:03d}"
    page_dir.mkdir(parents=True, exist_ok=True)

    screenshot_path = page_dir / "page.png"
    full_screenshot_path = page_dir / "page-full.png"
    screenshot_error = None
    full_screenshot_error = None
    if browser is not None:
        try:
            _prepare_screenshot_viewport(browser)
            browser.screenshot(screenshot_path)
        except Exception as exc:  # pragma: no cover - browser tooling detail
            screenshot_error = str(exc)
        try:
            browser.screenshot(full_screenshot_path, full_page=True)
        except Exception as exc:  # pragma: no cover - browser tooling detail
            full_screenshot_error = str(exc)

    page_packet = {
        "captured_at": utc_now(),
        "page_number": page_number,
        "title": page.get("title"),
        "url": page.get("url"),
        "body_text_excerpt": _trim_text(page.get("body_text"), 6000),
        "question_count": len(questions),
        "screenshot": _relative_or_absolute(screenshot_path),
        "screenshot_error": screenshot_error,
        "screenshots": {
            "viewport": _relative_or_absolute(screenshot_path) if screenshot_path.exists() else None,
            "full_page": _relative_or_absolute(full_screenshot_path) if full_screenshot_path.exists() else None,
            "full_page_error": full_screenshot_error,
            "viewport_size": {
                "width": _env_int("QUIZ_SCREENSHOT_VIEWPORT_WIDTH", SCREENSHOT_VIEWPORT_WIDTH),
                "height": _env_int("QUIZ_SCREENSHOT_VIEWPORT_HEIGHT", SCREENSHOT_VIEWPORT_HEIGHT),
            },
        },
    }
    write_json(page_dir / "page-packet.json", page_packet)

    specs: list[dict[str, Any]] = []
    for question in questions:
        specs.append(
            _answer_question_via_subagent(
                question=question,
                page=page,
                page_packet=page_packet,
                page_dir=page_dir,
                browser=browser,
                screenshot_path=screenshot_path if screenshot_path.exists() else None,
            )
        )
    return specs


def generate_answer_specs_parallel(
    questions: list[dict[str, Any]],
    *,
    page: dict[str, Any],
    browser: AgentBrowser | None = None,
    packet_root: Path | None = None,
    page_number: int | None = None,
    max_workers: int = 4,
    timeout_seconds: int = 180,
) -> list[dict[str, Any]]:
    """Parallel subagent answer generation after all screenshots/packets are prepared.

    Browser interaction is still serialized for screenshot capture. The expensive
    subagent calls run concurrently and the caller mutates Moodle only after all
    answers have been collected.
    """

    if len(questions) <= 1:
        return generate_answer_specs(
            questions,
            page=page,
            browser=browser,
            packet_root=packet_root,
            page_number=page_number,
        )
    if packet_root is None:
        packet_root = create_output_run_dir("subagent", page.get("title") or "quiz")
    page_dir = packet_root / f"page-{page_number or 1:03d}"
    page_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path = page_dir / "page.png"
    full_screenshot_path = page_dir / "page-full.png"
    if browser is not None:
        try:
            _prepare_screenshot_viewport(browser)
            browser.screenshot(screenshot_path)
            browser.screenshot(full_screenshot_path, full_page=True)
        except Exception:
            pass
    page_packet = {
        "captured_at": utc_now(),
        "page_number": page_number,
        "title": page.get("title"),
        "url": page.get("url"),
        "body_text_excerpt": _trim_text(page.get("body_text"), 6000),
        "question_count": len(questions),
        "screenshot": _relative_or_absolute(screenshot_path) if screenshot_path.exists() else None,
    }
    write_json(page_dir / "page-packet.json", page_packet)

    prepared: list[tuple[int, dict[str, Any], Path, Path | None, Path, Path]] = []
    for index, question in enumerate(questions):
        question_index = int(question.get("page_question_index") or question.get("question_index") or index + 1)
        question_dir = page_dir / f"question-{question_index:03d}"
        question_dir.mkdir(parents=True, exist_ok=True)
        question_screenshot_path = _capture_question_screenshot(browser=browser, question=question, question_dir=question_dir)
        packet = _build_question_packet(
            question=question,
            page=page,
            page_packet=page_packet,
            question_screenshot_path=question_screenshot_path,
        )
        packet_path = question_dir / "packet.json"
        write_json(packet_path, packet)
        prepared.append((index, question, packet_path, question_screenshot_path or screenshot_path, question_dir / "subagent-answer.json", question_dir / "subagent-transcript.txt"))

    specs: list[dict[str, Any] | None] = [None] * len(prepared)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                _run_and_normalize_prepared_subagent,
                question=question,
                page=page,
                packet_path=packet_path,
                screenshot_path=screenshot_path if screenshot_path and screenshot_path.exists() else None,
                response_path=response_path,
                transcript_path=transcript_path,
                timeout_seconds=timeout_seconds,
            ): index
            for index, question, packet_path, screenshot_path, response_path, transcript_path in prepared
        }
        try:
            completed = as_completed(futures, timeout=timeout_seconds)
            for future in completed:
                index = futures[future]
                try:
                    specs[index] = future.result(timeout=1)
                except Exception as exc:
                    specs[index] = _subagent_error_spec(prepared[index][1], "subagent_parallel_error", str(exc))
        except FuturesTimeoutError:
            pass
        for future, index in futures.items():
            if specs[index] is not None:
                continue
            if future.done():
                try:
                    specs[index] = future.result(timeout=1)
                except Exception as exc:
                    specs[index] = _subagent_error_spec(prepared[index][1], "subagent_parallel_error", str(exc))
            else:
                future.cancel()
                specs[index] = _subagent_error_spec(prepared[index][1], "subagent_timeout", f"Timed out after {timeout_seconds}s")
    return [spec for spec in specs if spec is not None]


def _subagent_error_spec(question: dict[str, Any], reason: str, detail: str) -> dict[str, Any]:
    return {
        "question_id": question.get("question_id"),
        "question_index": question.get("question_index"),
        "answers": [],
        "answer": "",
        "confidence": 0.0,
        "citations": [],
        "rationale": f"{reason}: {detail}",
        "risk_flags": [reason],
        "generated_by": "subagent",
    }


def _run_and_normalize_prepared_subagent(
    *,
    question: dict[str, Any],
    page: dict[str, Any],
    packet_path: Path,
    screenshot_path: Path | None,
    response_path: Path,
    transcript_path: Path,
    timeout_seconds: int | None = None,
) -> dict[str, Any]:
    subagent_result = _run_subagent(
        packet_path=packet_path,
        screenshot_path=screenshot_path,
        response_path=response_path,
        transcript_path=transcript_path,
        timeout_override=timeout_seconds,
    )
    answer = _normalize_subagent_answer(
        question=question,
        page=page,
        subagent_result=subagent_result,
        packet_path=packet_path,
        screenshot_path=screenshot_path,
        response_path=response_path,
        transcript_path=transcript_path,
    )
    write_json(packet_path.parent / "answer-spec.json", answer)
    return answer


def _answer_question_via_subagent(
    *,
    question: dict[str, Any],
    page: dict[str, Any],
    page_packet: dict[str, Any],
    page_dir: Path,
    browser: AgentBrowser | None,
    screenshot_path: Path | None,
) -> dict[str, Any]:
    question_index = int(question.get("page_question_index") or question.get("question_index") or 0)
    question_dir = page_dir / f"question-{question_index:03d}"
    question_dir.mkdir(parents=True, exist_ok=True)

    question_screenshot_path = _capture_question_screenshot(
        browser=browser,
        question=question,
        question_dir=question_dir,
    )

    packet = _build_question_packet(
        question=question,
        page=page,
        page_packet=page_packet,
        question_screenshot_path=question_screenshot_path,
    )
    packet_path = question_dir / "packet.json"
    write_json(packet_path, packet)

    response_path = question_dir / "subagent-answer.json"
    transcript_path = question_dir / "subagent-transcript.txt"
    subagent_result = _run_subagent(
        packet_path=packet_path,
        screenshot_path=question_screenshot_path or screenshot_path,
        response_path=response_path,
        transcript_path=transcript_path,
    )
    answer = _normalize_subagent_answer(
        question=question,
        page=page,
        subagent_result=subagent_result,
        packet_path=packet_path,
        screenshot_path=question_screenshot_path or screenshot_path,
        response_path=response_path,
        transcript_path=transcript_path,
    )
    write_json(question_dir / "answer-spec.json", answer)
    return answer


def _build_question_packet(
    *,
    question: dict[str, Any],
    page: dict[str, Any],
    page_packet: dict[str, Any],
    question_screenshot_path: Path | None = None,
) -> dict[str, Any]:
    visible_options = _visible_options(question)
    course_context = course_brief_for_url(str(page.get("url") or "")) or None
    related_courses = course_briefs_for_prompt(
        f"{page.get('title') or ''}\n{question.get('prompt') or ''}\n{question.get('visible_context') or ''}",
        limit=3,
    )
    source_excerpts = _source_excerpts_for_question(question)
    return {
        "captured_at": utc_now(),
        "task": "answer_one_visible_moodle_quiz_question",
        "rules": [
            "Use the extracted question text, visible options/controls, Moodle page context, screenshot, and provided source excerpts.",
            "Return an empty answer with a risk flag when the screenshot/text is insufficient.",
            "For radio/select questions, prefer returning an answers array with control_id or letter from option_objects.",
            "For checkbox/multi-select questions, return an answers array with one object per selected control.",
            "When MathJax option text is incomplete, do not guess by text; use control_id or letter only if the screenshot/options make it clear.",
            "For text/numeric questions, return the exact value that should be typed.",
            "Do not browse Moodle, do not control the browser, and do not submit anything.",
        ],
        "return_contract": {
            "answers": [{"control_id": "visible control id when available", "letter": "option letter when available", "text": "visible option/value"}],
            "answer": "string | number | boolean | array | null",
            "confidence": "0..1; must be >= 0.65 to be fillable",
            "citations": "non-empty list; cite Moodle page and any local source excerpts used",
            "rationale": "short reasoning summary",
            "risk_flags": "empty list only when answer is safe to fill",
        },
        "page": {
            "title": page.get("title"),
            "url": page.get("url"),
            "page_number": page_packet.get("page_number"),
            "screenshot": page_packet.get("screenshot"),
            "screenshots": page_packet.get("screenshots", {}),
        },
        "moodle_course_context": course_context,
        "related_synced_courses": related_courses,
        "question": {
            "question_id": question.get("question_id"),
            "question_index": question.get("question_index"),
            "page_question_index": question.get("page_question_index"),
            "question_type": question.get("question_type"),
            "prompt": question.get("prompt"),
            "visible_context": question.get("visible_context"),
            "options": visible_options,
            "option_objects": question.get("option_objects", []),
            "controls": question.get("controls", []),
            "extraction_quality": question.get("extraction_quality", {}),
            "screenshot": _relative_or_absolute(question_screenshot_path) if question_screenshot_path else None,
        },
        "source_excerpts": source_excerpts,
        "retrieval_status": "ok" if source_excerpts else "retrieval_failed",
    }


def _run_subagent(
    *,
    packet_path: Path,
    screenshot_path: Path | None,
    response_path: Path,
    transcript_path: Path,
    timeout_override: int | None = None,
) -> dict[str, Any]:
    env = env_with_dotenv()
    timeout = timeout_override or int(env.get("SUBAGENT_TIMEOUT_SECONDS") or env.get("STUDY_BUDDY_AGENT_TIMEOUT_SECONDS") or "300")
    task = AgentTask(
        kind="quiz_subagent",
        packet_path=packet_path,
        output_path=response_path,
        transcript_path=transcript_path,
        schema_path=ANSWER_SCHEMA_PATH,
        screenshot_path=screenshot_path,
        prompt=_codex_subagent_prompt(packet_path=packet_path, screenshot_path=screenshot_path),
        timeout_seconds=timeout,
        cwd=ROOT,
        env=env,
    )
    selection = resolve_provider(
        env=env,
        task_kind="quiz_subagent",
        command_env="SUBAGENT_SOLVER_COMMAND",
        provider_env="SUBAGENT_SOLVER_PROVIDER",
    )
    try:
        result = selection.provider.run(task)
    except FileNotFoundError as exc:
        return {
            "ok": False,
            "reason": "subagent-command-not-found",
            "stdout": "",
            "stderr": str(exc),
            "returncode": None,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "reason": "subagent-timeout",
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "",
            "returncode": None,
        }
    write_agent_transcript(task, result)
    parsed = result.parsed
    if result.ok and parsed is not None:
        write_json(response_path, parsed)
        return {
            "ok": True,
            "reason": "subagent-answer",
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
            "parsed": parsed,
            "provider": result.provider,
        }
    return {
        **result_to_dict(result),
        "reason": _subagent_reason(result.reason),
    }


def _codex_subagent_prompt(*, packet_path: Path, screenshot_path: Path | None) -> str:
    image_note = (
        f"The primary question screenshot is attached and is also stored at {screenshot_path}."
        if screenshot_path is not None
        else "No primary question screenshot file was captured; rely on extracted text and packet screenshot paths."
    )
    return f"""You are a constrained Moodle quiz question subagent.

Read the packet JSON at:
{packet_path}

{image_note}

Answer exactly one visible question. Use only the packet, attached screenshot, additional screenshot paths named in the packet, and local source excerpts/paths named in the packet. If the attached screenshot is cropped or insufficient, inspect packet.page.screenshots.full_page and packet.question.screenshot before declaring the image unreadable. Do not navigate Moodle, do not fill forms, and do not submit anything.

Return JSON only matching the schema. If the answer is a visible option, copy the exact option text from packet.question.options or packet.question.controls. If there are multiple correct checkbox options, return an array of exact option texts. If the question is ambiguous, image text is unreadable, source support is missing, or you are not confident, return answer null or "", confidence below 0.65, and a specific risk flag.
"""


def _subagent_reason(reason: str) -> str:
    mapping = {
        "agent-command-not-found": "subagent-command-not-found",
        "agent-command-not-configured": "subagent-command-not-found",
        "agent-provider-disabled": "subagent-command-disabled",
        "agent-nonzero-exit": "subagent-nonzero-exit",
        "agent-invalid-json": "subagent-invalid-json",
        "agent-timeout": "subagent-timeout",
        "agent-provider-unknown": "subagent-command-not-found",
    }
    return mapping.get(reason, reason if reason.startswith("subagent-") else f"subagent-{reason}")


def _normalize_subagent_answer(
    *,
    question: dict[str, Any],
    page: dict[str, Any],
    subagent_result: dict[str, Any],
    packet_path: Path,
    screenshot_path: Path | None,
    response_path: Path,
    transcript_path: Path,
) -> dict[str, Any]:
    parsed = subagent_result.get("parsed") if subagent_result.get("ok") else None
    citations = _normalize_citations(parsed.get("citations") if isinstance(parsed, dict) else None, page=page, question=question)
    base = {
        "question_id": question.get("question_id"),
        "question_index": question.get("question_index"),
        "prompt_contains": str(question.get("prompt") or "")[:80],
        "packet_path": _relative_or_absolute(packet_path),
        "screenshot": _relative_or_absolute(screenshot_path) if screenshot_path else None,
        "subagent_response_path": _relative_or_absolute(response_path),
        "subagent_transcript_path": _relative_or_absolute(transcript_path),
        "generated_by": "subagent",
    }
    if not isinstance(parsed, dict):
        reason = subagent_result.get("reason") or "subagent-no-answer"
        return {
            **base,
            "answer": "",
            "confidence": 0.0,
            "citations": citations,
            "rationale": reason,
            "risk_flags": [reason],
        }

    risk_flags = [str(flag) for flag in parsed.get("risk_flags", []) if str(flag).strip()]
    return {
        **base,
        "answer": parsed.get("answer"),
        "confidence": _coerce_confidence(parsed.get("confidence")),
        "citations": citations,
        "rationale": str(parsed.get("rationale") or ""),
        "risk_flags": risk_flags,
    }


def _normalize_citations(
    citations: Any,
    *,
    page: dict[str, Any],
    question: dict[str, Any],
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    if isinstance(citations, list):
        for citation in citations:
            if isinstance(citation, dict) and citation.get("title"):
                normalized.append(citation)
            elif isinstance(citation, str) and citation.strip():
                normalized.append({"title": citation.strip(), "kind": "subagent_citation"})
    if not normalized:
        normalized.append(
            {
                "title": page.get("title") or "Moodle quiz page",
                "kind": "quiz_question",
                "url": page.get("url"),
                "section": f"Question {question.get('question_index')}",
            }
        )
    return normalized


def _source_excerpts_for_question(question: dict[str, Any], limit: int = 4) -> list[dict[str, Any]]:
    excerpts = source_excerpts_for_question(question, limit=limit)
    if excerpts:
        return excerpts
    index = read_json(ROOT / "state" / "document_index.json", default={})
    documents = index.get("documents", []) if isinstance(index, dict) else []
    terms = _question_terms(question)
    scored: list[tuple[int, dict[str, Any]]] = []
    for document in documents:
        path = document.get("path")
        name = document.get("name") or path
        for page in document.get("pages", []):
            text = str(page.get("text") or "")
            normalized = text.casefold()
            score = sum(1 for term in terms if term in normalized)
            if score:
                scored.append((score, {"title": name, "kind": "local_document_excerpt", "path": path, "page": page.get("page"), "text": _trim_text(text, 1800)}))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [item for _, item in scored[:limit]]


def _question_terms(question: dict[str, Any]) -> set[str]:
    text = f"{question.get('prompt') or ''}\n{question.get('visible_context') or ''}"
    stopwords = {
        "frage",
        "question",
        "antwort",
        "wieviel",
        "welche",
        "folgende",
        "korrekt",
        "wahr",
        "falsch",
        "punkte",
    }
    return {
        word.casefold()
        for word in re.findall(r"[a-zA-ZäöüÄÖÜß]{5,}", text)
        if word.casefold() not in stopwords
    }


def _visible_options(question: dict[str, Any]) -> list[str]:
    options: list[str] = []
    for option in question.get("options", []) or []:
        text = " ".join(str(option).split())
        if text and text not in options:
            options.append(text)
    for control in question.get("controls", []) or []:
        text = " ".join(str(control.get("option_text") or "").split())
        if text and text not in options:
            options.append(text)
    return options


def _coerce_confidence(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def _prepare_screenshot_viewport(browser: AgentBrowser) -> None:
    width = _env_int("QUIZ_SCREENSHOT_VIEWPORT_WIDTH", SCREENSHOT_VIEWPORT_WIDTH)
    height = _env_int("QUIZ_SCREENSHOT_VIEWPORT_HEIGHT", SCREENSHOT_VIEWPORT_HEIGHT)
    browser.set_viewport(width, height)


def _capture_question_screenshot(
    *,
    browser: AgentBrowser | None,
    question: dict[str, Any],
    question_dir: Path,
) -> Path | None:
    if browser is None:
        return None
    selector = _question_selector(question)
    if not selector:
        return None
    screenshot_path = question_dir / "question.png"
    try:
        browser.screenshot(screenshot_path, selector=selector)
    except Exception:  # pragma: no cover - browser tooling detail
        return None
    return screenshot_path if screenshot_path.exists() else None


def _question_selector(question: dict[str, Any]) -> str | None:
    qid = str(question.get("question_id") or "").strip()
    if not qid:
        return None
    return f'[id="{_css_string_escape(qid)}"]'


def _css_string_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _env_int(name: str, default: int) -> int:
    value = env_with_dotenv().get(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _trim_text(value: Any, max_chars: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def _relative_or_absolute(path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)
