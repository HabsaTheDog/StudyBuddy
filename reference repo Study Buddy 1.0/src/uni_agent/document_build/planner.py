from __future__ import annotations

from .contracts import DocumentIntent, DocumentPlan, Omission, PlannedSection, SourceChunk, SourceDescriptor, TaskRef
from .template_registry import TemplateSpec


def build_document_plan(
    *,
    intent: DocumentIntent,
    template: TemplateSpec,
    course: dict | None,
    sources: list[SourceDescriptor],
    chunks: list[SourceChunk],
    planned_tasks: list[TaskRef],
    omissions: list[Omission],
    issues: list[dict],
) -> DocumentPlan:
    if template.id == "math_worked_solutions":
        sections = [
            PlannedSection(
                id=f"task-{task.topic or 'x'}-{task.task or 'x'}",
                heading=task.label(),
                kind="worked_solution",
                task_ref=task,
                source_ids=_source_ids_for_task(task, chunks),
                builder_mode="model_required",
                scope=_scope_for_task(intent, task),
            )
            for task in planned_tasks
        ]
        title = "MAES2 Kreuzerl-Übungen" if intent.wants_marked_tasks else "Mathe-Übungslösungen"
    else:
        sections = [
            PlannedSection(
                id=f"source-{source.id}",
                heading=source.title,
                kind="source_summary",
                task_ref=None,
                source_ids=[source.id],
                builder_mode="local_summary",
            )
            for source in sources
            if source.status == "selected"
        ][:12]
        title = template.title
    return DocumentPlan(
        title=title,
        template_id=template.id,
        course=course,
        sections=sections,
        sources=sources,
        chunks=chunks,
        omissions=omissions,
        safety={
            "quiz_access": intent.quiz_access,
            "quiz_opened": False,
            "final_submission_allowed": False,
            "sync_policy": intent.sync_policy,
            "output_fallbacks_allowed": False,
        },
        issues=issues,
    )


def _source_ids_for_task(task: TaskRef, chunks: list[SourceChunk]) -> list[str]:
    ids = []
    for chunk in chunks:
        if task.task is None or f"Aufgabe {task.task}" in chunk.text or f"Aufgabe {task.task:02d}" in chunk.text:
            ids.append(chunk.source_id)
    return sorted(set(ids))


def _scope_for_task(intent: DocumentIntent, task: TaskRef) -> str | None:
    for partial in intent.partial_requirements:
        if partial.task.key == task.key:
            return partial.scope
    return None
