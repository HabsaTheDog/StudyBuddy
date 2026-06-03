from __future__ import annotations

import shutil
import subprocess

from .base import AgentResult, AgentTask, parse_json_response


class CodexProvider:
    name = "codex"

    def __init__(self, executable: str = "codex") -> None:
        self.executable = executable

    def available(self) -> bool:
        return shutil.which(self.executable) is not None

    def run(self, task: AgentTask) -> AgentResult:
        codex = shutil.which(self.executable)
        if not codex:
            return AgentResult(
                ok=False,
                reason="agent-command-not-found",
                returncode=127,
                stdout="",
                stderr=f"{self.executable} executable not found",
                provider=self.name,
            )
        command = [
            codex,
            "exec",
            "--cd",
            str(task.cwd),
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox",
            "read-only",
        ]
        if task.schema_path is not None:
            command.extend(["--output-schema", str(task.schema_path)])
        command.extend(["--output-last-message", str(task.output_path)])
        if task.screenshot_path is not None and task.screenshot_path.exists():
            command.extend(["--image", str(task.screenshot_path)])
        command_env = {
            **task.env,
            "AGENT_PACKET_PATH": str(task.packet_path),
            "AGENT_OUTPUT_PATH": str(task.output_path),
            "AGENT_SCHEMA_PATH": str(task.schema_path or ""),
            "AGENT_SCREENSHOT_PATH": str(task.screenshot_path or ""),
            "AGENT_ROOT": str(task.cwd),
            "SUBAGENT_PACKET_PATH": str(task.packet_path),
            "SUBAGENT_SCREENSHOT_PATH": str(task.screenshot_path or ""),
            "SUBAGENT_OUTPUT_PATH": str(task.output_path),
            "SUBAGENT_SCHEMA_PATH": str(task.schema_path or ""),
        }
        try:
            completed = subprocess.run(
                command,
                input=task.prompt,
                cwd=task.cwd,
                env=command_env,
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
