from __future__ import annotations

from pathlib import Path
from typing import Any

from ..storage import write_json
from ..typst import compile_typst_pdf
from .contracts import BuiltDocument, to_jsonable


def render_document(document: BuiltDocument, run_dir: Path, *, output_format: str) -> dict[str, Any]:
    renderer_dir = run_dir / "artifacts" / "renderer"
    renderer_dir.mkdir(parents=True, exist_ok=True)
    md_path = run_dir / "document-build.md"
    typ_path = renderer_dir / "document-build.typ"
    pdf_path = run_dir / "document-build.pdf"
    md_path.write_text(_render_markdown(document), encoding="utf-8")
    typ_path.write_text(_render_typst(document), encoding="utf-8")
    write_json(run_dir / "artifacts" / "documents" / "document.json", to_jsonable(document))
    result: dict[str, Any] = {"ok": True, "reason": "rendered-markdown", "markdown": str(md_path), "pdf_attempted": False}
    if output_format in {"typst", "markdown+pdf", "pdf"}:
        result.update({"typst": str(typ_path), "reason": "typst-written"})
    if output_format in {"markdown+pdf", "pdf"}:
        result = compile_typst_pdf(typ_path, pdf_path)
        result["pdf_attempted"] = True
    write_json(run_dir / "artifacts" / "metadata" / "render-result.json", result)
    if result.get("ok") and pdf_path.exists():
        # Compatibility for callers that still look for study-build.pdf.
        (run_dir / "study-build.md").write_text(md_path.read_text(encoding="utf-8"), encoding="utf-8")
        (run_dir / "study-build.pdf").write_bytes(pdf_path.read_bytes())
    return result


def _render_markdown(document: BuiltDocument) -> str:
    lines = [f"# {document.title}", "", document.subtitle, "", f"Course: {document.course or 'n/a'}", ""]
    if document.omissions:
        lines.extend(["## Ausgelassen", ""])
        for omission in document.omissions:
            lines.append(f"- {omission.label}: {omission.reason}")
        lines.append("")
    lines.append("## Inhalt")
    lines.append("")
    for section in document.sections:
        lines.extend([f"### {section.heading}", ""])
        for item in section.body:
            lines.append(f"- {item}")
        if section.source_ids:
            lines.append("")
            lines.append(f"Quellen: {', '.join(f'[{source_id}]' for source_id in section.source_ids)}")
        lines.append("")
    lines.extend(["## Quellen", ""])
    for source in document.sources:
        if source.status != "selected":
            continue
        parts = [f"[{source.id}] {source.title}"]
        if source.page_count:
            parts.append(f"{source.page_count} Seiten")
        if source.path:
            parts.append(source.path)
        lines.append(f"- {', '.join(parts)}")
    return "\n".join(lines).rstrip() + "\n"


def _render_typst(document: BuiltDocument) -> str:
    lines = [
        '#set page(paper: "a4", margin: (x: 18mm, y: 16mm), numbering: "1")',
        '#set text(font: "Liberation Serif", size: 10pt, lang: "de")',
        "#set par(justify: true, leading: 0.58em)",
        f"#align(center)[#text(size: 21pt, weight: \"bold\")[{_c(document.title)}]]",
        f"#align(center)[#text(size: 10pt)[{_c(document.subtitle)}]]",
        "#v(6mm)",
        f"#text(weight: \"bold\")[Kurs:] {_c(document.course or 'n/a')}",
        "",
    ]
    if document.omissions:
        lines.extend(["= Ausgelassen", ""])
        for omission in document.omissions:
            lines.append(f"- {_c(omission.label)}: {_c(omission.reason)}")
        lines.append("")
    lines.append("= Inhalt")
    for section in document.sections:
        lines.extend([f"== {_c(section.heading)}", ""])
        for item in section.body:
            lines.append(f"- {_c(item)}")
        if section.source_ids:
            lines.append(f"#text(size: 8pt, fill: rgb(\"#555555\"))[Quellen: {_c(', '.join(f'[{source_id}]' for source_id in section.source_ids))}]")
        lines.append("")
    lines.append("= Quellen")
    for source in document.sources:
        if source.status != "selected":
            continue
        details = [f"[{source.id}] {source.title}"]
        if source.page_count:
            details.append(f"{source.page_count} Seiten")
        if source.path:
            details.append(source.path)
        lines.append(f"- {_c(', '.join(details))}")
    return "\n".join(lines).rstrip() + "\n"


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
