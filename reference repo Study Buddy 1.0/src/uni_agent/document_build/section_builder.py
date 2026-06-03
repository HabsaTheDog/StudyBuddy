from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from ..providers import AgentTask, resolve_provider
from ..providers.base import result_to_dict, write_agent_transcript
from ..storage import ROOT, env_with_dotenv, utc_now, write_json
from .contracts import BuiltDocument, BuiltSection, DocumentIntent, DocumentPlan, PlannedSection, SourceChunk, to_jsonable
from .template_registry import TemplateSpec


def model_provider_available() -> bool:
    if os.environ.get("DOCUMENT_BUILD_SECTION_COMMAND") or os.environ.get("STUDY_BUDDY_AGENT_COMMAND"):
        return True
    return shutil.which("codex") is not None


def build_local_document(intent: DocumentIntent, template: TemplateSpec, plan: DocumentPlan, run_dir: Path | None = None) -> BuiltDocument:
    sections: list[BuiltSection] = []
    chunks_by_source = {}
    for chunk in plan.chunks:
        chunks_by_source.setdefault(chunk.source_id, []).append(chunk)
    for planned in plan.sections:
        if planned.kind == "worked_solution":
            provider_section = _build_worked_solution_with_provider(
                intent=intent,
                template=template,
                plan=plan,
                planned=planned,
                source_chunks=[chunk for source_id in planned.source_ids for chunk in chunks_by_source.get(source_id, [])],
                run_dir=run_dir,
            )
            if provider_section is not None:
                sections.append(provider_section)
                continue
            sections.append(
                BuiltSection(
                    id=planned.id,
                    heading=planned.heading,
                    body=[
                        "Für diese Mathe-Lösung ist ein Modell-Builder erforderlich. Es wurde bewusst keine lokale Platzhalterlösung erzeugt.",
                    ],
                    source_ids=planned.source_ids,
                    risk_flags=["model-provider-required"],
                )
            )
            continue
        body = []
        for source_id in planned.source_ids:
            source_text = " ".join(chunk.text for chunk in chunks_by_source.get(source_id, [])[:3])
            if source_text:
                body.extend(_summary_points(source_text, planned.heading))
        if not body:
            body = ["Keine ausreichend extrahierbaren Inhalte für diese Quelle gefunden."]
        sections.append(BuiltSection(id=planned.id, heading=planned.heading, body=body, source_ids=planned.source_ids))
    return BuiltDocument(
        title=plan.title,
        subtitle=_subtitle(template, intent),
        course=(plan.course or {}).get("title") or (plan.course or {}).get("course_title"),
        language=intent.language,
        template_id=template.id,
        sections=sections,
        sources=plan.sources,
        omissions=plan.omissions,
        risk_flags=[],
        )


def _build_worked_solution_with_provider(
    *,
    intent: DocumentIntent,
    template: TemplateSpec,
    plan: DocumentPlan,
    planned: PlannedSection,
    source_chunks: list[SourceChunk],
    run_dir: Path | None,
) -> BuiltSection | None:
    if run_dir is None:
        return None
    packet = {
        "created_at": utc_now(),
        "task": "build_document_section",
        "template": to_jsonable(template),
        "intent": to_jsonable(intent),
        "section": to_jsonable(planned),
        "course": plan.course,
        "rules": [
            "Use only the provided source_chunks.",
            "Return JSON only with heading, body, source_ids, and risk_flags.",
            "For worked_solution, solve the requested exercise directly and include a short explanation.",
            "Use readable German math notation where possible.",
            "Every factual or formula-based claim must be tied to source_ids from source_chunks.",
            "If the source_chunks are insufficient, return risk_flags with insufficient-sources instead of guessing.",
        ],
        "source_chunks": [to_jsonable(chunk) for chunk in source_chunks[:12]],
    }
    result = _run_section_model(
        packet=packet,
        packet_path=run_dir / "artifacts" / "section-builder" / f"{planned.id}.packet.json",
        response_path=run_dir / "artifacts" / "section-builder" / f"{planned.id}.response.json",
        transcript_path=run_dir / "artifacts" / "section-builder" / f"{planned.id}.transcript.json",
    )
    if not result.get("ok") or not isinstance(result.get("parsed"), dict):
        write_json(run_dir / "artifacts" / "section-builder" / f"{planned.id}.failed.json", result)
        return None
    section = _section_from_model_response(planned, result["parsed"])
    write_json(run_dir / "artifacts" / "section-builder" / f"{planned.id}.normalized.json", to_jsonable(section))
    return section


def _run_section_model(*, packet: dict[str, Any], packet_path: Path, response_path: Path, transcript_path: Path) -> dict[str, Any]:
    env = env_with_dotenv()
    write_json(packet_path, packet)
    task = AgentTask(
        kind="document_build_section",
        packet_path=packet_path,
        output_path=response_path,
        transcript_path=transcript_path,
        schema_path=ROOT / "config" / "document_build.section.schema.json",
        screenshot_path=None,
        prompt=_section_model_prompt(packet_path=packet_path),
        timeout_seconds=int(env.get("DOCUMENT_BUILD_SECTION_TIMEOUT_SECONDS") or env.get("STUDY_BUDDY_AGENT_TIMEOUT_SECONDS") or "300"),
        cwd=ROOT,
        env=env,
    )
    selection = resolve_provider(
        env=env,
        task_kind=task.kind,
        command_env="DOCUMENT_BUILD_SECTION_COMMAND",
        provider_env="DOCUMENT_BUILD_SECTION_PROVIDER",
    )
    try:
        result = selection.provider.run(task)
    except subprocess.TimeoutExpired as exc:
        return {"ok": False, "reason": "timeout", "stdout": exc.stdout or "", "stderr": exc.stderr or ""}
    write_agent_transcript(task, result)
    if not result.ok:
        return {**result_to_dict(result), "reason": _model_reason(result.reason)}
    if not isinstance(result.parsed, dict):
        return {"ok": False, "reason": "non-object-response", "parsed": result.parsed}
    write_json(response_path, result.parsed)
    return {"ok": True, "reason": "model-response", "parsed": result.parsed, "transcript": result_to_dict(result)}


def _section_from_model_response(planned: PlannedSection, payload: dict[str, Any]) -> BuiltSection:
    body_value = payload.get("body")
    if isinstance(body_value, list):
        body = [_clean_model_text(str(item)).strip() for item in body_value if _clean_model_text(str(item)).strip()]
    else:
        body = [_clean_model_text(str(body_value)).strip()] if _clean_model_text(str(body_value or "")).strip() else []
    source_ids = [_clean_model_text(str(item)).strip() for item in payload.get("source_ids", []) if _clean_model_text(str(item)).strip()] if isinstance(payload.get("source_ids"), list) else []
    risk_flags = [_clean_model_text(str(item)).strip() for item in payload.get("risk_flags", []) if _clean_model_text(str(item)).strip()] if isinstance(payload.get("risk_flags"), list) else []
    return BuiltSection(
        id=planned.id,
        heading=_clean_model_text(str(payload.get("heading") or planned.heading)),
        body=body or ["Not sufficiently sourced. Do not use as final answer."],
        source_ids=source_ids or planned.source_ids,
        risk_flags=risk_flags,
    )


def _clean_model_text(value: str) -> str:
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", value)
    text = (
        text.replace("\x00df", "ß")
        .replace("\x00e4", "ä")
        .replace("\x00f6", "ö")
        .replace("\x00fc", "ü")
        .replace("F\x0fr", "Für")
    )
    return "".join(char for char in text if char in "\n\t" or ord(char) >= 0x20)


def _section_model_prompt(*, packet_path: Path) -> str:
    return f"""You are a constrained Study Buddy document-section builder.

Read the packet JSON at:
{packet_path}

Use only the packet and local files it references. Do not browse Moodle, do not control a browser, and do not submit anything.
Return JSON matching config/document_build.section.schema.json.
"""


def _model_reason(reason: str) -> str:
    mapping = {
        "agent-command-not-configured": "model-command-not-configured",
        "agent-command-not-found": "model-command-not-found",
        "agent-provider-disabled": "model-command-disabled",
        "agent-nonzero-exit": "nonzero-exit",
        "agent-invalid-json": "invalid-json",
        "agent-timeout": "timeout",
    }
    return mapping.get(reason, reason)


def _summary_points(text: str, heading: str) -> list[str]:
    sentences = [item.strip() for item in text.replace("\n", " ").split(".") if len(item.strip()) > 50]
    if not sentences:
        return [f"{heading}: Quelle prüfen und die wichtigsten Definitionen, Formeln und Bedingungen wiederholen."]
    return [sentence + "." for sentence in sentences[:5]]


def _subtitle(template: TemplateSpec, intent: DocumentIntent) -> str:
    if template.id == "math_worked_solutions":
        return "Quellenbasierte Mathe-Übungslösungen"
    if template.id == "formula_sheet":
        return "Adaptive Formelsammlung aus aktuellen Moodle-Quellen"
    return "Adaptives Studiendokument aus aktuellen Moodle-Quellen"
