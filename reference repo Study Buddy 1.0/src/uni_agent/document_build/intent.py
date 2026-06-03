from __future__ import annotations

import re

from .contracts import DocumentIntent, PartialRequirement, QuizAccess, SyncPolicy, TaskRef
from .template_registry import template_ids


def parse_document_intent(
    prompt: str,
    *,
    requested_template: str | None = None,
    output_format: str = "markdown+pdf",
    quiz_access: QuizAccess = "ask",
    sync_policy: SyncPolicy = "require-current",
) -> DocumentIntent:
    prompt_clean = " ".join(prompt.split())
    lower = prompt_clean.casefold()
    selected_template = _select_template(lower, requested_template)
    partials = _extract_partials(prompt_clean)
    exclusions = _extract_exclusions(prompt_clean, partials=partials)
    requested_tasks = _extract_requested_tasks(prompt_clean, exclusions=exclusions, partials=partials)
    requested_topics = _extract_topics(prompt_clean, exclusions, partials, requested_tasks)
    wants_marked_tasks = any(term in lower for term in ["kreuzerl", "häkchen", "haekchen", "angekreuz", "markiert"])
    wants_worked_solutions = selected_template == "math_worked_solutions" or any(term in lower for term in ["lös", "loes", "rechne", "bearbeite"])
    wants_quiz_style = any(term in lower for term in ["quiz", "quizzes", "moodle-fragen", "testfragen", "selbsttest"])
    return DocumentIntent(
        prompt=prompt_clean,
        language="de" if _looks_german(lower) else "en",
        requested_template=requested_template,
        selected_template=selected_template,
        course_hint=_course_hint(prompt_clean),
        target_course_id=_course_id(prompt_clean),
        requested_topics=requested_topics,
        requested_tasks=requested_tasks,
        exclusions=exclusions,
        partial_requirements=partials,
        wants_marked_tasks=wants_marked_tasks,
        wants_worked_solutions=wants_worked_solutions,
        wants_pdf=output_format in {"markdown+pdf", "pdf"},
        wants_quiz_style=wants_quiz_style,
        quiz_access=quiz_access,
        sync_policy=sync_policy,
    )


def _select_template(lower: str, requested_template: str | None) -> str:
    if requested_template and requested_template != "auto":
        if requested_template not in template_ids():
            raise ValueError(f"Unknown template: {requested_template}")
        return requested_template
    if any(term in lower for term in ["kreuzerl", "häkchen", "haekchen", "übungsblatt", "uebungsblatt"]) or re.search(r"\b\d{1,2}/\d{1,2}\b", lower):
        return "math_worked_solutions"
    if any(term in lower for term in ["formelsammlung", "formelblatt", "spickzettel", "cheat sheet"]):
        return "formula_sheet"
    if any(term in lower for term in ["aufgabenstellung", "assignment", "abgabe", "brief"]):
        return "assignment_brief"
    if any(term in lower for term in ["quizfragen", "testfragen", "selbsttest", "moodle-fragen"]):
        return "quiz_safe_review"
    if any(term in lower for term in ["theorie", "theorieteil", "vollständig", "vollstaendig"]):
        return "theory_summary"
    return "study_guide"


def _extract_exclusions(prompt: str, *, partials: list[PartialRequirement]) -> list[TaskRef]:
    refs: list[TaskRef] = []
    partial_keys = {item.task.key for item in partials}
    lower = prompt.casefold()
    exclusion_spans = []
    exclusion_terms = r"(?:ausnehmen|nicht mehr machen|nicht machen|ausgelassen|überspring|ueberspring|skip)"
    for sentence in re.finditer(r"[^.;!?]+[.;!?]?", lower):
        if re.search(exclusion_terms, sentence.group(0)):
            exclusion_spans.append((sentence.start(), sentence.end()))
    for match in re.finditer(exclusion_terms, lower):
        end = lower.find(".", match.end())
        if end < 0:
            end = min(len(lower), match.end() + 180)
        exclusion_spans.append((match.start(), end))
    for match in re.finditer(r"(?:thema\s*)?(\d{1,3})\s*/\s*(\d{1,3})", prompt, flags=re.IGNORECASE):
        ref = TaskRef(topic=int(match.group(1)), task=int(match.group(2)), raw=match.group(0))
        if ref.key in partial_keys:
            continue
        if any(start <= match.start() <= end for start, end in exclusion_spans):
            refs.append(ref)
    return _dedupe_refs(refs)


def _extract_partials(prompt: str) -> list[PartialRequirement]:
    partials: list[PartialRequirement] = []
    for sentence in re.split(r"[.;]\s*", prompt):
        lower = sentence.casefold()
        if not any(term in lower for term in ["genügt", "genuegt", "nur"]):
            continue
        for pair in re.finditer(r"(\d{1,3})\s*/\s*(\d{1,3})", sentence):
            tail = sentence[pair.end() :]
            scope_match = re.search(r"(?:genügt|genuegt|nur)\s+(.+)$", tail, flags=re.IGNORECASE)
            if not scope_match:
                continue
            prefix = tail[: scope_match.start()].casefold()
            if re.search(r"\d{1,3}\s*/\s*\d{1,3}", prefix) or any(term in prefix for term in ["nicht mehr machen", "nicht machen", "ausnehmen"]):
                continue
            scope = scope_match.group(1).strip(" ,")
            partials.append(PartialRequirement(task=TaskRef(topic=int(pair.group(1)), task=int(pair.group(2)), raw=pair.group(0)), scope=scope, raw=sentence.strip()))
    return partials


def _extract_requested_tasks(prompt: str, *, exclusions: list[TaskRef], partials: list[PartialRequirement]) -> list[TaskRef]:
    excluded = {item.key for item in exclusions}
    partial_keys = {item.task.key for item in partials}
    refs: list[TaskRef] = []
    for match in re.finditer(r"(?:thema\s*)?(\d{1,3})\s*/\s*(\d{1,3})", prompt, flags=re.IGNORECASE):
        ref = TaskRef(topic=int(match.group(1)), task=int(match.group(2)), raw=match.group(0))
        if ref.key in excluded:
            continue
        if ref.key in partial_keys or not _looks_like_exclusion_context(prompt, match.start()):
            refs.append(ref)
    sheet_task = re.search(r"(?:aufgabe|beispiel|bsp\.?)\s*0*(\d{1,3}).{0,40}?(?:übungsblatt|uebungsblatt|thema|ue)\s*0*(\d{1,3})", prompt, flags=re.IGNORECASE)
    if sheet_task:
        refs.append(TaskRef(topic=int(sheet_task.group(2)), task=int(sheet_task.group(1)), raw=sheet_task.group(0)))
    return _dedupe_refs(refs)


def _extract_topics(prompt: str, exclusions: list[TaskRef], partials: list[PartialRequirement], requested_tasks: list[TaskRef]) -> list[int]:
    topics = {ref.topic for ref in exclusions + requested_tasks if ref.topic is not None}
    topics.update(partial.task.topic for partial in partials if partial.task.topic is not None)
    for match in re.finditer(r"\bthema\s*0*(\d{1,3})\b", prompt, flags=re.IGNORECASE):
        topics.add(int(match.group(1)))
    return sorted(topic for topic in topics if topic is not None)


def _looks_like_exclusion_context(prompt: str, index: int) -> bool:
    window = prompt[max(0, index - 90) : index + 90].casefold()
    return any(term in window for term in ["ausnehmen", "nicht mehr machen", "nicht machen", "überspring", "ueberspring", "skip"])


def _dedupe_refs(refs: list[TaskRef]) -> list[TaskRef]:
    seen: set[tuple[int | None, int | None]] = set()
    result: list[TaskRef] = []
    for ref in refs:
        if ref.key in seen:
            continue
        seen.add(ref.key)
        result.append(ref)
    return result


def _looks_german(lower: str) -> bool:
    return any(term in lower for term in ["thema", "aufgabe", "lös", "loes", "prüfung", "pruefung", "moodle", "formel", "lern"])


def _course_hint(prompt: str) -> str | None:
    match = re.search(r"\b(elektrotechnik\s*[12]|et\s*[12]|dynamik\s*[12]|dyn\s*[12]|mathematik|mathe|maes\s*[12]|maes2)\b", prompt, flags=re.IGNORECASE)
    return " ".join(match.group(1).split()) if match else None


def _course_id(prompt: str) -> str | None:
    match = re.search(r"\b\d{5,6}\b", prompt)
    return match.group(0) if match else None
