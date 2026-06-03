from __future__ import annotations

from pathlib import Path
from typing import Any

from ..output_runs import copy_artifacts, ensure_run_layout, write_run_manifest, write_source_bundle
from ..storage import ROOT, create_output_run_dir, utc_now, write_json
from .contracts import QuizAccess, SyncPolicy, to_jsonable
from .intent import parse_document_intent
from .planner import build_document_plan
from .renderer import render_document
from .reviewer import review_document
from .section_builder import build_local_document
from .source_resolver import resolve_sources
from .template_registry import get_template


def generate_document_build(
    prompt: str,
    *,
    output_format: str = "markdown+pdf",
    quiz_access: QuizAccess = "ask",
    max_repair_cycles: int = 3,
    live_moodle_read: bool = False,
    template: str | None = "auto",
    sync_policy: SyncPolicy = "require-current",
) -> Path:
    run_dir = create_output_run_dir("document-build", prompt)
    ensure_run_layout(run_dir)
    intent = parse_document_intent(
        prompt,
        requested_template=template,
        output_format=output_format,
        quiz_access=quiz_access,
        sync_policy=sync_policy,
    )
    template_spec = get_template(intent.selected_template)
    write_json(run_dir / "artifacts" / "intent" / "intent.json", to_jsonable(intent))
    write_json(run_dir / "artifacts" / "templates" / "selected-template.json", to_jsonable(template_spec))

    sources, chunks, planned_tasks, omissions, source_issues, course, ambiguous = resolve_sources(intent, run_dir)
    plan = build_document_plan(
        intent=intent,
        template=template_spec,
        course=course,
        sources=sources,
        chunks=chunks,
        planned_tasks=planned_tasks,
        omissions=omissions,
        issues=source_issues,
    )
    write_json(run_dir / "artifacts" / "plan" / "document-plan.json", to_jsonable(plan))
    if ambiguous:
        _write_clarification(run_dir, "Mehrere Kurse passen gleich gut. Bitte Kurs genauer angeben.", ambiguous_courses=ambiguous)
        _finish_without_render(run_dir, plan, status="needs-more-context")
        return run_dir

    preflight_errors = [issue for issue in plan.issues if issue.get("severity") == "error"]
    if preflight_errors:
        _write_missing_sources(run_dir, plan.issues)
        _finish_without_render(run_dir, plan, status="failed-preflight")
        return run_dir

    document = build_local_document(intent, template_spec, plan, run_dir=run_dir)
    review = review_document(intent, template_spec, plan, document)
    write_json(run_dir / "artifacts" / "reviewer" / "review.json", to_jsonable(review))
    _write_review_markdown(run_dir / "REVIEW.md", review)
    if not review.passed:
        _finish_without_render(run_dir, plan, status="failed-review", review=to_jsonable(review))
        return run_dir

    render_result = render_document(document, run_dir, output_format=output_format)
    _write_status(run_dir, "completed", {"render_result": render_result, "review": to_jsonable(review)})
    _finalize(run_dir, plan, status="completed")
    return run_dir


def _finish_without_render(run_dir: Path, plan, *, status: str, review: dict[str, Any] | None = None) -> None:
    payload = {"plan": to_jsonable(plan)}
    if review:
        payload["review"] = review
    _write_status(run_dir, status, payload)
    if not (run_dir / "REVIEW.md").exists():
        _write_review_markdown(
            run_dir / "REVIEW.md",
            type("Report", (), {"passed": False, "issues": plan.issues, "repair_instructions": [], "safety": plan.safety})(),
        )
    _finalize(run_dir, plan, status=status)


def _write_status(run_dir: Path, status: str, extra: dict[str, Any] | None = None) -> None:
    write_json(run_dir / "artifacts" / "requests" / "request.json", {"status": status, "updated_at": utc_now(), **(extra or {})})


def _write_clarification(run_dir: Path, message: str, **extra: Any) -> None:
    lines = ["# Klärung erforderlich", "", message, ""]
    if extra.get("ambiguous_courses"):
        lines.append("## Kandidaten")
        for course in extra["ambiguous_courses"]:
            lines.append(f"- {course.get('title')} ({course.get('url')})")
    (run_dir / "clarification.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _write_missing_sources(run_dir: Path, issues: list[dict[str, Any]]) -> None:
    lines = ["# Quellen fehlen", "", "Der adaptive Dokument-Build wurde vor dem Rendern abgebrochen.", ""]
    for issue in issues:
        lines.append(f"- `{issue.get('code')}`: {issue.get('message')}")
    lines.append("")
    lines.append("Es wurden keine alten `output/**/artifacts/sources` als Fallback verwendet.")
    (run_dir / "missing-sources.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _write_review_markdown(path: Path, report) -> None:
    lines = ["# Review", "", f"Passed: `{str(report.passed).lower()}`", "", "## Issues", ""]
    if not report.issues:
        lines.append("- none")
    for issue in report.issues:
        lines.append(f"- `{issue.get('severity', 'info')}` `{issue.get('code')}`: {issue.get('message')}")
    if report.repair_instructions:
        lines.extend(["", "## Repair Instructions", ""])
        for instruction in report.repair_instructions:
            lines.append(f"- {instruction}")
    lines.extend(["", "## Safety", ""])
    for key, value in report.safety.items():
        lines.append(f"- `{key}`: {value}")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _finalize(run_dir: Path, plan, *, status: str) -> None:
    chunk_source_ids = {chunk.source_id for chunk in plan.chunks}
    sources = [
        {
            "source_id": source.id,
            "title": source.title,
            "kind": "pdf" if str(source.title).lower().endswith(".pdf") else "local_file",
            "path": source.path,
            "url": source.url,
            "page": None,
            "section": source.role,
        }
        for source in plan.sources
        if source.status == "selected" and source.id in chunk_source_ids
    ]
    structured_sources = write_source_bundle(run_dir, sources)
    artifacts = copy_artifacts(
        run_dir,
        [
            ("public", "document-build.pdf"),
            ("public", "document-build.md"),
            ("public", "study-build.pdf"),
            ("public", "study-build.md"),
            ("public", "REVIEW.md"),
            ("public", "clarification.md"),
            ("public", "missing-sources.md"),
            ("metadata", "render-result.json"),
            ("metadata", "run-manifest.json"),
            ("sources", "source-manifest.json"),
        ],
    )
    write_run_manifest(run_dir, run_type="document-build", status=status, artifacts=artifacts, sources=structured_sources)
