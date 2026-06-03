from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

from .storage import ROOT


def compile_typst_pdf(source: Path, target: Path) -> dict[str, Any]:
    typst = shutil.which("typst")
    if not typst:
        return {
            "ok": False,
            "reason": "typst-not-found",
            "hint": "Install Typst and rerun with the same generated .typ file.",
            "source": str(source),
            "target": str(target),
        }

    target.parent.mkdir(parents=True, exist_ok=True)
    command = [typst, "compile", str(source), str(target)]
    completed = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    return {
        "ok": completed.returncode == 0,
        "reason": "compiled" if completed.returncode == 0 else "typst-compile-failed",
        "command": command,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "source": str(source),
        "target": str(target),
    }
