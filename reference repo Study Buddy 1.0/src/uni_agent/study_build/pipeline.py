from __future__ import annotations

from pathlib import Path
from typing import Any

from ..output_runs import copy_artifacts, ensure_run_layout, write_run_manifest, write_source_bundle
from ..storage import create_output_run_dir, utc_now, write_json
from .builder import build_document_draft
from .contracts import QuizAccess, ResourceBundle, to_jsonable
from .intent import parse_user_intent
from .renderer import render_draft
from .resource_bundle import build_resource_bundle
from .reviewer import repair_request_from_review, review_document


def generate_study_build(
    prompt: str,
    *,
    output_format: str = "markdown+pdf",
    quiz_access: QuizAccess = "ask",
    max_repair_cycles: int = 3,
    live_moodle_read: bool = False,
) -> Path:
    run_dir = create_output_run_dir("study-build", prompt)
    ensure_run_layout(run_dir)
    intent = parse_user_intent(prompt, quiz_access=quiz_access, max_repair_cycles=max_repair_cycles)
    write_json(run_dir / "artifacts" / "intent" / "user-intent.json", to_jsonable(intent))
    bundle, ambiguous_courses = build_resource_bundle(intent)
    write_json(run_dir / "artifacts" / "resources" / "resource-bundle.json", to_jsonable(bundle))
    write_json(run_dir / "artifacts" / "resources" / "resource-plan.json", _resource_plan(bundle))
    write_json(run_dir / "artifacts" / "quiz" / "quiz-permission.json", bundle.quiz_permission)
    if ambiguous_courses:
        _write_status(run_dir, "needs-more-context", {"ambiguous_courses": ambiguous_courses})
        _write_clarification(run_dir, "Mehrere Kurse passen gleich gut. Bitte Kurs genauer angeben.", ambiguous_courses=ambiguous_courses)
        _finalize(run_dir, bundle, status="needs-more-context")
        return run_dir
    if bundle.quiz_permission.get("status") == "needs-user-authorization":
        _write_status(run_dir, "needs-quiz-authorization", {"quiz_permission": bundle.quiz_permission})
        _write_clarification(run_dir, str(bundle.quiz_permission.get("message") or "Quiz authorization required."))
        _finalize(run_dir, bundle, status="needs-quiz-authorization")
        return run_dir
    repair_request: dict[str, Any] | None = None
    final_report = None
    final_render_result: dict[str, Any] = {"ok": False, "reason": "not-rendered", "pdf_attempted": output_format in {"markdown+pdf", "pdf"}}
    for cycle in range(1, max(1, max_repair_cycles + 1) + 1):
        draft = build_document_draft(bundle, run_dir, cycle=cycle, repair_request=repair_request)
        final_render_result = render_draft(draft, run_dir, output_format=output_format)
        final_report = review_document(bundle=bundle, draft=draft, render_result=final_render_result, run_dir=run_dir, cycle=cycle)
        if final_report.passed:
            _write_status(run_dir, "completed", {"render_result": final_render_result, "review": to_jsonable(final_report)})
            _finalize(run_dir, bundle, status="completed")
            return run_dir
        repair_request = repair_request_from_review(final_report)
        write_json(run_dir / "artifacts" / "reviewer" / f"repair-request.v{cycle}.json", repair_request)
    _write_status(run_dir, "failed-review", {"render_result": final_render_result, "review": to_jsonable(final_report) if final_report else None})
    _finalize(run_dir, bundle, status="failed-review")
    return run_dir


def _resource_plan(bundle: ResourceBundle) -> dict[str, Any]:
    return {
        "created_at": utc_now(),
        "selected_course": bundle.selected_course,
        "resources": [to_jsonable(resource) for resource in bundle.resources],
        "coverage_matrix": bundle.coverage_matrix,
        "omissions": bundle.omissions,
        "chunk_count": len(bundle.source_chunks),
    }


def _write_status(run_dir: Path, status: str, extra: dict[str, Any] | None = None) -> None:
    write_json(run_dir / "artifacts" / "requests" / "request.json", {"status": status, "updated_at": utc_now(), **(extra or {})})


def _write_clarification(run_dir: Path, message: str, **extra: Any) -> None:
    lines = ["# Klärung erforderlich", "", message, ""]
    if extra.get("ambiguous_courses"):
        lines.append("## Kandidaten")
        for course in extra["ambiguous_courses"]:
            lines.append(f"- {course.get('title')} ({course.get('url')})")
    (run_dir / "clarification.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _finalize(run_dir: Path, bundle: ResourceBundle, *, status: str) -> None:
    chunk_source_ids = {chunk.source_id for chunk in bundle.source_chunks}
    sources = [
        {
            "source_id": resource.id,
            "title": resource.title,
            "kind": "pdf" if str(resource.title).lower().endswith(".pdf") else "local_file",
            "path": resource.path,
            "url": resource.url,
            "page": None,
            "section": resource.role,
        }
        for resource in bundle.resources
        if resource.status == "selected" and resource.id in chunk_source_ids
    ]
    structured_sources = write_source_bundle(run_dir, sources)
    artifacts = copy_artifacts(
        run_dir,
        [
            ("public", "study-build.pdf"),
            ("public", "study-build.md"),
            ("public", "REVIEW.md"),
            ("public", "clarification.md"),
            ("metadata", "render-result.json"),
            ("metadata", "run-manifest.json"),
            ("sources", "source-manifest.json"),
        ],
    )
    write_run_manifest(
        run_dir,
        run_type="study-build",
        status=status,
        artifacts=artifacts,
        sources=structured_sources,
    )
