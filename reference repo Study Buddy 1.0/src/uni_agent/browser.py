from __future__ import annotations

import json
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any, Literal

from .storage import ROOT, env_with_dotenv


class AgentBrowserError(RuntimeError):
    pass


class AgentBrowser:
    def __init__(
        self,
        session_name: str | None = None,
        profile_name: str = "default",
        mode: Literal["read", "write"] = "write",
    ) -> None:
        self.env = env_with_dotenv()
        self.mode = mode
        read_profile_id = uuid.uuid4().hex[:10]
        if session_name is None:
            session_name = "study-buddy-moodle-write" if mode == "write" else f"study-buddy-moodle-read-{read_profile_id}"
        self.session_name = session_name
        self.binary = self._resolve_binary()
        state_root = ROOT / self.env.get("BROWSER_STATE_DIR", "state/browser")
        if profile_name == "default" and mode == "read":
            profile_dir = state_root / "read-profiles" / read_profile_id
            self._seed_read_profile(state_root / "profile", profile_dir)
        elif profile_name == "default":
            profile_dir = state_root / "profile"
        elif mode == "read":
            profile_dir = state_root / "read-profiles" / profile_name
        else:
            profile_dir = state_root / "profiles" / profile_name
        profile_dir.mkdir(parents=True, exist_ok=True)
        self.profile_dir = profile_dir

    def _seed_read_profile(self, source: Path, target: Path) -> None:
        if target.exists() or not source.exists():
            return
        target.mkdir(parents=True, exist_ok=True)
        for relative in (
            Path("Local State"),
            Path("Default") / "Preferences",
            Path("Default") / "Secure Preferences",
            Path("Default") / "Cookies",
            Path("Default") / "Local Storage",
            Path("Default") / "Session Storage",
        ):
            src = source / relative
            dst = target / relative
            if not src.exists():
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                if src.is_dir():
                    shutil.copytree(src, dst, dirs_exist_ok=True)
                else:
                    shutil.copy2(src, dst)
            except OSError:
                continue

    def _resolve_binary(self) -> str:
        bin_dir = ROOT / "node_modules" / ".bin"
        for name in ("agent-browser", "agent-browser.cmd", "agent-browser.exe", "agent-browser.ps1"):
            local = bin_dir / name
            if local.exists():
                return str(local)
        found = shutil.which("agent-browser")
        if found:
            return found
        raise AgentBrowserError(
            "agent-browser is not installed. Run `npm install` and `npm run browser:install`."
        )

    def _base_command(self) -> list[str]:
        return [
            self.binary,
            "--session-name",
            self.session_name,
            "--profile",
            str(self.profile_dir),
        ]

    def run(
        self,
        args: list[str],
        *,
        input_text: str | None = None,
        check: bool = True,
        timeout: int = 120,
    ) -> subprocess.CompletedProcess[str]:
        command = self._base_command() + args
        result = subprocess.run(
            command,
            input=input_text,
            text=True,
            capture_output=True,
            cwd=ROOT,
            env=self.env,
            timeout=timeout,
        )
        if check and result.returncode != 0:
            stderr = result.stderr.strip()
            stdout = result.stdout.strip()
            detail = stderr or stdout or f"exit code {result.returncode}"
            raise AgentBrowserError(detail)
        return result

    def batch(self, commands: list[list[str]], *, check: bool = True) -> str:
        payload = json.dumps(commands)
        result = self.run(["batch", "--json"], input_text=payload, check=check)
        return result.stdout

    def open(self, url: str) -> str:
        return self.run(["open", url]).stdout

    def wait_load(self) -> None:
        self.run(["wait", "--load", "networkidle"], check=False, timeout=60)

    def snapshot(self, interactive: bool = True) -> str:
        args = ["snapshot"]
        if interactive:
            args.append("-i")
        return self.run(args, timeout=120).stdout

    def eval_json(self, js: str) -> Any:
        result = self.run(["eval", js], timeout=120).stdout.strip()
        try:
            parsed = json.loads(result)
            if isinstance(parsed, str) and parsed[:1] in "[{":
                return json.loads(parsed)
            return parsed
        except json.JSONDecodeError as exc:
            raise AgentBrowserError(f"agent-browser eval did not return JSON: {result[:500]}") from exc

    def get_url(self) -> str:
        return self.run(["get", "url"]).stdout.strip()

    def get_title(self) -> str:
        return self.run(["get", "title"], check=False).stdout.strip()

    def set_viewport(self, width: int, height: int) -> None:
        self.run(["set", "viewport", str(width), str(height)], check=False)

    def screenshot(self, path: Path, *, full_page: bool = False, selector: str | None = None) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        args = ["screenshot"]
        if full_page:
            args.append("--full")
        if selector:
            args.append(selector)
        args.append(str(path))
        self.run(args, check=False)
