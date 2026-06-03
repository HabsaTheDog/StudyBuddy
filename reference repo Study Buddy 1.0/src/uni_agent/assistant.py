from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .activities import discover_live_activities, parse_requested_activity, resolve_requested_activities
from .browser import AgentBrowser
from .courses import index_courses
from .documents import MATERIAL_LINKS_JS
from .knowledge import load_synced_courses
from .output_runs import artifact_path
from .preflight import run_moodle_preflight, validate_quiz_activity_url
from .quiz import assist_quiz, fill_quiz
from .storage import ROOT, create_output_run_dir, read_json, utc_now, write_json
from .document_build import generate_document_build


COURSE_HINTS = {
    "math": ["math", "mathe", "mathematik", "maes", "engineering science"],
    "electrical": ["elektrotechnik", "et1", "et2", "electrical"],
    "dynamics": ["dynamik", "dynamic", "dyn"],
    "english": ["english", "eng"],
}


QUIZ_ACTIONABILITY_JS = r"""
(() => {
  const controls = [...document.querySelectorAll("button, input[type='submit'], a.btn, a[role='button']")];
  const controlTexts = controls.map(el => (el.innerText || el.value || el.getAttribute("aria-label") || "").trim()).filter(Boolean);
  const questions = [...document.querySelectorAll(".que, [id^='question-']")].length;
  return JSON.stringify({
    title: document.title,
    url: location.href,
    questions,
    control_texts: controlTexts,
    body_excerpt: document.body.innerText.slice(0, 1500)
  });
})()
"""


@dataclass(frozen=True)
class PromptResult:
    kind: str
    message: str
    output_path: Path


def run_prompt(
    prompt: str,
    *,
    answers_path: Path | None = None,
    max_pages: int = 100,
    auto_answer: bool = False,
) -> PromptResult:
    prompt_clean = " ".join(prompt.split())
    prompt_lower = prompt_clean.casefold()
    if _looks_like_do_request(prompt_lower) and answers_path is None:
        auto_answer = True

    if _looks_like_study_build_request(prompt_lower):
        return _handle_study_build_prompt(prompt_clean)

    if _looks_like_quiz_request(prompt_lower):
        return _handle_quiz_prompt(
            prompt_clean,
            answers_path=answers_path,
            max_pages=max_pages,
            auto_answer=auto_answer,
        )

    return _write_clarification(
        _new_request_dir(prompt_clean),
        prompt_clean,
        "I could not map this prompt to a supported Moodle action yet.",
        suggestions=[
            "Try: `find the next math quiz`",
            "Try: `inspect the Mathematik quiz`",
            "Try: `summarize the latest math materials`",
        ],
    )


def _looks_like_quiz_request(prompt_lower: str) -> bool:
    if _looks_like_study_build_request(prompt_lower) and not _looks_like_do_request(prompt_lower):
        return False
    return any(term in prompt_lower for term in ["quiz", "test", "aufgabe", "assignment"])


def _looks_like_study_build_request(prompt_lower: str) -> bool:
    return any(
        term in prompt_lower
        for term in [
            "pdf",
            "document",
            "dokument",
            "study guide",
            "summary",
            "summarize",
            "topic summary",
            "notes",
            "revision guide",
            "cheat sheet",
            "formula sheet",
            "lernzettel",
            "zusammenfassung",
            "formelsammlung",
            "spickzettel",
            "lernhilfe",
            "stoffübersicht",
            "stoffuebersicht",
            "themenübersicht",
            "themenuebersicht",
            "kreuzerl",
            "häkchen",
            "haekchen",
            "markiert",
            "übungen",
            "uebungen",
            "übungsblatt",
            "uebungsblatt",
        ]
    )


def _looks_like_do_request(prompt_lower: str) -> bool:
    return any(
        term in prompt_lower
        for term in [
            "do ",
            "fill",
            "complete",
            "solve",
            "answer",
            "mach",
            "mache",
            "ausfüll",
            "ausfuell",
            "lösen",
            "loesen",
            "bearbeit",
        ]
    )


def _handle_study_build_prompt(prompt: str) -> PromptResult:
    run_dir = generate_document_build(
        prompt,
        output_format="markdown+pdf",
        quiz_access="ask",
        max_repair_cycles=3,
        template="auto",
        sync_policy="require-current",
    )
    manifest = read_json(artifact_path(run_dir, "metadata", "run-manifest.json"), default={})
    status = manifest.get("status") if isinstance(manifest, dict) else None
    status = status or "completed"
    return PromptResult(
        "document-build" if status == "completed" else str(status),
        f"Generated document build with status {status}",
        run_dir,
    )


def _handle_quiz_prompt(
    prompt: str,
    *,
    answers_path: Path | None,
    max_pages: int,
    auto_answer: bool,
) -> PromptResult:
    url = _extract_url(prompt)
    if url and "/mod/quiz/" in url:
        if answers_path or auto_answer:
            run_dir = fill_quiz(
                url,
                answers_path=answers_path,
                max_pages=max_pages,
                bypass_review_only=True,
                auto_answer=auto_answer,
            )
            no_activity = _fill_had_no_activity(run_dir)
            if no_activity:
                return _write_clarification(
                    run_dir,
                    prompt,
                    "I opened the quiz target, but Moodle did not expose an attempt button or visible questions.",
                    suggestions=[
                        "The quiz may be closed, already completed, hidden, or not currently attemptable.",
                        "Paste a different quiz URL, or mention a more specific quiz name.",
                    ],
                    extra={"target_url": url},
                )
            return PromptResult("completed", "Completed quiz run", run_dir)
        run_dir = assist_quiz(url)
        template = _write_answer_template_from_review(run_dir, run_dir)
        return _write_clarification(
            run_dir,
            prompt,
            "I found a quiz URL and inspected it, but no answer file was provided.",
            suggestions=[
                f"Fill `{template.relative_to(ROOT)}` with answers, confidence, and citations.",
                f"Then run: `npm run study:buddy -- \"{prompt}\" --answers {template.relative_to(ROOT)} --max-pages {max_pages}`",
            ],
            extra={"review_output": str(run_dir.relative_to(ROOT)), "answer_template": str(template.relative_to(ROOT))},
        )

    courses = _load_or_index_courses()
    course_candidates = _rank_courses(prompt, courses)
    if not course_candidates:
        return _write_clarification(
            _new_request_dir(prompt),
            prompt,
            "I could not identify a likely Moodle course from the prompt.",
            suggestions=["Mention the course name/code, for example `Mathematik`, `MAES2`, or paste the quiz URL."],
        )

    top_score = course_candidates[0]["score"]
    likely_courses = [course for course in course_candidates if course["score"] == top_score][:5]
    if len(likely_courses) > 1 and top_score < 6:
        return _write_course_clarification(_new_request_dir(prompt), prompt, likely_courses)

    selected_course = likely_courses[0]
    requested_activity = parse_requested_activity(prompt)
    if requested_activity:
        exact_result = _handle_exact_activity_prompt(
            prompt,
            selected_course,
            answers_path=answers_path,
            max_pages=max_pages,
            auto_answer=auto_answer,
        )
        if exact_result is not None:
            return exact_result

    quizzes = _discover_quizzes_for_course(selected_course)
    if not quizzes:
        return _write_clarification(
            _new_request_dir(prompt),
            prompt,
            f"I selected `{selected_course['title']}`, but found no quiz links on the course page.",
            suggestions=[
                "Paste the quiz URL directly.",
                "Run `npm run moodle:courses` and try again if Moodle changed.",
            ],
            extra={"selected_course": selected_course},
        )

    target_quiz = _select_actionable_quiz(prompt, quizzes) if auto_answer else _select_quiz(prompt, quizzes)
    if not target_quiz:
        return _write_quiz_clarification(_new_request_dir(prompt), prompt, selected_course, quizzes)

    if answers_path or auto_answer:
        run_dir = fill_quiz(
            target_quiz["url"],
            answers_path=answers_path,
            max_pages=max_pages,
            bypass_review_only=True,
            auto_answer=auto_answer,
        )
        no_activity = _fill_had_no_activity(run_dir)
        if no_activity:
            return _write_clarification(
                run_dir,
                prompt,
                "I found the likely quiz, but Moodle did not expose an attempt button or visible questions.",
                suggestions=[
                    f"Selected course: `{selected_course['title']}`",
                    f"Selected quiz: `{target_quiz['title']}`",
                    "The quiz may be closed, already completed, hidden, or not currently attemptable.",
                    "Paste a different quiz URL, or mention the exact quiz name to try.",
                ],
                extra={
                    "selected_course": selected_course,
                    "selected_quiz": target_quiz,
                },
            )
        return PromptResult("completed", "Completed quiz run", run_dir)

    run_dir = assist_quiz(target_quiz["url"])
    template = _write_answer_template_from_review(run_dir, run_dir)
    return _write_clarification(
        run_dir,
        prompt,
        "I found and inspected the likely quiz, but no answer file was provided.",
        suggestions=[
            f"Selected course: `{selected_course['title']}`",
            f"Selected quiz: `{target_quiz['title']}`",
            f"Fill `{template.relative_to(ROOT)}` with answers, confidence, and citations.",
            f"Then run: `npm run study:buddy -- \"{prompt}\" --answers {template.relative_to(ROOT)} --max-pages {max_pages}`",
        ],
        extra={
            "selected_course": selected_course,
            "selected_quiz": target_quiz,
            "review_output": str(run_dir.relative_to(ROOT)),
            "answer_template": str(template.relative_to(ROOT)),
        },
    )


def _handle_exact_activity_prompt(
    prompt: str,
    selected_course: dict[str, Any],
    *,
    answers_path: Path | None,
    max_pages: int,
    auto_answer: bool,
) -> PromptResult | None:
    request_dir = _new_request_dir(prompt)
    preflight = run_moodle_preflight(selected_course)
    write_json(request_dir / "preflight.json", preflight)

    browser = AgentBrowser(mode="read")
    resolution = resolve_requested_activities(prompt, selected_course, browser=browser)
    write_json(request_dir / "activity-resolution.json", resolution)
    requested = resolution.get("requested")
    if not requested:
        return None
    if resolution.get("missing"):
        return _write_clarification(
            request_dir,
            prompt,
            f"I resolved the course `{selected_course.get('title')}`, but could not find requested block(s): {resolution['missing']}.",
            suggestions=[
                "Check whether the block numbers are visible in Moodle.",
                "Paste the exact quiz URL if the activity is hidden in a section.",
            ],
            extra={"activity_resolution": resolution},
        )
    resolved = resolution.get("resolved") or []
    if not resolved:
        return _write_clarification(
            request_dir,
            prompt,
            f"I resolved the course `{selected_course.get('title')}`, but no matching quiz activities were visible.",
            suggestions=["Paste the exact quiz URL, or refresh Moodle sync after checking login."],
            extra={"activity_resolution": resolution},
        )

    validations = [validate_quiz_activity_url(activity, browser=browser) for activity in resolved]
    write_json(request_dir / "activity-validation.json", validations)
    stale = [item for item in validations if not item.get("ok")]
    if stale:
        return _write_clarification(
            request_dir,
            prompt,
            "One or more resolved quiz URLs failed live Moodle validation.",
            suggestions=["Open Moodle and confirm the activities are currently available.", "Run the request again after the course page is refreshed."],
            extra={"activity_resolution": resolution, "activity_validation": validations},
        )

    if not (answers_path or auto_answer):
        return _write_quiz_clarification(request_dir, prompt, selected_course, resolved)

    child_runs: list[dict[str, Any]] = []
    for activity in resolved:
        run_dir = fill_quiz(
            str(activity["url"]),
            answers_path=answers_path,
            max_pages=max_pages,
            bypass_review_only=True,
            auto_answer=auto_answer,
        )
        child_runs.append(
            {
                "title": activity.get("title"),
                "url": activity.get("url"),
                "run_dir": str(run_dir.relative_to(ROOT)),
                "fill_results": str((run_dir / "fill-results.json").relative_to(ROOT)),
                "fill_report": str((run_dir / "fill-report.md").relative_to(ROOT)),
            }
        )
    payload = {
        "created_at": utc_now(),
        "prompt": prompt,
        "selected_course": selected_course,
        "activity_resolution": resolution,
        "activity_validation": validations,
        "runs": child_runs,
        "final_submit_clicked": False,
    }
    write_json(request_dir / "multi-quiz-results.json", payload)
    lines = [
        "# Multi Quiz Fill Report",
        "",
        f"Prompt: {prompt}",
        "",
        f"Course: {selected_course.get('title')}",
        "",
        "## Runs",
        "",
    ]
    for run in child_runs:
        lines.append(f"- {run['title']}: `{run['fill_report']}`")
    lines.extend(["", "Final submit was not clicked."])
    (request_dir / "multi-quiz-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return PromptResult("completed", f"Completed {len(child_runs)} exact quiz run(s)", request_dir)


def _load_or_index_courses() -> list[dict[str, Any]]:
    courses = load_synced_courses(refresh_if_missing=True)
    if courses:
        return courses
    return [course.__dict__ for course in index_courses()]


def _rank_courses(prompt: str, courses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prompt_lower = prompt.casefold()
    wanted_terms = set(_terms_from_prompt(prompt_lower))
    current_semester = _current_semester_token()
    wants_next_or_current = any(term in prompt_lower for term in ["next", "nächst", "naechst", "current", "aktuell"])
    ranked: list[dict[str, Any]] = []
    for course in courses:
        title = str(course.get("title", ""))
        title_lower = title.casefold()
        score = 0
        for term in wanted_terms:
            if term and term in title_lower:
                score += 4 if len(term) > 3 else 2
        for canonical, terms in COURSE_HINTS.items():
            if canonical in wanted_terms or any(term in prompt_lower for term in terms):
                if any(term in title_lower for term in terms):
                    score += 6
        if wants_next_or_current and current_semester.casefold() in title_lower:
            score += 12
        elif current_semester.casefold() in title_lower:
            score += 3
        if wants_next_or_current and "ws2025" in title_lower:
            score -= 5
        if score:
            ranked.append({**course, "score": score})
    ranked.sort(key=lambda item: (-item["score"], str(item.get("title", ""))))
    return ranked


def _current_semester_token() -> str:
    now = datetime.now()
    return f"SS{now.year}" if 2 <= now.month <= 8 else f"WS{now.year}"


def _terms_from_prompt(prompt_lower: str) -> list[str]:
    words = re.findall(r"[a-zA-ZäöüÄÖÜß0-9]{3,}", prompt_lower)
    stop = {
        "the",
        "next",
        "quiz",
        "test",
        "please",
        "can",
        "you",
        "for",
        "me",
        "find",
        "do",
        "moodle",
        "aufgabe",
    }
    terms = [word for word in words if word not in stop]
    for canonical, aliases in COURSE_HINTS.items():
        if any(alias in prompt_lower for alias in aliases):
            terms.extend([canonical, *aliases])
    return terms


def _discover_quizzes_for_course(course: dict[str, Any]) -> list[dict[str, Any]]:
    card_quizzes = course.get("quizzes") if isinstance(course.get("quizzes"), list) else []
    if card_quizzes:
        return [
            {
                "title": str(quiz.get("title") or quiz.get("url") or "Untitled quiz"),
                "url": quiz.get("url"),
                "content_hint": quiz.get("content_hint") or "quiz",
                "course_id": course.get("id"),
                "course_title": course.get("title"),
                "source": "course_agent_cards",
            }
            for quiz in card_quizzes
            if quiz.get("url")
        ]
    browser = AgentBrowser(mode="read")
    activities = discover_live_activities(course, browser=browser)
    if activities:
        return [
            {
                "title": activity.title,
                "url": activity.url,
                "content_hint": "quiz",
                "course_id": course.get("id"),
                "course_title": course.get("title"),
                "activity_kind": activity.activity_kind,
                "block_number": activity.block_number,
                "source": "live_activity_discovery",
            }
            for activity in activities
            if activity.type == "quiz"
        ]
    browser.open(course["url"])
    browser.wait_load()
    links = browser.eval_json(MATERIAL_LINKS_JS)
    quizzes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for link in links:
        url = str(link.get("url", ""))
        if "/mod/quiz/" not in url or url in seen:
            continue
        seen.add(url)
        title = str(link.get("title") or url).strip()
        quizzes.append(
            {
                "title": title,
                "url": url,
                "content_hint": link.get("content_hint"),
                "course_id": course.get("id"),
                "course_title": course.get("title"),
            }
        )
    return quizzes


def _select_quiz(prompt: str, quizzes: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not quizzes:
        return None
    prompt_lower = prompt.casefold()
    if len(quizzes) == 1:
        return quizzes[0]
    ranked: list[tuple[int, dict[str, Any]]] = []
    terms = _terms_from_prompt(prompt_lower)
    for quiz in quizzes:
        haystack = f"{quiz.get('title', '')} {quiz.get('url', '')}".casefold()
        score = sum(3 for term in terms if term in haystack)
        if "next" in prompt_lower or "nächst" in prompt_lower or "naechst" in prompt_lower:
            score += 1
        ranked.append((score, quiz))
    ranked.sort(key=lambda item: -item[0])
    if ranked[0][0] > 0 and (len(ranked) == 1 or ranked[0][0] > ranked[1][0]):
        return ranked[0][1]
    if "next" in prompt_lower or "nächst" in prompt_lower or "naechst" in prompt_lower:
        return quizzes[0]
    return None


def _select_actionable_quiz(prompt: str, quizzes: list[dict[str, Any]]) -> dict[str, Any] | None:
    ordered = _rank_quizzes(prompt, quizzes)
    browser = AgentBrowser()
    inspected: list[dict[str, Any]] = []
    for quiz in ordered[:25]:
        browser.open(quiz["url"])
        browser.wait_load()
        state = browser.eval_json(QUIZ_ACTIONABILITY_JS)
        merged = {**quiz, "page_title": state.get("title"), "actionability": state}
        inspected.append(merged)
        if _is_quiz_actionable(state):
            return merged
    if inspected:
        # Return the best inspected item so downstream reports show the real
        # Moodle blocker instead of losing the selected target entirely.
        return inspected[0]
    return None


def _rank_quizzes(prompt: str, quizzes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prompt_lower = prompt.casefold()
    terms = _terms_from_prompt(prompt_lower)
    ranked: list[tuple[int, int, dict[str, Any]]] = []
    for index, quiz in enumerate(quizzes):
        haystack = f"{quiz.get('title', '')} {quiz.get('url', '')}".casefold()
        score = sum(3 for term in terms if term in haystack)
        if "next" in prompt_lower or "nächst" in prompt_lower or "naechst" in prompt_lower:
            score += max(0, 20 - index)
        ranked.append((score, -index, quiz))
    ranked.sort(key=lambda item: (-item[0], -item[1]))
    return [item[2] for item in ranked]


def _is_quiz_actionable(state: dict[str, Any]) -> bool:
    if state.get("questions"):
        return True
    controls = " ".join(str(text).casefold() for text in state.get("control_texts", []))
    return any(
        term in controls
        for term in [
            "test versuchen",
            "versuch beginnen",
            "versuch fortsetzen",
            "attempt quiz",
            "continue attempt",
            "start attempt",
        ]
    )


def _write_answer_template_from_review(review_dir: Path, request_dir: Path) -> Path:
    questions_path = review_dir / "questions.json"
    data = read_json(questions_path, default={})
    questions = data.get("questions", [])
    answers = []
    for question in questions:
        answers.append(
            {
                "question_index": question.get("question_index"),
                "question_id": question.get("question_id"),
                "prompt_contains": str(question.get("prompt", ""))[:80],
                "answer": "",
                "confidence": 0.0,
                "citations": [],
                "risk_flags": [],
            }
        )
    if not answers:
        answers.append(
            {
                "question_index": 1,
                "answer": "",
                "confidence": 0.0,
                "citations": [],
                "risk_flags": [],
            }
        )
    target = request_dir / "answer-template.json"
    write_json(target, {"answers": answers})
    return target


def _fill_had_no_activity(run_dir: Path) -> bool:
    data = read_json(run_dir / "fill-results.json", default={})
    return data.get("status") == "no-questions-visible" and not data.get("results")


def _extract_url(prompt: str) -> str | None:
    match = re.search(r"https?://\S+", prompt)
    if not match:
        return None
    return match.group(0).rstrip(".,)")


def _new_request_dir(prompt: str) -> Path:
    return create_output_run_dir("request", prompt)


def _write_clarification(
    request_dir: Path,
    prompt: str,
    reason: str,
    *,
    suggestions: list[str],
    extra: dict[str, Any] | None = None,
) -> PromptResult:
    payload = {
        "created_at": utc_now(),
        "prompt": prompt,
        "status": "needs-more-context",
        "reason": reason,
        "suggestions": suggestions,
        **(extra or {}),
    }
    write_json(artifact_path(request_dir, "metadata", "request.json"), payload)
    lines = [
        "# Study Buddy Request",
        "",
        f"Prompt: {prompt}",
        "",
        "Status: needs more context",
        "",
        reason,
        "",
        "## Next Options",
        "",
        *[f"- {suggestion}" for suggestion in suggestions],
    ]
    (request_dir / "clarification.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return PromptResult("clarification", reason, request_dir)


def _write_course_clarification(request_dir: Path, prompt: str, courses: list[dict[str, Any]]) -> PromptResult:
    suggestions = [
        f"`{course.get('title')}` -> {course.get('url')}"
        for course in courses
    ]
    return _write_clarification(
        request_dir,
        prompt,
        "Multiple Moodle courses matched the prompt.",
        suggestions=["Specify one course/code, or paste the quiz URL.", *suggestions],
        extra={"course_candidates": courses},
    )


def _write_quiz_clarification(
    request_dir: Path,
    prompt: str,
    course: dict[str, Any],
    quizzes: list[dict[str, Any]],
) -> PromptResult:
    suggestions = [
        f"`{quiz.get('title')}` -> {quiz.get('url')}"
        for quiz in quizzes[:20]
    ]
    return _write_clarification(
        request_dir,
        prompt,
        f"Course `{course.get('title')}` has multiple quizzes and the prompt did not identify which one.",
        suggestions=["Specify the quiz name, or paste the quiz URL.", *suggestions],
        extra={"selected_course": course, "quiz_candidates": quizzes},
    )


def main() -> None:
    parser = argparse.ArgumentParser(prog="study-buddy")
    parser.add_argument("prompt", nargs="+")
    parser.add_argument("--answers")
    parser.add_argument("--auto-answer", action="store_true")
    parser.add_argument(
        "--max-pages",
        type=int,
        default=100,
        help="Safety cap for quiz pages. Defaults to 100 so the whole quiz is attempted until safe navigation stops.",
    )
    args = parser.parse_args()

    answers_path = ROOT / args.answers if args.answers else None
    result = run_prompt(
        " ".join(args.prompt),
        answers_path=answers_path,
        max_pages=args.max_pages,
        auto_answer=args.auto_answer,
    )
    print(f"{result.kind}: {result.message}")
    print(f"Output: {result.output_path}")


if __name__ == "__main__":
    main()
