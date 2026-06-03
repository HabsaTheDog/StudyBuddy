from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..documents import download_course_materials, refresh_document_index
from ..knowledge import load_synced_courses
from ..storage import ROOT, read_json, slugify, utc_now
from ..study_build.course_routing import rank_courses
from ..study_build.resource_tools import classify_resource_role
from .contracts import DocumentIntent, Omission, SourceChunk, SourceDescriptor, TaskRef
from .math_marks import detect_marked_tasks


def select_course(intent: DocumentIntent) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    courses = load_synced_courses(refresh_if_missing=True)
    if intent.target_course_id:
        exact = [course for course in courses if str(course.get("id") or course.get("course_id") or "") == intent.target_course_id]
        if exact:
            return exact[0], []
    ranked = rank_courses(intent.prompt, courses)
    if not ranked:
        return None, []
    if len(ranked) > 1 and ranked[0]["score"] == ranked[1]["score"]:
        return None, ranked[:5]
    selected = dict(ranked[0])
    selected.pop("score", None)
    return selected, []


def resolve_sources(intent: DocumentIntent, run_dir: Path) -> tuple[list[SourceDescriptor], list[SourceChunk], list[TaskRef], list[Omission], list[dict[str, Any]], dict[str, Any] | None, list[dict[str, Any]]]:
    course, ambiguous = select_course(intent)
    if ambiguous:
        return [], [], [], [], [{"severity": "error", "code": "ambiguous-course", "message": "Mehrere Kurse passen gleich gut."}], None, ambiguous
    if not course:
        return [], [], [], [], [{"severity": "error", "code": "course-not-found", "message": "Kein passender Moodle-Kurs gefunden."}], None, []

    documents = _matching_documents(course)
    sync_info = None
    if _needs_targeted_sync(intent, documents) and intent.sync_policy == "require-current":
        sync_info = {"started_at": utc_now(), "course": course.get("title"), "policy": "require-current"}
        download_course_materials(course, download_limit=80, max_bytes=100_000_000)
        refresh_document_index()
        documents = _matching_documents(course)
        sync_info["finished_at"] = utc_now()
        sync_info["matching_documents_after_sync"] = len(documents)

    if not documents:
        code = "sources-missing-after-sync" if intent.sync_policy == "require-current" else "sources-missing-current-index"
        message = (
            "Keine passenden Kursquellen nach gezieltem Moodle-Sync gefunden."
            if intent.sync_policy == "require-current"
            else "Keine passenden Kursquellen im aktuellen Moodle-/Materialindex gefunden; Sync wurde durch Policy nicht gestartet."
        )
        return [], [], [], [], [{"severity": "error", "code": code, "message": message}], course, []

    if intent.selected_template == "math_worked_solutions":
        return _resolve_math_sources(intent, course, documents, run_dir, sync_info)
    return _resolve_general_sources(intent, course, documents, sync_info)


def _resolve_general_sources(intent: DocumentIntent, course: dict[str, Any], documents: list[dict[str, Any]], sync_info: dict[str, Any] | None):
    resources: list[SourceDescriptor] = []
    chunks: list[SourceChunk] = []
    source_index = 1
    for document in documents:
        title = str(document.get("name") or Path(str(document.get("path") or "")).name)
        role = classify_resource_role(title, str(document.get("path") or ""))
        if role == "datasheet":
            resources.append(SourceDescriptor(id=f"S{source_index}", title=title, role=role, status="available_not_used", path=document.get("path"), reason="Datasheets are excluded unless explicitly requested."))
            source_index += 1
            continue
        source_id = f"S{source_index}"
        resources.append(SourceDescriptor(id=source_id, title=title, role=role, status="selected", path=document.get("path"), page_count=len(document.get("pages") or []), reason="Selected for template source coverage."))
        for page in (document.get("pages") or [])[:4]:
            text = _trim(str(page.get("text") or ""))
            if not text:
                continue
            chunks.append(SourceChunk(source_id=source_id, title=title, role=role, path=document.get("path"), page=page.get("page"), text=text))
        source_index += 1
        if len(chunks) >= 30:
            break
    issues = [] if chunks else [{"severity": "error", "code": "source-text-missing", "message": "Passende Dateien wurden gefunden, aber kein extrahierbarer Text."}]
    return resources, chunks, [], [], issues, course, []


def _resolve_math_sources(intent: DocumentIntent, course: dict[str, Any], documents: list[dict[str, Any]], run_dir: Path, sync_info: dict[str, Any] | None):
    topics = intent.requested_topics
    explicit_tasks = list(intent.requested_tasks)
    resources: list[SourceDescriptor] = []
    chunks: list[SourceChunk] = []
    planned_tasks: list[TaskRef] = []
    omissions: list[Omission] = [Omission(label=ref.label(), reason="Vom User ausgeschlossen.") for ref in intent.exclusions]
    issues: list[dict[str, Any]] = []
    source_index = 1
    for document in documents:
        topic = _topic_for_document(document)
        if topics and topic not in topics:
            continue
        if topic is None and topics:
            continue
        source_id = f"S{source_index}"
        title = str(document.get("name") or Path(str(document.get("path") or "")).name)
        resources.append(SourceDescriptor(id=source_id, title=title, role="exercise", status="selected", path=document.get("path"), page_count=len(document.get("pages") or []), reason="Selected as worksheet source."))
        selected_for_doc: list[TaskRef] = [task for task in explicit_tasks if task.topic == topic]
        if intent.wants_marked_tasks and topic is not None:
            local_path = ROOT / str(document.get("path") or "")
            if local_path.exists():
                marked = detect_marked_tasks(local_path, topic, run_dir / "artifacts" / "rendered")
                selected_for_doc.extend(item.task for item in marked if item.confidence >= 0.75)
            else:
                issues.append({"severity": "error", "code": "worksheet-file-missing", "message": f"Worksheet file not found: {document.get('path')}"})
        selected_for_doc = _apply_exclusions(selected_for_doc, intent.exclusions)
        planned_tasks.extend(selected_for_doc)
        for task in selected_for_doc:
            task_text = _extract_task_text(document, task.task)
            if not task_text:
                issues.append({"severity": "error", "code": "task-text-missing", "message": f"{task.label()} konnte nicht aus {title} extrahiert werden."})
                continue
            chunks.append(SourceChunk(source_id=source_id, title=title, role="exercise", path=document.get("path"), page=_page_for_task(document, task.task), text=task_text))
        source_index += 1
    if topics:
        available_topics = {topic for topic in (_topic_for_document(document) for document in documents) if topic is not None}
        missing_topics = sorted(set(topics) - available_topics)
        if missing_topics:
            code = "topic-sources-missing-after-sync" if intent.sync_policy == "require-current" else "topic-sources-missing-current-index"
            issues.append({"severity": "error", "code": code, "message": f"Keine aktuellen Übungsblattquellen für Thema {', '.join(str(item) for item in missing_topics)} gefunden."})
    planned_tasks = _dedupe_tasks(planned_tasks)
    if intent.wants_marked_tasks and not planned_tasks:
        issues.append({"severity": "error", "code": "marked-tasks-not-detected", "message": "Keine markierten Kreuzerl-Aufgaben mit ausreichender Sicherheit erkannt."})
    if explicit_tasks and not all(task.key in {item.key for item in planned_tasks} for task in explicit_tasks):
        issues.append({"severity": "error", "code": "explicit-task-not-found", "message": "Nicht alle explizit angeforderten Aufgaben wurden in aktuellen Quellen gefunden."})
    return resources, chunks, planned_tasks, omissions, issues, course, []


def _matching_documents(course: dict[str, Any]) -> list[dict[str, Any]]:
    index = read_json(ROOT / "state" / "document_index.json", default={})
    documents = index.get("documents", []) if isinstance(index, dict) else []
    course_title = str(course.get("title") or course.get("course_title") or "")
    course_id = str(course.get("id") or course.get("course_id") or "")
    title_slug = slugify(course_title)
    tokens = [token for token in [course_id, "maes2" if "maes2" in course_title.casefold() else "", "et2" if "et2" in course_title.casefold() else "", "dyn2" if "dyn2" in course_title.casefold() else ""] if token]
    matches = []
    for document in documents:
        path = str(document.get("path") or "")
        haystack = f"{path} {document.get('name') or ''}".casefold()
        if course_id and course_id in haystack:
            matches.append(document)
            continue
        if any(token.casefold() in haystack for token in tokens):
            matches.append(document)
            continue
        if title_slug and title_slug in slugify(path):
            matches.append(document)
    return matches


def _needs_targeted_sync(intent: DocumentIntent, documents: list[dict[str, Any]]) -> bool:
    if not documents:
        return True
    if intent.selected_template == "math_worked_solutions" and intent.requested_topics:
        available_topics = {topic for topic in (_topic_for_document(document) for document in documents) if topic is not None}
        return not set(intent.requested_topics).issubset(available_topics)
    return False


def _topic_for_document(document: dict[str, Any]) -> int | None:
    haystack = f"{document.get('name') or ''} {document.get('path') or ''}"
    match = re.search(r"(?:MAES2[_-]?UE|ue)\s*0*(\d{1,3})", haystack, flags=re.IGNORECASE)
    if match:
        return int(match.group(1))
    for page in (document.get("pages") or [])[:2]:
        match = re.search(r"\bThema\s*0*(\d{1,3})\b", str(page.get("text") or ""), flags=re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


def _extract_task_text(document: dict[str, Any], task_number: int | None) -> str:
    if task_number is None:
        return _trim(" ".join(str(page.get("text") or "") for page in document.get("pages") or []))
    text = " ".join(str(page.get("text") or "") for page in document.get("pages") or [])
    cleaned = " ".join(text.split())
    match = re.search(rf"(Aufgabe\s*0*{task_number}\b.*?)(?=\s+Aufgabe\s+\d+\b|$)", cleaned, flags=re.IGNORECASE)
    return _trim(match.group(1) if match else "")


def _page_for_task(document: dict[str, Any], task_number: int | None) -> int | None:
    if task_number is None:
        return None
    for page in document.get("pages") or []:
        if re.search(rf"\bAufgabe\s*0*{task_number}\b", str(page.get("text") or ""), flags=re.IGNORECASE):
            return page.get("page")
    return None


def _apply_exclusions(tasks: list[TaskRef], exclusions: list[TaskRef]) -> list[TaskRef]:
    excluded = {item.key for item in exclusions}
    return [task for task in tasks if task.key not in excluded]


def _dedupe_tasks(tasks: list[TaskRef]) -> list[TaskRef]:
    seen: set[tuple[int | None, int | None]] = set()
    result = []
    for task in tasks:
        if task.key in seen:
            continue
        seen.add(task.key)
        result.append(task)
    return sorted(result, key=lambda item: (item.topic or 0, item.task or 0))


def _trim(value: str, limit: int = 2200) -> str:
    text = re.sub(r"\s+", " ", value).strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip() + " ..."
