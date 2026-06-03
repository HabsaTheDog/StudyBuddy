from __future__ import annotations

from .contracts import BuiltDocument, DocumentIntent, DocumentPlan, ReviewReport
from .template_registry import TemplateSpec


def review_document(intent: DocumentIntent, template: TemplateSpec, plan: DocumentPlan, document: BuiltDocument | None) -> ReviewReport:
    issues = list(plan.issues)
    instructions: list[str] = []
    if not plan.sources:
        issues.append({"severity": "error", "code": "sources-missing", "message": "No current Moodle/material sources were selected."})
        instructions.append("Run targeted Moodle sync for the selected course and rebuild.")
    if not plan.chunks and not any(issue.get("code") == "sources-missing-after-sync" for issue in issues):
        issues.append({"severity": "error", "code": "source-chunks-missing", "message": "No source text chunks were available."})
    if template.id == "math_worked_solutions":
        if not plan.sections:
            issues.append({"severity": "error", "code": "math-tasks-missing", "message": "No math tasks were planned."})
        if template.requires_model_builder:
            if document and any("model-provider-required" in section.risk_flags for section in document.sections):
                issues.append({"severity": "error", "code": "model-provider-required", "message": "Math worked solutions require a model builder; no placeholder PDF was produced."})
                instructions.append("Configure a document section builder provider before rendering worked math solutions.")
    if document:
        for section in document.sections:
            if not section.source_ids:
                issues.append({"severity": "error", "code": "uncited-section", "message": f"Section has no sources: {section.heading}"})
            if any("Nicht ausreichend Quellen" in item or "Fallback" in item for item in section.body):
                issues.append({"severity": "error", "code": "placeholder-content", "message": f"Placeholder content in section: {section.heading}"})
    passed = not any(issue.get("severity") == "error" for issue in issues)
    return ReviewReport(
        passed=passed,
        issues=issues,
        repair_instructions=instructions,
        safety={
            **plan.safety,
            "quiz_opened": False,
            "final_submission_allowed": False,
            "output_fallbacks_allowed": False,
        },
    )
