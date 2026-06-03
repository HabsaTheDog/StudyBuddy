from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol


@dataclass(frozen=True)
class AgentTask:
    kind: str
    packet_path: Path
    output_path: Path
    transcript_path: Path
    schema_path: Path | None
    screenshot_path: Path | None
    prompt: str
    timeout_seconds: int
    cwd: Path
    env: dict[str, str]


@dataclass(frozen=True)
class AgentResult:
    ok: bool
    reason: str
    returncode: int | None
    stdout: str
    stderr: str
    parsed: dict[str, Any] | None = None
    command: list[str] | str | None = None
    provider: str | None = None


class AgentProvider(Protocol):
    name: str

    def available(self) -> bool:
        ...

    def run(self, task: AgentTask) -> AgentResult:
        ...


class DisabledProvider:
    def __init__(self, *, reason: str = "agent-provider-disabled", detail: str = "") -> None:
        self.name = "disabled"
        self.reason = reason
        self.detail = detail

    def available(self) -> bool:
        return False

    def run(self, task: AgentTask) -> AgentResult:
        return AgentResult(
            ok=False,
            reason=self.reason,
            returncode=None,
            stdout="",
            stderr=self.detail,
            provider=self.name,
        )


def parse_json_response(response_text: str) -> dict[str, Any] | None:
    text = response_text.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None


def write_agent_transcript(task: AgentTask, result: AgentResult) -> None:
    payload = {
        "provider": result.provider,
        "command": result.command,
        "returncode": result.returncode,
        "reason": result.reason,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "response_path": str(task.output_path),
    }
    task.transcript_path.parent.mkdir(parents=True, exist_ok=True)
    task.transcript_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def result_to_dict(result: AgentResult) -> dict[str, Any]:
    return asdict(result)
