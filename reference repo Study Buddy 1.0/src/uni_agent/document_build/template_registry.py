from __future__ import annotations

from .contracts import TemplateSpec


TEMPLATES: dict[str, TemplateSpec] = {
    "math_worked_solutions": TemplateSpec(
        id="math_worked_solutions",
        title="Mathe-Übungslösungen",
        description="Gelöste Mathematik-Übungsaufgaben mit Quellen und kurzen Erklärungen.",
        supported_goals=["worked_solution", "marked_exercises"],
        required_source_roles=["exercise"],
        optional_source_roles=["formula_sheet", "theory"],
        section_strategy="one_section_per_task",
        renderer="math_worked_solutions",
        review_profile="math_worked_solutions",
        requires_model_builder=True,
        allows_local_builder=False,
    ),
    "study_guide": TemplateSpec(
        id="study_guide",
        title="Lernzettel",
        description="Strukturierter Lernzettel mit Kernaussagen, Formeln und kurzen Checks.",
        supported_goals=["study_guide"],
        required_source_roles=["theory"],
        optional_source_roles=["exercise", "formula_sheet"],
        section_strategy="source_summary",
        renderer="study_guide",
        review_profile="sourced_summary",
        requires_model_builder=False,
        allows_local_builder=True,
    ),
    "formula_sheet": TemplateSpec(
        id="formula_sheet",
        title="Formelsammlung",
        description="Kompakte Formelsammlung mit Bedeutung, Bedingungen und Quellen.",
        supported_goals=["formula_sheet"],
        required_source_roles=["formula_sheet", "theory"],
        optional_source_roles=["exercise"],
        section_strategy="formula_summary",
        renderer="formula_sheet",
        review_profile="sourced_summary",
        requires_model_builder=False,
        allows_local_builder=True,
    ),
    "theory_summary": TemplateSpec(
        id="theory_summary",
        title="Theorie-Zusammenfassung",
        description="Quellenbasierte Zusammenfassung von Theorieunterlagen.",
        supported_goals=["theory_summary"],
        required_source_roles=["theory"],
        optional_source_roles=["formula_sheet", "exercise"],
        section_strategy="source_summary",
        renderer="theory_summary",
        review_profile="sourced_summary",
        requires_model_builder=False,
        allows_local_builder=True,
    ),
    "assignment_brief": TemplateSpec(
        id="assignment_brief",
        title="Aufgabenbrief",
        description="Extraktion von Abgabezielen, Aufgaben, Deliverables und Fristen.",
        supported_goals=["assignment_brief"],
        required_source_roles=["assignment"],
        optional_source_roles=["theory"],
        section_strategy="source_summary",
        renderer="assignment_brief",
        review_profile="sourced_summary",
        requires_model_builder=False,
        allows_local_builder=True,
    ),
    "quiz_safe_review": TemplateSpec(
        id="quiz_safe_review",
        title="Quiz-sichere Übungsfragen",
        description="Sicherer quellenbasierter Quiz-Review ohne Öffnen echter Quizseiten ohne Freigabe.",
        supported_goals=["quiz_safe_review"],
        required_source_roles=["theory"],
        optional_source_roles=["exercise", "formula_sheet"],
        section_strategy="source_summary",
        renderer="quiz_safe_review",
        review_profile="quiz_safe_review",
        requires_model_builder=False,
        allows_local_builder=True,
    ),
}


def get_template(template_id: str) -> TemplateSpec:
    try:
        return TEMPLATES[template_id]
    except KeyError as exc:
        raise ValueError(f"Unknown document template: {template_id}") from exc


def template_ids() -> list[str]:
    return sorted(TEMPLATES)
