from __future__ import annotations

import re

from .contracts import QuizAccess, UserIntent


def parse_user_intent(
    prompt: str,
    *,
    quiz_access: QuizAccess,
    max_repair_cycles: int,
) -> UserIntent:
    prompt_clean = " ".join(prompt.split())
    lower = prompt_clean.casefold()
    language = "de" if _looks_german(lower) else "en"
    wants_quiz_style = any(term in lower for term in ["quiz", "quizzes", "quizez", "moodle", "theoriefragen", "selbsttest", "fragen"])
    wants_solutions_at_end = any(term in lower for term in ["lösung", "loesung", "lösungen", "loesungen", "answers", "solutions"]) and any(
        term in lower for term in ["ende", "ganz am ende", "at the end", "schluss"]
    )
    wants_complete_theory = any(term in lower for term in ["gesamten theorieteil", "gesamte theorie", "vollständig", "vollstaendig", "complete theory", "entire theory"])
    requested_sheet_number = _requested_sheet_number(lower)
    requested_task_number = _requested_task_number(lower)
    required_sections = ["theory_summary"]
    if requested_sheet_number is not None or requested_task_number is not None:
        required_sections = ["worked_solution"]
    if wants_quiz_style:
        required_sections.append("quiz_questions")
    if wants_solutions_at_end:
        required_sections.append("solutions_at_end")
    course_hint = _course_hint(prompt_clean)
    return UserIntent(
        prompt=prompt_clean,
        goal="complete_theory_summary" if wants_complete_theory else "study_build_document",
        artifact_type="pdf_study_guide",
        language=language,
        course_hint=course_hint,
        audience="FH Technikum Wien student",
        required_sections=required_sections,
        wants_quiz_style=wants_quiz_style,
        wants_solutions_at_end=wants_solutions_at_end,
        wants_complete_theory=wants_complete_theory,
        quiz_access=quiz_access,
        max_repair_cycles=max(0, max_repair_cycles),
        requested_sheet_number=requested_sheet_number,
        requested_task_number=requested_task_number,
    )


def _looks_german(lower: str) -> bool:
    return any(term in lower for term in ["fach", "zusammen", "theorie", "lös", "loes", "fragen", "damit", "wissen", "prüf", "moodle"])


def _course_hint(prompt: str) -> str | None:
    match = re.search(r"\b(elektrotechnik\s*[12]|et\s*[12]|dynamik\s*[12]|dyn\s*[12]|mathematik|mathe)\b", prompt, flags=re.IGNORECASE)
    return " ".join(match.group(1).split()) if match else None


def _requested_sheet_number(lower: str) -> int | None:
    patterns = [
        r"\b(?:übungsblatt|uebungsblatt|arbeitsblatt|blatt)\s*0*(\d{1,3})\b",
        r"\b(?:übung|uebung|ue)\s*0*(\d{1,3})\b",
        r"\b(?:thema)\s*0*(\d{1,3})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, lower)
        if match:
            return int(match.group(1))
    return None


def _requested_task_number(lower: str) -> int | None:
    match = re.search(r"\b(?:aufgabe|beispiel|bsp\.?)\s*0*(\d{1,3})\b", lower)
    return int(match.group(1)) if match else None
