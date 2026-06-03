from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .storage import ROOT, slugify, utc_now, write_json


ARTIFACT_SUBDIRS = {
    "documents",
    "metadata",
    "requests",
    "responses",
    "sources",
}


def ensure_run_layout(run_dir: Path) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)


def artifact_dir(run_dir: Path, category: str) -> Path:
    normalized = category.strip().casefold().replace("_", "-")
    if normalized not in ARTIFACT_SUBDIRS:
        raise ValueError(f"Unknown artifact category: {category}")
    path = run_dir / "artifacts" / normalized
    path.mkdir(parents=True, exist_ok=True)
    return path


def artifact_path(run_dir: Path, category: str, name: str) -> Path:
    return artifact_dir(run_dir, category) / name


def copy_artifacts(run_dir: Path, artifact_specs: list[tuple[str, str]]) -> list[dict[str, Any]]:
    ensure_run_layout(run_dir)
    artifacts: list[dict[str, Any]] = []
    for category, name in artifact_specs:
        if category in {"public", "root", "."}:
            source = run_dir / name
            reported_category = "public"
        else:
            source = artifact_path(run_dir, category, name)
            reported_category = category
        if not source.exists() or not source.is_file():
            continue
        artifacts.append(
            {
                "category": reported_category,
                "name": source.name,
                "path": str(source.relative_to(ROOT)),
            }
        )
    return artifacts


def publish_public_files(run_dir: Path, artifact_specs: list[tuple[str, str]]) -> list[dict[str, Any]]:
    ensure_run_layout(run_dir)
    published: list[dict[str, Any]] = []
    for category, name in artifact_specs:
        source = artifact_path(run_dir, category, name)
        if not source.exists() or not source.is_file():
            continue
        target = run_dir / source.name
        if source.resolve() != target.resolve():
            shutil.copyfile(source, target)
        published.append(
            {
                "name": target.name,
                "path": str(target.relative_to(ROOT)),
                "source_path": str(source.relative_to(ROOT)),
            }
        )
    return published


def write_source_bundle(run_dir: Path, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ensure_run_layout(run_dir)
    file_dir = artifact_dir(run_dir, "sources") / "files"

    copied_by_path: dict[str, str] = {}
    entries: list[dict[str, Any]] = []
    for index, source in enumerate(sources, start=1):
        entry = dict(source)
        source_id = str(source.get("source_id") or f"S{index}")
        path_value = source.get("path")
        copied_path = None
        if path_value:
            local_path: Path | None = (ROOT / str(path_value)).resolve()
            try:
                local_path.relative_to(ROOT.resolve())
            except ValueError:
                local_path = None
            if local_path and local_path.exists() and local_path.is_file():
                key = str(local_path)
                copied_path = copied_by_path.get(key)
                if copied_path is None:
                    file_dir.mkdir(parents=True, exist_ok=True)
                    target_name = f"{source_id}_{slugify(local_path.stem, 'source')}{local_path.suffix}"
                    target = file_dir / target_name
                    shutil.copyfile(local_path, target)
                    copied_path = str(target.relative_to(ROOT))
                    copied_by_path[key] = copied_path
        entry["copied_source_path"] = copied_path
        entries.append(entry)

    write_json(
        artifact_path(run_dir, "sources", "source-manifest.json"),
        {
            "generated_at": utc_now(),
            "source_count": len(entries),
            "copied_file_count": len(copied_by_path),
            "sources": entries,
        },
    )
    _write_source_readme(run_dir / "SOURCES.md", entries)
    return entries


def write_run_manifest(
    run_dir: Path,
    *,
    run_type: str,
    status: str,
    artifacts: list[dict[str, Any]],
    sources: list[dict[str, Any]],
) -> None:
    ensure_run_layout(run_dir)
    write_json(
        artifact_path(run_dir, "metadata", "run-manifest.json"),
        {
            "generated_at": utc_now(),
            "run_type": run_type,
            "status": status,
            "artifacts": artifacts,
            "sources_manifest": str(artifact_path(run_dir, "sources", "source-manifest.json").relative_to(ROOT)),
            "source_count": len(sources),
        },
    )


def _write_source_readme(path: Path, sources: list[dict[str, Any]]) -> None:
    lines = [
        "# Sources",
        "",
        "This file lists the sources used by this run. Local copies are placed in `artifacts/sources/files/` when available.",
        "",
    ]
    if not sources:
        lines.append("No sources were attached to this run.")
    for source in sources:
        title = source.get("title") or source.get("path") or "Untitled source"
        source_id = source.get("source_id") or "source"
        page = f", page {source.get('page')}" if source.get("page") is not None else ""
        copied = f" -> `{source.get('copied_source_path')}`" if source.get("copied_source_path") else ""
        lines.append(f"- `{source_id}` {title}{page}{copied}")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
