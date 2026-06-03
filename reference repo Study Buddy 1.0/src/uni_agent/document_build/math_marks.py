from __future__ import annotations

import re
import subprocess
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from ..storage import ROOT
from .contracts import TaskRef


@dataclass(frozen=True)
class MarkedTask:
    task: TaskRef
    page: int
    confidence: float
    marker_y: float


def detect_marked_tasks(pdf_path: Path, topic: int, work_dir: Path) -> list[MarkedTask]:
    """Detect red checkmarks next to Aufgabe headings in a worksheet PDF.

    This intentionally returns only high-confidence matches. If the source PDF or
    image conversion does not expose enough signal, callers should ask for
    clarification instead of guessing.
    """

    headings = _extract_task_headings(pdf_path)
    if not headings:
        return []
    image_prefix = work_dir / f"{pdf_path.stem}-page"
    image_prefix.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["pdftoppm", "-png", "-r", "160", str(pdf_path), str(image_prefix)], cwd=ROOT, check=False, capture_output=True)
    marked: list[MarkedTask] = []
    for page_number, page_headings in headings.items():
        image_path = image_prefix.parent / f"{image_prefix.name}-{page_number}.png"
        if not image_path.exists():
            continue
        clusters, page_height = _red_marker_clusters(image_path)
        pdf_height = page_headings[0][2]
        for cluster_y in clusters:
            y_pdf = cluster_y / page_height * pdf_height
            if y_pdf < 250:
                continue
            candidates = [(task, abs(y_pdf - y), y) for task, y, _height in page_headings if abs(y_pdf - y) <= 35]
            if not candidates:
                continue
            task_number, distance, _heading_y = min(candidates, key=lambda item: item[1])
            confidence = max(0.75, 1.0 - distance / 35.0)
            marked.append(MarkedTask(task=TaskRef(topic=topic, task=task_number, raw=f"{topic}/{task_number}"), page=page_number, confidence=round(confidence, 3), marker_y=round(y_pdf, 2)))
    return _dedupe_marked(marked)


def _extract_task_headings(pdf_path: Path) -> dict[int, list[tuple[int, float, float]]]:
    completed = subprocess.run(["pdftotext", "-bbox", str(pdf_path), "-"], cwd=ROOT, text=True, capture_output=True)
    if completed.returncode != 0 or not completed.stdout.strip():
        return {}
    root = ET.fromstring(_strip_invalid_xml_chars(completed.stdout))
    result: dict[int, list[tuple[int, float, float]]] = {}
    for page_index, page in enumerate(root.findall(".//{*}page"), start=1):
        height = float(page.attrib.get("height") or 0)
        words = list(page.findall("{*}word"))
        for index, word in enumerate(words[:-1]):
            if (word.text or "").casefold().replace("ü", "ü") != "aufgabe":
                continue
            next_text = words[index + 1].text or ""
            match = re.match(r"(\d+)", next_text)
            if not match:
                continue
            task_number = int(match.group(1))
            y_min = float(word.attrib.get("yMin") or 0)
            result.setdefault(page_index, []).append((task_number, y_min, height))
    return result


def _strip_invalid_xml_chars(value: str) -> str:
    return "".join(
        char
        for char in value
        if char in "\t\n\r" or 0x20 <= ord(char) <= 0xD7FF or 0xE000 <= ord(char) <= 0xFFFD
    )


def _red_marker_clusters(image_path: Path) -> tuple[list[float], int]:
    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    rows: list[int] = []
    for y in range(height):
        count = 0
        for x in range(int(width * 0.55), width):
            r, g, b = image.getpixel((x, y))
            if r > 140 and g < 120 and b < 120 and r > g * 1.4 and r > b * 1.4:
                count += 1
        if count >= 4:
            rows.append(y)
    if not rows:
        return [], height
    clusters: list[list[int]] = [[rows[0]]]
    for row in rows[1:]:
        if row - clusters[-1][-1] <= 8:
            clusters[-1].append(row)
        else:
            clusters.append([row])
    centers = [(cluster[0] + cluster[-1]) / 2 for cluster in clusters if len(cluster) >= 3]
    return centers, height


def _dedupe_marked(marked: list[MarkedTask]) -> list[MarkedTask]:
    by_key: dict[tuple[int | None, int | None], MarkedTask] = {}
    for item in marked:
        existing = by_key.get(item.task.key)
        if existing is None or item.confidence > existing.confidence:
            by_key[item.task.key] = item
    return sorted(by_key.values(), key=lambda item: (item.task.topic or 0, item.task.task or 0))
