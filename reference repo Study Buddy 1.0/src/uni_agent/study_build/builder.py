from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..storage import utc_now, write_json
from .contracts import DocumentDraft, DocumentSection, LayoutSpec, QuizQuestion, ResourceBundle, SourceChunk, to_jsonable
from .model_runner import run_optional_model


def build_document_draft(bundle: ResourceBundle, run_dir: Path, *, cycle: int = 1, repair_request: dict[str, Any] | None = None) -> DocumentDraft:
    packet = {
        "created_at": utc_now(),
        "task": "build_study_pdf_draft",
        "role": "specialized_pdf_builder",
        "rules": [
            "Use only the provided resource bundle.",
            "Adapt layout to the user's purpose and content density.",
            "Return cited content only. Use source_ids from source_map.",
            "If required_sections contains worked_solution, solve the requested worksheet/task directly; do not produce a generic theory summary.",
            "For worked_solution, cite the matching worksheet source and explicitly address the requested sheet/task numbers from bundle.intent.",
            "If quiz access was not authorized, do not claim real Moodle quiz extraction; approximate quiz style from theory sources only.",
            "Put solutions at the very end when requested.",
        ],
        "bundle": to_jsonable(bundle),
        "repair_request": repair_request,
    }
    result = run_optional_model(
        command_env="STUDY_BUILD_BUILDER_COMMAND",
        packet=packet,
        packet_path=run_dir / "artifacts" / "builder" / f"packet.v{cycle}.json",
        response_path=run_dir / "artifacts" / "builder" / f"response.v{cycle}.json",
        transcript_path=run_dir / "artifacts" / "builder" / f"transcript.v{cycle}.json",
    )
    if result.get("ok") and isinstance(result.get("parsed"), dict):
        try:
            draft = _draft_from_model_response(result["parsed"], bundle)
            write_json(run_dir / "artifacts" / "builder" / f"normalized-draft.v{cycle}.json", to_jsonable(draft))
            return draft
        except Exception as exc:
            write_json(run_dir / "artifacts" / "builder" / f"normalization-error.v{cycle}.json", {"error": str(exc), "parsed": result.get("parsed")})
    draft = _local_builder_draft(bundle, repair_request=repair_request)
    write_json(run_dir / "artifacts" / "builder" / f"normalized-draft.v{cycle}.json", to_jsonable(draft))
    return draft


def _draft_from_model_response(payload: dict[str, Any], bundle: ResourceBundle) -> DocumentDraft:
    layout_payload = payload.get("layout") if isinstance(payload.get("layout"), dict) else {}
    sections = [
        DocumentSection(
            heading=str(item.get("heading") or "Abschnitt"),
            body=[str(value) for value in item.get("body", []) if str(value).strip()] if isinstance(item.get("body"), list) else [str(item.get("body") or "")],
            source_ids=[str(value) for value in item.get("source_ids", []) if str(value).strip()] if isinstance(item.get("source_ids"), list) else [],
        )
        for item in payload.get("sections", [])
        if isinstance(item, dict)
    ]
    quiz_questions = [
        QuizQuestion(
            id=str(item.get("id") or f"Q{index}"),
            question_type=str(item.get("question_type") or "short_answer"),
            question=str(item.get("question") or ""),
            options=[str(value) for value in item.get("options", [])] if isinstance(item.get("options"), list) else [],
            answer=str(item.get("answer") or ""),
            explanation=str(item.get("explanation") or ""),
            source_ids=[str(value) for value in item.get("source_ids", [])] if isinstance(item.get("source_ids"), list) else [],
        )
        for index, item in enumerate(payload.get("quiz_questions", []), start=1)
        if isinstance(item, dict)
    ]
    return DocumentDraft(
        title=str(payload.get("title") or _default_title(bundle)),
        subtitle=str(payload.get("subtitle") or "Quellengeplante Study-Build-Ausgabe"),
        course=payload.get("course") or (bundle.selected_course or {}).get("title"),
        language=str(payload.get("language") or bundle.intent.language),
        layout=LayoutSpec(
            document_style=str(layout_payload.get("document_style") or "study_guide"),
            density=str(layout_payload.get("density") or "normal"),
            include_toc=bool(layout_payload.get("include_toc", True)),
            quiz_solutions_position=str(layout_payload.get("quiz_solutions_position") or "end"),
        ),
        sections=sections,
        quiz_questions=quiz_questions,
        source_map=payload.get("source_map") if isinstance(payload.get("source_map"), list) else _source_map(bundle),
        requirements_trace=payload.get("requirements_trace") if isinstance(payload.get("requirements_trace"), list) else bundle.coverage_matrix,
        risk_flags=[str(value) for value in payload.get("risk_flags", [])] if isinstance(payload.get("risk_flags"), list) else [],
    )


def _local_builder_draft(bundle: ResourceBundle, *, repair_request: dict[str, Any] | None = None) -> DocumentDraft:
    sections = _exact_exercise_sections(bundle) if _is_exact_exercise_request(bundle) else _sections_from_chunks(bundle.source_chunks, complete=bundle.intent.wants_complete_theory)
    if not sections:
        sections = [
            DocumentSection(
                heading="Nicht ausreichend Quellen gefunden",
                body=["Im Dokumentindex wurden keine passenden Kursquellen gefunden. Bitte Moodle-Sync aktualisieren oder Kurs genauer angeben."],
                source_ids=[],
            )
        ]
    quiz_questions = _quiz_questions_from_sections(sections) if bundle.intent.wants_quiz_style else []
    risk_flags = []
    if bundle.intent.wants_quiz_style and not bundle.quiz_permission.get("allowed"):
        risk_flags.append("quiz-access-not-authorized; questions derived from theory sources only")
    if _is_exact_exercise_request(bundle):
        risk_flags.append("exact-exercise-fallback-no-worked-solution")
    if repair_request:
        risk_flags.append("rebuilt-after-review-request")
    return DocumentDraft(
        title=_default_title(bundle),
        subtitle="Aufgabentext und Lösung aus geplanten Moodle-Ressourcen" if _is_exact_exercise_request(bundle) else "Theorie, Selbstkontrolle und Lösungen aus geplanten Moodle-Ressourcen",
        course=(bundle.selected_course or {}).get("title"),
        language=bundle.intent.language,
        layout=LayoutSpec(document_style="worked_solution" if _is_exact_exercise_request(bundle) else "study_guide", density="normal", include_toc=True, quiz_solutions_position="end"),
        sections=sections,
        quiz_questions=quiz_questions,
        source_map=_source_map(bundle),
        requirements_trace=bundle.coverage_matrix,
        risk_flags=risk_flags,
    )


def _is_exact_exercise_request(bundle: ResourceBundle) -> bool:
    return bundle.intent.requested_sheet_number is not None or bundle.intent.requested_task_number is not None


def _exact_exercise_sections(bundle: ResourceBundle) -> list[DocumentSection]:
    sections: list[DocumentSection] = []
    for chunk in bundle.source_chunks[:6]:
        body: list[str] = []
        task_text = _extract_requested_task_text(chunk.text, bundle.intent.requested_task_number)
        if task_text:
            body.append(f"Aufgabentext aus der Quelle: {task_text}")
        else:
            body.append("Die passende Aufgabenquelle wurde gefunden. Für eine vollständige Lösung muss der Builder die angegebenen Quellenauszüge auswerten.")
        body.append(
            "Not sufficiently sourced. Do not use as final answer."
            if not task_text
            else "Diese lokale Fallback-Ausgabe extrahiert die Aufgabe, ersetzt aber keine ausgearbeitete Modelllösung."
        )
        sections.append(
            DocumentSection(
                heading=_exact_exercise_heading(bundle),
                body=body,
                source_ids=[chunk.source_id],
            )
        )
    return sections


def _extract_requested_task_text(text: str, task_number: int | None) -> str:
    cleaned = " ".join(text.split())
    if task_number is None:
        return cleaned[:900]
    match = re.search(rf"(Aufgabe\s*0*{task_number}\b.*?)(?=\s+Aufgabe\s+\d+\b|$)", cleaned, flags=re.IGNORECASE)
    if not match:
        return ""
    return match.group(1)[:1200]


def _exact_exercise_heading(bundle: ResourceBundle) -> str:
    parts = []
    if bundle.intent.requested_sheet_number is not None:
        parts.append(f"Übungsblatt {bundle.intent.requested_sheet_number}")
    if bundle.intent.requested_task_number is not None:
        parts.append(f"Aufgabe {bundle.intent.requested_task_number}")
    return " - ".join(parts) if parts else "Aufgabe"


def _sections_from_chunks(chunks: list[SourceChunk], *, complete: bool) -> list[DocumentSection]:
    grouped: dict[str, list[SourceChunk]] = {}
    for chunk in chunks:
        grouped.setdefault(chunk.source_id, []).append(chunk)
    sections: list[DocumentSection] = []
    for source_id, source_chunks in grouped.items():
        title = source_chunks[0].title
        heading = _heading_from_title(title)
        source_text = " ".join(chunk.text for chunk in source_chunks[:6 if complete else 3])
        body = _summary_points(source_text, heading)
        if not body:
            body = [f"Diese Quelle behandelt {heading}. Prüfe die angegebenen Seiten für Details und Beispiele."]
        sections.append(DocumentSection(heading=heading, body=body, source_ids=[source_id]))
    return sections


def _summary_points(text: str, heading: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", text)
    cleaned = []
    for sentence in sentences:
        sentence = " ".join(sentence.split()).strip()
        if len(sentence) < 45:
            continue
        if any(skip in sentence.casefold() for skip in ["table of contents", "inhaltsverzeichnis", "author:", "fachhochschule technikum wien 2020"]):
            continue
        cleaned.append(sentence)
        if len(cleaned) >= 5:
            break
    if cleaned:
        return cleaned
    return [f"{heading}: wichtigste Definitionen, Zusammenhänge, Formeln und Einsatzbedingungen aus der Quelle wiederholen."]


def _quiz_questions_from_sections(sections: list[DocumentSection]) -> list[QuizQuestion]:
    questions: list[QuizQuestion] = []
    for index, section in enumerate(sections[:12], start=1):
        source_ids = section.source_ids
        questions.append(
            QuizQuestion(
                id=f"Q{index}",
                question_type="short_answer" if index % 3 == 0 else "true_false" if index % 3 == 2 else "multiple_choice",
                question=f"Welche Kernaussage gehört zum Thema {section.heading}?",
                options=[
                    f"Die Einsatzbedingungen und Quellenformeln zu {section.heading} müssen vor dem Rechnen geprüft werden.",
                    "Alle Formeln gelten unabhängig von Frequenz, Schaltung und Modellannahmen.",
                    "Quellenangaben sind für dieses Thema nicht erforderlich.",
                ]
                if index % 3 == 1
                else [],
                answer=(
                    f"Die Einsatzbedingungen und Quellenformeln zu {section.heading} müssen vor dem Rechnen geprüft werden."
                    if index % 3 == 1
                    else "Wahr" if index % 3 == 2 else f"Erkläre {section.heading} anhand der zitierten Quelle und nenne eine typische Formel oder Regel."
                ),
                explanation="Die Frage wurde aus den Theoriequellen abgeleitet; echte Moodle-Quizseiten wurden ohne Freigabe nicht geöffnet.",
                source_ids=source_ids,
            )
        )
    return questions


def _heading_from_title(title: str) -> str:
    stem = Path(title).stem
    stem = re.sub(r"%[0-9A-Fa-f]{2}", " ", stem)
    stem = stem.replace("_", " ").replace("-", " ")
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem or title


def _source_map(bundle: ResourceBundle) -> list[dict[str, Any]]:
    items = []
    chunk_source_ids = {chunk.source_id for chunk in bundle.source_chunks}
    for resource in bundle.resources:
        if resource.status != "selected":
            continue
        if resource.id not in chunk_source_ids:
            continue
        items.append(
            {
                "id": resource.id,
                "title": resource.title,
                "role": resource.role,
                "path": resource.path,
                "url": resource.url,
                "page_count": resource.page_count,
            }
        )
    return items


def _default_title(bundle: ResourceBundle) -> str:
    if _is_exact_exercise_request(bundle):
        return _exact_exercise_heading(bundle)
    topic = bundle.intent.course_hint or (bundle.selected_course or {}).get("title") or "Studienunterlage"
    return f"{topic} - Theoriezusammenfassung"
