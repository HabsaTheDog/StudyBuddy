from __future__ import annotations

from .contracts import ResourceBundle, ResourceDescriptor, SourceChunk, UserIntent
from .quiz_permission import quiz_permission_for_intent
from .resource_tools import discover_document_resources, quiz_resource_descriptor, select_course


def build_resource_bundle(intent: UserIntent) -> tuple[ResourceBundle, list[dict]]:
    selected_course, ambiguous = select_course(intent)
    permission = quiz_permission_for_intent(intent)
    resources: list[ResourceDescriptor] = []
    chunks: list[SourceChunk] = []
    if not ambiguous:
        resources, chunks = discover_document_resources(intent, selected_course)
    resources.extend(quiz_resource_descriptor(intent, permission))
    coverage = _coverage(intent, chunks, permission)
    omissions = [
        {
            "resource_id": resource.id,
            "title": resource.title,
            "role": resource.role,
            "reason": resource.reason,
            "safety_note": resource.safety_note,
        }
        for resource in resources
        if resource.status in {"available_not_used", "authorization_required", "excluded"}
    ]
    return (
        ResourceBundle(
            intent=intent,
            selected_course=selected_course,
            resources=resources,
            source_chunks=chunks,
            quiz_permission=permission,
            coverage_matrix=coverage,
            omissions=omissions,
        ),
        ambiguous,
    )


def _coverage(intent: UserIntent, chunks: list[SourceChunk], permission: dict[str, object]) -> list[dict[str, object]]:
    source_ids = sorted({chunk.source_id for chunk in chunks})
    quiz_source_ids = sorted({chunk.source_id for chunk in chunks if chunk.role == "quiz_style_source"})
    rows: list[dict[str, object]] = [
        {
            "requirement": "theory_summary",
            "status": "covered" if chunks else "missing",
            "source_ids": source_ids,
        }
    ]
    if "worked_solution" in intent.required_sections:
        rows[0] = {
            "requirement": "worked_solution",
            "status": "covered" if chunks else "missing",
            "source_ids": source_ids,
            "note": "Requires a matching worksheet/source page and a generated worked solution.",
        }
    if intent.wants_quiz_style:
        rows.append(
            {
                "requirement": "quiz_questions",
                "status": "covered" if quiz_source_ids else "partial",
                "source_ids": quiz_source_ids,
                "note": "No quiz pages opened without explicit user authorization." if not permission.get("allowed") else "Quiz access authorized; no quiz content was collected unless listed in source_ids.",
            }
        )
    if intent.wants_solutions_at_end:
        rows.append({"requirement": "solutions_at_end", "status": "covered", "source_ids": source_ids[:6]})
    return rows
