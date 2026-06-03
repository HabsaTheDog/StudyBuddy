from __future__ import annotations

import subprocess
from pathlib import Path

from .base import AgentResult, AgentTask, parse_json_response


class CommandProvider:
    def __init__(self, command_template: str, *, name: str = "command") -> None:
        self.command_template = command_template
        self.name = name

    def available(self) -> bool:
        return bool(self.command_template.strip())

    def run(self, task: AgentTask) -> AgentResult:
        prompt_path = task.output_path.with_suffix(".prompt.txt")
        prompt_path.parent.mkdir(parents=True, exist_ok=True)
        prompt_path.write_text(task.prompt, encoding="utf-8")
        command = _expand_command_template(
            self.command_template,
            {
                "packet": str(task.packet_path),
                "output": str(task.output_path),
                "schema": str(task.schema_path or ""),
                "screenshot": str(task.screenshot_path or ""),
                "root": str(task.cwd),
                "prompt_file": str(prompt_path),
            },
        )
        command_env = {
            **task.env,
            "AGENT_PACKET_PATH": str(task.packet_path),
            "AGENT_OUTPUT_PATH": str(task.output_path),
            "AGENT_SCHEMA_PATH": str(task.schema_path or ""),
            "AGENT_SCREENSHOT_PATH": str(task.screenshot_path or ""),
            "AGENT_ROOT": str(task.cwd),
            "AGENT_PROMPT_PATH": str(prompt_path),
            # Backward-compatible names used by existing local scripts.
            "SUBAGENT_PACKET_PATH": str(task.packet_path),
            "SUBAGENT_SCREENSHOT_PATH": str(task.screenshot_path or ""),
            "SUBAGENT_OUTPUT_PATH": str(task.output_path),
            "SUBAGENT_SCHEMA_PATH": str(task.schema_path or ""),
            "STUDY_BUILD_PACKET_PATH": str(task.packet_path),
            "STUDY_BUILD_OUTPUT_PATH": str(task.output_path),
            "STUDY_BUILD_SCHEMA_PATH": str(task.schema_path or ""),
            "DOCUMENT_BUILD_PACKET_PATH": str(task.packet_path),
            "DOCUMENT_BUILD_OUTPUT_PATH": str(task.output_path),
            "DOCUMENT_BUILD_SCHEMA_PATH": str(task.schema_path or ""),
        }
        try:
            completed = subprocess.run(
                command,
                cwd=task.cwd,
                env=command_env,
                shell=True,
                text=True,
                capture_output=True,
                timeout=task.timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            return AgentResult(
                ok=False,
                reason="agent-timeout",
                returncode=None,
                stdout=exc.stdout or "",
                stderr=exc.stderr or "",
                command=command,
                provider=self.name,
            )
        response_text = task.output_path.read_text(encoding="utf-8").strip() if task.output_path.exists() else completed.stdout.strip()
        parsed = parse_json_response(response_text)
        if completed.returncode != 0:
            return AgentResult(
                ok=False,
                reason="agent-nonzero-exit",
                returncode=completed.returncode,
                stdout=completed.stdout,
                stderr=completed.stderr,
                parsed=parsed,
                command=command,
                provider=self.name,
            )
        if parsed is None:
            return AgentResult(
                ok=False,
                reason="agent-invalid-json",
                returncode=completed.returncode,
                stdout=completed.stdout,
                stderr=completed.stderr,
                command=command,
                provider=self.name,
            )
        return AgentResult(
            ok=True,
            reason="agent-response",
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
            parsed=parsed,
            command=command,
            provider=self.name,
        )


def _expand_command_template(command_template: str, values: dict[str, str]) -> str:
    command = command_template
    for key, value in values.items():
        command = command.replace("{" + key + "}", value)
    return command
