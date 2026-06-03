from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

from .browser import AgentBrowser, AgentBrowserError
from .knowledge import load_synced_courses
from .storage import ROOT, read_json, slugify, utc_now, write_json


def extract_pdf_text(pdf_path: Path) -> list[dict]:
    try:
        import pypdf  # type: ignore
    except ImportError:
        return []

    reader = pypdf.PdfReader(str(pdf_path))
    pages: list[dict] = []
    for index, page in enumerate(reader.pages, start=1):
        pages.append({"page": index, "text": page.extract_text() or ""})
    return pages


MATERIAL_LINKS_JS = r"""
(() => {
  const candidates = [...document.querySelectorAll("a[href]")];
  const materialHints = [
    "/mod/resource/",
    "/mod/folder/",
    "/mod/page/",
    "/mod/url/",
    "/mod/assign/",
    "/mod/quiz/",
    "/pluginfile.php",
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".zip"
  ];
  const links = [];
  const seen = new Set();
  for (const link of candidates) {
    const href = link.href || "";
    const lower = href.toLowerCase();
    if (!materialHints.some(hint => lower.includes(hint))) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({
      title: (link.innerText || link.getAttribute("aria-label") || link.title || href).trim(),
      url: href,
      content_hint: lower.includes("/mod/quiz/") ? "quiz" :
        lower.includes("/mod/assign/") ? "assignment" :
        lower.includes("/mod/folder/") ? "folder" :
        lower.includes("/mod/page/") ? "page" :
        lower.includes("/pluginfile.php") ? "file" :
        lower.split("?")[0].split(".").pop()
    });
  }
  return JSON.stringify(links);
})()
"""


def discover_material_links(
    course_limit: int | None = None,
    courses: list[dict] | None = None,
) -> list[dict]:
    courses = courses if courses is not None else load_synced_courses()
    if course_limit is not None and course_limit > 0:
        courses = courses[:course_limit]

    browser = AgentBrowser()
    discovered: list[dict] = []
    for course in courses:
        browser.open(course["url"])
        browser.wait_load()
        try:
            links = browser.eval_json(MATERIAL_LINKS_JS)
        except AgentBrowserError as exc:
            discovered.append(
                {
                    "course_id": course.get("id"),
                    "course_title": course.get("title"),
                    "error": str(exc),
                    "links": [],
                }
            )
            continue
        discovered.append(
            {
                "course_id": course.get("id"),
                "course_title": course.get("title"),
                "course_url": course.get("url"),
                "retrieved_at": utc_now(),
                "links": links,
            }
        )

    write_json(ROOT / "state" / "material_links.json", {"generated_at": utc_now(), "courses": discovered})
    return discovered


def discover_material_links_for_course(course: dict) -> dict:
    browser = AgentBrowser()
    browser.open(course["url"])
    browser.wait_load()
    try:
        links = browser.eval_json(MATERIAL_LINKS_JS)
    except AgentBrowserError as exc:
        return {
            "course_id": course.get("id"),
            "course_title": course.get("title"),
            "course_url": course.get("url"),
            "retrieved_at": utc_now(),
            "error": str(exc),
            "links": [],
        }
    return {
        "course_id": course.get("id"),
        "course_title": course.get("title"),
        "course_url": course.get("url"),
        "retrieved_at": utc_now(),
        "links": links,
    }


def _safe_material_path(course_title: str, url: str, content_type: str, title: str) -> Path:
    parsed = urlparse(url)
    name = Path(parsed.path).name or slugify(title, "material")
    if "." not in name:
        if "pdf" in content_type:
            name += ".pdf"
        elif "html" in content_type:
            name += ".html"
        else:
            name += ".bin"
    return ROOT / "data" / "moodle" / "materials" / slugify(course_title, "course") / name


def _download_with_browser(browser: AgentBrowser, link: dict, course_title: str, max_bytes: int) -> dict:
    js = f"""
(async () => {{
  const url = {json.dumps(link["url"])};
  const response = await fetch(url, {{ credentials: "include" }});
  const contentType = response.headers.get("content-type") || "";
  const length = Number(response.headers.get("content-length") || "0");
  if (length && length > {max_bytes}) {{
    return JSON.stringify({{
      ok: false,
      status: response.status,
      url: response.url,
      content_type: contentType,
      skipped: "content-length-exceeds-limit",
      content_length: length
    }});
  }}
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > {max_bytes}) {{
    return JSON.stringify({{
      ok: false,
      status: response.status,
      url: response.url,
      content_type: contentType,
      skipped: "body-exceeds-limit",
      content_length: buffer.byteLength
    }});
  }}
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {{
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }}
  return JSON.stringify({{
    ok: response.ok,
    status: response.status,
    url: response.url,
    content_type: contentType,
    content_length: buffer.byteLength,
    data: btoa(binary)
  }});
}})()
"""
    result = browser.eval_json(js)
    if not result.get("ok") or "data" not in result:
        return {**link, "download": result}

    target = _safe_material_path(
        course_title,
        result.get("url", link["url"]),
        result.get("content_type", ""),
        link["title"],
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(base64.b64decode(result["data"]))
    return {
        **link,
        "download": {
            "ok": True,
            "path": str(target.relative_to(ROOT)),
            "url": result.get("url"),
            "content_type": result.get("content_type"),
            "content_length": result.get("content_length"),
        },
    }


def download_materials(download_limit: int = 0, course_limit: int | None = None, max_bytes: int = 20_000_000) -> Path:
    discovered = discover_material_links(course_limit=course_limit)
    downloaded = 0
    browser = AgentBrowser()

    for course in discovered:
        for link in course.get("links", []):
            if download_limit > 0 and downloaded >= download_limit:
                continue
            hint = str(link.get("content_hint", "")).lower()
            url = str(link.get("url", "")).lower()
            if hint == "quiz":
                continue
            if not any(
                token in url
                for token in ["/mod/resource/", "/pluginfile.php", ".pdf", ".doc", ".ppt", ".xls", ".zip"]
            ):
                continue
            try:
                updated = _download_with_browser(browser, link, course.get("course_title", "course"), max_bytes)
                link.update(updated)
                if updated.get("download", {}).get("ok"):
                    downloaded += 1
            except Exception as exc:
                link["download"] = {"ok": False, "error": str(exc)}

    target = ROOT / "state" / "material_links.json"
    write_json(
        target,
        {
            "generated_at": utc_now(),
            "download_limit": download_limit,
            "downloaded": downloaded,
            "courses": discovered,
        },
    )
    refresh_document_index()
    return target


def download_course_materials(course: dict, download_limit: int = 80, max_bytes: int = 20_000_000) -> Path:
    discovered_course = discover_material_links_for_course(course)
    downloaded = 0
    browser = AgentBrowser()

    for link in discovered_course.get("links", []):
        if download_limit > 0 and downloaded >= download_limit:
            continue
        hint = str(link.get("content_hint", "")).lower()
        url = str(link.get("url", "")).lower()
        if hint == "quiz":
            continue
        if not any(
            token in url
            for token in ["/mod/resource/", "/pluginfile.php", ".pdf", ".doc", ".ppt", ".xls", ".zip"]
        ):
            continue
        try:
            updated = _download_with_browser(browser, link, course.get("title") or course.get("course_title") or "course", max_bytes)
            link.update(updated)
            if updated.get("download", {}).get("ok"):
                downloaded += 1
        except Exception as exc:
            link["download"] = {"ok": False, "error": str(exc)}

    material_index = read_json(ROOT / "state" / "material_links.json", default={})
    courses = material_index.get("courses", []) if isinstance(material_index, dict) else []
    course_id = str(course.get("id") or discovered_course.get("course_id") or "")
    merged: list[dict] = []
    replaced = False
    for existing in courses:
        if str(existing.get("course_id") or "") == course_id and course_id:
            merged.append(discovered_course)
            replaced = True
        else:
            merged.append(existing)
    if not replaced:
        merged.append(discovered_course)

    target = ROOT / "state" / "material_links.json"
    write_json(
        target,
        {
            "generated_at": utc_now(),
            "download_limit": download_limit,
            "downloaded": downloaded,
            "courses": merged,
        },
    )
    refresh_document_index()
    return target


def refresh_document_index() -> Path:
    materials_dir = ROOT / "data" / "moodle" / "materials"
    entries: list[dict] = []
    for path in sorted(materials_dir.rglob("*")):
        if not path.is_file():
            continue
        entry = {
            "path": str(path.relative_to(ROOT)),
            "name": path.name,
            "suffix": path.suffix.lower(),
            "indexed_at": utc_now(),
        }
        if path.suffix.lower() == ".pdf":
            pages = extract_pdf_text(path)
            if pages:
                entry["pages"] = pages
            else:
                entry["note"] = "Install pypdf to extract PDF text."
        entries.append(entry)
    target = ROOT / "state" / "document_index.json"
    write_json(target, {"documents": entries, "indexed_at": utc_now()})
    return target


def install_pdf_dependency_hint() -> str:
    result = subprocess.run(
        [sys.executable, "-c", "import pypdf"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return "pypdf is installed."
    return "Optional PDF extraction dependency missing. Install with `python -m pip install pypdf`."
