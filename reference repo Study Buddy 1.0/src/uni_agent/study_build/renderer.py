from __future__ import annotations

from pathlib import Path
from typing import Any

from ..storage import write_json
from ..typst import compile_typst_pdf
from .contracts import DocumentDraft, QuizQuestion, to_jsonable


def render_draft(draft: DocumentDraft, run_dir: Path, *, output_format: str) -> dict[str, Any]:
    documents_dir = run_dir / "artifacts" / "renderer"
    documents_dir.mkdir(parents=True, exist_ok=True)
    md_path = run_dir / "study-build.md"
    typ_path = documents_dir / "study-build.typ"
    pdf_path = run_dir / "study-build.pdf"
    md_path.write_text(_render_markdown(draft), encoding="utf-8")
    typ_path.write_text(_render_typst(draft), encoding="utf-8")
    write_json(run_dir / "artifacts" / "documents" / "document-draft.json", to_jsonable(draft))
    result: dict[str, Any] = {"ok": True, "reason": "rendered-markdown", "pdf_attempted": False, "markdown": str(md_path)}
    if output_format in {"typst", "markdown+pdf", "pdf"}:
        result.update({"typst": str(typ_path), "reason": "typst-written"})
    if output_format in {"markdown+pdf", "pdf"}:
        result = compile_typst_pdf(typ_path, pdf_path)
        result["pdf_attempted"] = True
    write_json(run_dir / "artifacts" / "metadata" / "render-result.json", result)
    return result


def _render_markdown(draft: DocumentDraft) -> str:
    main_heading = "Lösung" if draft.layout.document_style == "worked_solution" else "Theorie"
    lines = [
        f"# {draft.title}",
        "",
        draft.subtitle,
        "",
        f"Course: {draft.course or 'n/a'}",
        "",
        f"## {main_heading}",
        "",
    ]
    for section in draft.sections:
        lines.extend([f"### {section.heading}", ""])
        for item in section.body:
            lines.append(f"- {item}")
        if section.source_ids:
            lines.append("")
            lines.append(f"Quellen: {', '.join(f'[{source_id}]' for source_id in section.source_ids)}")
        lines.append("")
    if draft.quiz_questions:
        lines.extend(["## Theoriefragen", ""])
        for question in draft.quiz_questions:
            lines.extend([f"### {question.id}. {question.question}", ""])
            if question.options:
                for option in question.options:
                    lines.append(f"- {option}")
            lines.append("")
        lines.extend(["## Lösungen", ""])
        for question in draft.quiz_questions:
            lines.append(f"- **{question.id}:** {question.answer} {question.explanation}")
        lines.append("")
    lines.extend(["## Quellen", ""])
    for source in draft.source_map:
        parts = [f"[{source.get('id')}] {source.get('title')}"]
        if source.get("page_count"):
            parts.append(f"{source.get('page_count')} Seiten")
        if source.get("path"):
            parts.append(str(source.get("path")))
        lines.append(f"- {', '.join(parts)}")
    if draft.risk_flags:
        lines.extend(["", "## Hinweise", ""])
        for flag in draft.risk_flags:
            lines.append(f"- {flag}")
    return "\n".join(lines).rstrip() + "\n"


def _render_typst(draft: DocumentDraft) -> str:
    main_heading = "Lösung" if draft.layout.document_style == "worked_solution" else "Theorie"
    lines = [
        '#set page(paper: "a4", margin: (x: 18mm, y: 16mm), numbering: "1")',
        '#set text(font: "Liberation Serif", size: 10pt, lang: "de")',
        "#set par(justify: true, leading: 0.58em)",
        f"#align(center)[#text(size: 21pt, weight: \"bold\")[{_c(draft.title)}]]",
        f"#align(center)[#text(size: 10pt)[{_c(draft.subtitle)}]]",
        "#v(6mm)",
        f"#text(weight: \"bold\")[Kurs:] {_c(draft.course or 'n/a')}",
        "",
        f"= {main_heading}",
        "",
    ]
    for section in draft.sections:
        lines.append(f"== {_c(section.heading)}")
        lines.append("")
        for item in section.body:
            lines.append(f"- {_mixed(item)}")
        if section.source_ids:
            lines.append(f"#text(size: 8pt, fill: rgb(\"#555555\"))[Quellen: {_c(', '.join(f'[{source_id}]' for source_id in section.source_ids))}]")
        lines.append("")
    if draft.quiz_questions:
        lines.append("= Theoriefragen")
        lines.append("")
        for question in draft.quiz_questions:
            lines.append(f"== {_c(question.id)}. {_c(question.question)}")
            if question.options:
                for option in question.options:
                    lines.append(f"- {_c(option)}")
            lines.append("")
        lines.append("#pagebreak()")
        lines.append("= Lösungen")
        lines.append("")
        for question in draft.quiz_questions:
            lines.append(f"- #text(weight: \"bold\")[{_c(question.id)}:] {_c(question.answer)} {_c(question.explanation)}")
        lines.append("")
    lines.append("= Quellen")
    for source in draft.source_map:
        details = [f"[{source.get('id')}] {source.get('title')}"]
        if source.get("page_count"):
            details.append(f"{source.get('page_count')} Seiten")
        if source.get("path"):
            details.append(str(source.get("path")))
        lines.append(f"- {_c(', '.join(details))}")
    if draft.risk_flags:
        lines.append("= Hinweise")
        for flag in draft.risk_flags:
            lines.append(f"- {_c(flag)}")
    return "\n".join(lines).rstrip() + "\n"


def _mixed(value: str) -> str:
    # Keep this conservative; the builder can pass readable text directly.
    return _c(value)


def _c(value: Any) -> str:
    text = str(value or "")
    replacements = {
        "\\": "\\\\",
        "[": "\\[",
        "]": "\\]",
        "#": "\\#",
        "$": "\\$",
        "%": "\\%",
        "&": "\\&",
        "_": "\\_",
        "{": "\\{",
        "}": "\\}",
    }
    return "".join(replacements.get(char, char) for char in text)
