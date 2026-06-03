from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from ..providers import AgentTask, resolve_provider
from ..providers.base import result_to_dict, write_agent_transcript
from ..storage import ROOT, env_with_dotenv, write_json


def run_optional_model(
    *,
    command_env: str,
    packet: dict[str, Any],
    packet_path: Path,
    response_path: Path,
    transcript_path: Path,
    timeout_seconds: int = 300,
) -> dict[str, Any]:
    env = env_with_dotenv()
    write_json(packet_path, packet)
    task = AgentTask(
        kind=_task_kind(command_env),
        packet_path=packet_path,
        output_path=response_path,
        transcript_path=transcript_path,
        schema_path=_schema_path(command_env),
        screenshot_path=None,
        prompt=_model_prompt(packet_path=packet_path, schema_path=_schema_path(command_env)),
        timeout_seconds=timeout_seconds,
        cwd=ROOT,
        env=env,
    )
    selection = resolve_provider(
        env=env,
        task_kind=task.kind,
        command_env=command_env,
        provider_env=_provider_env(command_env),
    )
    try:
        result = selection.provider.run(task)
    except subprocess.TimeoutExpired as exc:
        return {"ok": False, "reason": "timeout", "stdout": exc.stdout or "", "stderr": exc.stderr or ""}
    write_agent_transcript(task, result)
    parsed = result.parsed
    if not result.ok:
        return {
            **result_to_dict(result),
            "reason": _model_reason(result.reason),
        }
    if not isinstance(parsed, dict):
        return {"ok": False, "reason": "non-object-response", "parsed": parsed}
    write_json(response_path, parsed)
    return {"ok": True, "reason": "model-response", "parsed": parsed, "transcript": result_to_dict(result)}


def _task_kind(command_env: str) -> str:
    if "REVIEWER" in command_env:
        return "study_build_reviewer"
    return "study_build_builder"


def _provider_env(command_env: str) -> str:
    if "REVIEWER" in command_env:
        return "STUDY_BUILD_REVIEWER_PROVIDER"
    return "STUDY_BUILD_BUILDER_PROVIDER"


def _schema_path(command_env: str) -> Path | None:
    if "REVIEWER" in command_env:
        return ROOT / "config" / "study_build.review_report.schema.json"
    if "BUILDER" in command_env:
        return ROOT / "config" / "study_build.document_draft.schema.json"
    return None


def _model_prompt(*, packet_path: Path, schema_path: Path | None) -> str:
    schema_note = f"Return JSON matching the schema at {schema_path}." if schema_path else "Return JSON only."
    return f"""You are a constrained Study Buddy model worker.

Read the packet JSON at:
{packet_path}

Use only the packet and local files it references. Do not browse Moodle, do not control a browser, and do not submit anything.
{schema_note}
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
