from __future__ import annotations

from collections import Counter
from pathlib import Path
import shutil
from typing import Any

from .courses import index_courses
from .documents import discover_material_links, download_course_materials, refresh_document_index
from .moodle import login
from .semesters import semester_payload
from .storage import ROOT, create_output_run_dir, ensure_dirs, read_json, slugify, utc_now, write_json
from .types import to_jsonable


def sync_moodle(
    *,
    course_limit: int | None = None,
    download: bool = True,
    download_limit_per_course: int = 0,
    max_bytes_per_file: int = 100_000_000,
    clean: bool = True,
    write_output: bool = True,
) -> Path:
    """Refresh Moodle course metadata and write compact agent course cards.

    The sync command treats Moodle as the source of truth for live course state.
    Local files remain a cache for heavy document content such as PDFs.
    """

    ensure_dirs()
    run_dir = create_output_run_dir("moodle-sync") if write_output else None
    cards_dir = run_dir / "course-cards" if run_dir else None

    if clean:
        _reset_sync_state(download=download)

    login_result = login()
    indexed_courses = [to_jsonable(course) for course in index_courses()]
    courses = indexed_courses[:course_limit] if course_limit and course_limit > 0 else indexed_courses

    if download:
        for course in courses:
            download_course_materials(
                course,
                download_limit=download_limit_per_course,
                max_bytes=max_bytes_per_file,
            )
        material_index = read_json(ROOT / "state" / "material_links.json", default={})
        material_courses = material_index.get("courses", []) if isinstance(material_index, dict) else []
    else:
        material_courses = discover_material_links(course_limit=course_limit, courses=courses)

    document_index_path = refresh_document_index()
    cards = _build_course_cards(courses, material_courses)
    if cards_dir:
        for card in cards:
            _write_course_card_markdown(cards_dir / f"{slugify(card['course_title'], 'course')}.md", card)

    summary = {
        "synced_at": utc_now(),
        "login_url_after": login_result.get("url_after"),
        "course_limit": course_limit,
        "download_enabled": download,
        "download_limit_per_course": download_limit_per_course if download else 0,
        "max_bytes_per_file": max_bytes_per_file if download else 0,
        "clean_sync": clean,
        "course_count": len(courses),
        "material_course_count": len(material_courses),
        "document_index": str(document_index_path.relative_to(ROOT)),
        "course_cards": cards,
    }
    if run_dir:
        write_json(run_dir / "sync-summary.json", summary)
        _write_sync_report(run_dir / "sync-report.md", summary)
    write_json(ROOT / "state" / "moodle_sync_summary.json", summary)
    write_json(ROOT / "state" / "course_agent_cards.json", {"generated_at": utc_now(), "courses": cards})
    return run_dir or ROOT / "state" / "moodle_sync_summary.json"


def _reset_sync_state(*, download: bool) -> None:
    for path in [
        ROOT / "state" / "material_links.json",
        ROOT / "state" / "document_index.json",
        ROOT / "state" / "course_agent_cards.json",
        ROOT / "state" / "moodle_sync_summary.json",
    ]:
        if path.exists():
            path.unlink()
    if download:
        materials_dir = ROOT / "data" / "moodle" / "materials"
        if materials_dir.exists():
            shutil.rmtree(materials_dir)
        materials_dir.mkdir(parents=True, exist_ok=True)


def _build_course_cards(courses: list[dict[str, Any]], material_courses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    materials_by_course_id = {
        str(course.get("course_id") or ""): course
        for course in material_courses
        if course.get("course_id") is not None
    }
    materials_by_title = {
        str(course.get("course_title") or ""): course
        for course in material_courses
        if course.get("course_title")
    }
    cards: list[dict[str, Any]] = []
    for course in courses:
        course_id = str(course.get("id") or "")
        course_title = str(course.get("title") or "Untitled course")
        material_course = materials_by_course_id.get(course_id) or materials_by_title.get(course_title) or {}
        links = material_course.get("links", []) if isinstance(material_course, dict) else []
        hint_counts = Counter(str(link.get("content_hint") or "unknown") for link in links)
        card = {
            "course_id": course_id,
            "course_title": course_title,
            "course_url": course.get("url"),
            "semester": course.get("semester") or (semester_payload(course_title) or {}).get("token"),
            "semester_period": semester_payload(course.get("semester") or course_title),
            "retrieved_at": material_course.get("retrieved_at"),
            "link_count": len(links),
            "link_counts_by_type": dict(sorted(hint_counts.items())),
            "quizzes": _compact_links(links, "quiz"),
            "assignments": _compact_links(links, "assignment"),
            "pages": _compact_links(links, "page"),
            "files": _compact_file_links(links),
            "agent_brief": _agent_brief(course_title, links, hint_counts),
        }
        if material_course.get("error"):
            card["sync_error"] = material_course.get("error")
        cards.append(card)
    return cards


def _compact_links(links: list[dict[str, Any]], content_hint: str, *, limit: int = 20) -> list[dict[str, Any]]:
    return [
        {
            "title": str(link.get("title") or link.get("url") or "Untitled"),
            "url": link.get("url"),
            "content_hint": link.get("content_hint"),
        }
        for link in links
        if str(link.get("content_hint") or "").casefold() == content_hint.casefold()
    ][:limit]


def _compact_file_links(links: list[dict[str, Any]], *, limit: int = 30) -> list[dict[str, Any]]:
    file_hints = {"file", "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "zip"}
    compacted = []
    for link in links:
        hint = str(link.get("content_hint") or "").casefold()
        url = str(link.get("url") or "").casefold()
        if hint not in file_hints and "/mod/resource/" not in url and "/pluginfile.php" not in url:
            continue
        download = link.get("download") if isinstance(link.get("download"), dict) else {}
        compacted.append(
            {
                "title": str(link.get("title") or link.get("url") or "Untitled"),
                "url": link.get("url"),
                "content_hint": link.get("content_hint"),
                "local_path": download.get("path"),
                "download_ok": download.get("ok"),
            }
        )
    return compacted[:limit]


def _agent_brief(course_title: str, links: list[dict[str, Any]], hint_counts: Counter[str]) -> str:
    parts = [
        f"Use this Moodle course card for routing tasks related to `{course_title}`.",
        "For current availability, quiz state, deadlines, and page text, open the listed Moodle URLs live with agent-browser.",
    ]
    if hint_counts.get("quiz"):
        parts.append(f"{hint_counts['quiz']} visible quiz link(s) were indexed.")
    if hint_counts.get("assignment"):
        parts.append(f"{hint_counts['assignment']} assignment link(s) were indexed.")
    file_count = sum(
        count
        for hint, count in hint_counts.items()
        if hint in {"file", "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "zip"}
    )
    if file_count:
        parts.append(f"{file_count} file/resource link(s) are candidates for the local document cache.")
    if not links:
        parts.append("No Moodle material links were visible during sync.")
    return " ".join(parts)


def _write_course_card_markdown(path: Path, card: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# {card['course_title']}",
        "",
        f"- Course ID: `{card.get('course_id')}`",
        f"- URL: {card.get('course_url')}",
        f"- Semester: {card.get('semester')}",
        f"- Semester period: {card.get('semester_period')}",
        f"- Indexed links: {card.get('link_count')}",
        f"- Link types: {card.get('link_counts_by_type')}",
        "",
        "## Agent Brief",
        "",
        str(card.get("agent_brief") or ""),
        "",
    ]
    for section, key in [("Quizzes", "quizzes"), ("Assignments", "assignments"), ("Pages", "pages"), ("Files", "files")]:
        items = card.get(key) or []
        if not items:
            continue
        lines.extend([f"## {section}", ""])
        for item in items:
            suffix = f" -> `{item.get('local_path')}`" if item.get("local_path") else ""
            lines.append(f"- {item.get('title')} - {item.get('url')}{suffix}")
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def _write_sync_report(path: Path, summary: dict[str, Any]) -> None:
    lines = [
        "# Moodle Sync Report",
        "",
        f"- Synced at: {summary.get('synced_at')}",
        f"- Courses indexed: {summary.get('course_count')}",
        f"- Moodle material course entries: {summary.get('material_course_count')}",
        f"- Download enabled: {summary.get('download_enabled')}",
        f"- Download limit per course: {summary.get('download_limit_per_course') or 'unlimited'}",
        f"- Max bytes per file: {summary.get('max_bytes_per_file')}",
        f"- Clean sync: {summary.get('clean_sync')}",
        f"- Document index: `{summary.get('document_index')}`",
        "",
        "## Courses",
        "",
    ]
    for card in summary.get("course_cards", []):
        counts = card.get("link_counts_by_type") or {}
        lines.append(f"- `{card.get('course_title')}`: {card.get('link_count')} links, types {counts}")
    lines.append("")
    lines.append("Moodle remains the source of truth. Local files are only a document-content cache.")
    path.write_text("\n".join(lines), encoding="utf-8")
