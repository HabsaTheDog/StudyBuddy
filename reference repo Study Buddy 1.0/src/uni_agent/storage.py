from __future__ import annotations

import json
import os
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]


def load_env(path: Path | None = None) -> dict[str, str]:
    env_path = path or ROOT / ".env"
    values: dict[str, str] = {}
    if env_path.exists():
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("'\"")
    return values


def env_with_dotenv() -> dict[str, str]:
    merged = os.environ.copy()
    merged.update(load_env())
    return merged


def require_env(keys: list[str]) -> dict[str, str]:
    env = env_with_dotenv()
    missing = [key for key in keys if not env.get(key)]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
    return env


def ensure_dirs() -> None:
    for path in [
        ROOT / "output",
        ROOT / "state",
        ROOT / "state" / "browser",
        ROOT / "data" / "moodle" / "courses",
        ROOT / "data" / "moodle" / "materials",
    ]:
        path.mkdir(parents=True, exist_ok=True)


def create_output_run_dir(kind: str, label: str | None = None) -> Path:
    """Create one self-contained run folder directly below output/."""
    ensure_dirs()
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    parts = [timestamp, slugify(kind, "run")]
    if label:
        parts.append(slugify(label, "output")[:80])
    base_name = "_".join(parts)
    run_dir = ROOT / "output" / base_name
    suffix = 2
    while run_dir.exists():
        run_dir = ROOT / "output" / f"{base_name}_{suffix:02d}"
        suffix += 1
    run_dir.mkdir(parents=True)
    return run_dir


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def slugify(value: str, fallback: str = "item") -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    chars: list[str] = []
    for char in value.lower():
        if char.isalnum():
            chars.append(char)
        elif chars and chars[-1] != "-":
            chars.append("-")
    slug = "".join(chars).strip("-")
    return slug or fallback
