import os
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from uni_agent.providers import AgentTask, provider_diagnostics, resolve_provider
from uni_agent.providers.command import CommandProvider
from uni_agent.study_build.model_runner import run_optional_model
from uni_agent.subagents import _normalize_subagent_answer, _run_subagent


def _command(*parts: str) -> str:
    return subprocess.list2cmdline(list(parts))


def _task(root: Path, *, output_name: str = "response.json") -> AgentTask:
    packet = root / "packet.json"
    packet.write_text('{"task":"test"}\n', encoding="utf-8")
    return AgentTask(
        kind="test",
        packet_path=packet,
        output_path=root / output_name,
        transcript_path=root / "transcript.json",
        schema_path=None,
        screenshot_path=None,
        prompt="Return JSON.",
        timeout_seconds=5,
        cwd=root,
        env=os.environ.copy(),
    )


class AgentProviderTests(unittest.TestCase):
    def test_registry_prefers_task_command_hook(self):
        selection = resolve_provider(
            env={
                "SUBAGENT_SOLVER_COMMAND": "printf '{}'",
                "SUBAGENT_SOLVER_PROVIDER": "codex",
                "STUDY_BUDDY_AGENT_PROVIDER": "disabled",
            },
            task_kind="quiz_subagent",
            command_env="SUBAGENT_SOLVER_COMMAND",
            provider_env="SUBAGENT_SOLVER_PROVIDER",
        )
        self.assertEqual(selection.name, "command")
        self.assertEqual(selection.source, "SUBAGENT_SOLVER_COMMAND")

    def test_auto_detection_falls_back_to_disabled(self):
        with patch("uni_agent.providers.registry.CodexProvider.available", return_value=False):
            selection = resolve_provider(
                env={},
                task_kind="quiz_subagent",
                command_env="SUBAGENT_SOLVER_COMMAND",
                provider_env="SUBAGENT_SOLVER_PROVIDER",
            )
        self.assertEqual(selection.name, "disabled")
        result = selection.provider.run(_task(Path(tempfile.mkdtemp())))
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "agent-command-not-found")

    def test_command_provider_reads_json_from_output_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            script = root / "write_output.py"
            script.write_text(
                "import json, os\n"
                "open(os.environ['AGENT_OUTPUT_PATH'], 'w', encoding='utf-8').write(json.dumps({'answer': 'ok'}))\n",
                encoding="utf-8",
            )
            result = CommandProvider(_command(sys.executable, str(script))).run(_task(root))
        self.assertTrue(result.ok)
        self.assertEqual(result.parsed, {"answer": "ok"})

    def test_command_provider_exposes_document_build_env_names(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            script = root / "write_document_output.py"
            script.write_text(
                "import json, os\n"
                "open(os.environ['DOCUMENT_BUILD_OUTPUT_PATH'], 'w', encoding='utf-8').write(json.dumps({'answer': 'doc'}))\n",
                encoding="utf-8",
            )
            result = CommandProvider(_command(sys.executable, str(script))).run(_task(root))
        self.assertTrue(result.ok)
        self.assertEqual(result.parsed, {"answer": "doc"})

    def test_provider_diagnostics_include_document_build_section_hook(self):
        diagnostics = provider_diagnostics({"DOCUMENT_BUILD_SECTION_COMMAND": "printf '{}'"})
        self.assertIn("document_build_section", diagnostics["selections"])
        self.assertEqual(diagnostics["selections"]["document_build_section"]["provider"], "command")

    def test_command_provider_reads_json_from_stdout(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            script = root / "stdout.py"
            script.write_text("print('{\"answer\": \"stdout\"}')\n", encoding="utf-8")
            result = CommandProvider(_command(sys.executable, str(script))).run(_task(root))
        self.assertTrue(result.ok)
        self.assertEqual(result.parsed, {"answer": "stdout"})

    def test_command_provider_allows_inline_json_braces_in_template(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            script = root / "inline.py"
            script.write_text("print('{\"answer\":\"inline\"}')\n", encoding="utf-8")
            result = CommandProvider(_command(sys.executable, str(script))).run(_task(root))
        self.assertTrue(result.ok)
        self.assertEqual(result.parsed, {"answer": "inline"})

    def test_command_provider_rejects_invalid_json(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            script = root / "invalid.py"
            script.write_text("print('not json')\n", encoding="utf-8")
            result = CommandProvider(_command(sys.executable, str(script))).run(_task(root))
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "agent-invalid-json")

    def test_command_provider_timeout(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            script = root / "sleep.py"
            script.write_text("import time\ntime.sleep(2)\n", encoding="utf-8")
            task = replace(_task(root), timeout_seconds=1)
            result = CommandProvider(_command(sys.executable, str(script))).run(task)
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "agent-timeout")

    def test_subagent_solver_command_off_still_disables_answering(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch("uni_agent.subagents.env_with_dotenv", return_value={"SUBAGENT_SOLVER_COMMAND": "off"}):
                result = _run_subagent(
                    packet_path=root / "packet.json",
                    screenshot_path=None,
                    response_path=root / "response.json",
                    transcript_path=root / "transcript.json",
                )
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "subagent-command-disabled")

    def test_study_build_command_hook_runs_through_provider(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            script = root / "builder.py"
            script.write_text(
                "import json, os\n"
                "payload = {'title': 'Draft', 'sections': [], 'quiz_questions': [], 'layout': {}, 'risk_flags': []}\n"
                "open(os.environ['AGENT_OUTPUT_PATH'], 'w', encoding='utf-8').write(json.dumps(payload))\n",
                encoding="utf-8",
            )
            command = _command(sys.executable, str(script))
            with patch("uni_agent.study_build.model_runner.env_with_dotenv", return_value={"STUDY_BUILD_BUILDER_COMMAND": command}):
                result = run_optional_model(
                    command_env="STUDY_BUILD_BUILDER_COMMAND",
                    packet={"task": "builder-test"},
                    packet_path=root / "packet.json",
                    response_path=root / "response.json",
                    transcript_path=root / "transcript.json",
                )
        self.assertTrue(result["ok"])
        self.assertEqual(result["reason"], "model-response")
        self.assertEqual(result["parsed"]["title"], "Draft")

    def test_subagent_normalization_keeps_existing_answer_contract(self):
        answer = _normalize_subagent_answer(
            question={"question_id": "q1", "question_index": 1, "prompt": "2+2?"},
            page={"title": "Quiz", "url": "https://moodle.example/quiz"},
            subagent_result={
                "ok": True,
                "parsed": {
                    "answer": "4",
                    "confidence": 0.9,
                    "citations": [{"title": "Source", "kind": "moodle_page", "url": None, "path": None, "page": None, "section": None}],
                    "rationale": "basic arithmetic",
                    "risk_flags": [],
                },
            },
            packet_path=Path("packet.json"),
            screenshot_path=None,
            response_path=Path("response.json"),
            transcript_path=Path("transcript.json"),
        )
        self.assertEqual(answer["answer"], "4")
        self.assertEqual(answer["confidence"], 0.9)
        self.assertEqual(answer["risk_flags"], [])


if __name__ == "__main__":
    unittest.main()
