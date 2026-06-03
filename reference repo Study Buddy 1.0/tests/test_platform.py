import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from uni_agent.browser import AgentBrowser


class PlatformPortabilityTests(unittest.TestCase):
    def test_agent_browser_resolves_windows_cmd_shim(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            shim = root / "node_modules" / ".bin" / "agent-browser.cmd"
            shim.parent.mkdir(parents=True)
            shim.write_text("@echo off\n", encoding="utf-8")
            with patch("uni_agent.browser.ROOT", root), patch("uni_agent.browser.shutil.which", return_value=None):
                resolved = AgentBrowser.__new__(AgentBrowser)._resolve_binary()
        self.assertEqual(Path(resolved).name, "agent-browser.cmd")

    def test_agent_browser_prefers_local_unix_shim(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            shim = root / "node_modules" / ".bin" / "agent-browser"
            shim.parent.mkdir(parents=True)
            shim.write_text("#!/usr/bin/env node\n", encoding="utf-8")
            with patch("uni_agent.browser.ROOT", root), patch("uni_agent.browser.shutil.which", return_value="/usr/bin/agent-browser"):
                resolved = AgentBrowser.__new__(AgentBrowser)._resolve_binary()
        self.assertEqual(Path(resolved), shim)


if __name__ == "__main__":
    unittest.main()
