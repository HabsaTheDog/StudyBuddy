from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Literal
from urllib.parse import parse_qsl, urlparse

from .browser import AgentBrowser
from .storage import utc_now


ActivityType = Literal["quiz", "resource", "folder", "page", "assignment", "unknown"]
ActivityKind = Literal["test_block", "rechenuebung", "quiz", "other"]


@dataclass(frozen=True)
class MoodleActivity:
    course_id: str
    course_title: str
    course_url: str
    cmid: str
    url: str
    type: ActivityType
    title: str
    normalized_title: str
    activity_kind: ActivityKind
    block_number: int | None
    section_title: str | None
    section_index: int | None
    completion_text: str | None
    visible_context: str
    source: Literal["live", "cache"]
    retrieved_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


ACTIVITY_DISCOVERY_JS = r"""
(() => {
  const normalize = text => (text || "").replace(/\s+/g, " ").trim();
  const activityNodes = [...document.querySelectorAll("li.activity, .activity, [data-activityname]")];
  const sectionNodes = [...document.querySelectorAll("li.section, section.course-section, .course-section, [data-sectionid]")];
  const sectionIndex = node => {
    const section = node.closest("li.section, section.course-section, .course-section, [data-sectionid]");
    if (!section) return null;
    const explicit = section.getAttribute("data-sectionid") || section.getAttribute("data-number");
    if (explicit && /^\d+$/.test(explicit)) return Number(explicit);
    const idx = sectionNodes.indexOf(section);
    return idx >= 0 ? idx : null;
  };
  const sectionTitle = node => {
    const section = node.closest("li.section, section.course-section, .course-section, [data-sectionid]");
    if (!section) return null;
    const heading = section.querySelector("h2, h3, h4, .sectionname, [data-for='section_title']");
    return normalize(heading ? heading.innerText : "");
  };
  const activityFor = link => link.closest("li.activity, .activity, [data-activityname]") || link;
  const links = [...document.querySelectorAll("a[href]")];
  const out = [];
  for (const link of links) {
    const href = link.href || "";
    if (!/\/mod\/(quiz|resource|folder|page|assign|url)\//.test(href) && !href.includes("/pluginfile.php")) continue;
    const activity = activityFor(link);
    const linkText = normalize(link.innerText || link.getAttribute("aria-label") || link.title || "");
    const activityName = normalize(activity.getAttribute && activity.getAttribute("data-activityname"));
    const activityText = normalize(activity.innerText || "");
    const title = linkText || activityName || activityText.split(" ").slice(0, 12).join(" ") || href;
    const completionNode = activity.querySelector(".completion-info, .automatic-completion-conditions, [data-region='completion-info']");
    out.push({
      title,
      link_text: linkText,
      activity_text: activityText,
      section_title: sectionTitle(activity),
      section_index: sectionIndex(activity),
      completion_text: normalize(completionNode ? completionNode.innerText : ""),
      url: href
    });
  }
  return JSON.stringify(out);
})()
"""


def parse_requested_activity(prompt: str) -> dict[str, Any] | None:
    prompt_lower = prompt.casefold()
    kind: ActivityKind | None = None
    if re.search(r"\b(test\s*bl[oö]ck(?:e|en)?|testblock(?:e|en)?|tests?\s+block|block\s+\d)\b", prompt_lower):
        kind = "test_block"
    elif re.search(r"\b(rechen\s*[uü]bung(?:en)?|rechenuebung(?:en)?)\b", prompt_lower):
        kind = "rechenuebung"
    if kind is None:
        return None

    numbers: list[int] = []
    for start, end in re.findall(r"(\d+)\s*(?:-|bis|to)\s*(\d+)", prompt_lower):
        a, b = int(start), int(end)
        step = 1 if a <= b else -1
        numbers.extend(range(a, b + step, step))
    if not numbers:
        marker_patterns = [
            r"test\s*bl[oö]ck(?:e|en)?\s+([0-9,\sund&+/]+)",
            r"testblock(?:e|en)?\s+([0-9,\sund&+/]+)",
            r"block\s+([0-9,\sund&+/]+)",
            r"rechen\s*[uü]bung(?:en)?\s+([0-9,\sund&+/]+)",
            r"rechenuebung(?:en)?\s+([0-9,\sund&+/]+)",
        ]
        for pattern in marker_patterns:
            match = re.search(pattern, prompt_lower)
            if match:
                numbers.extend(int(value) for value in re.findall(r"\d+", match.group(1)))
                break
    if not numbers:
        return {"kind": kind, "block_numbers": []}
    deduped = list(dict.fromkeys(numbers))
    return {"kind": kind, "block_numbers": deduped}


def discover_live_activities(course: dict[str, Any], *, browser: AgentBrowser | None = None) -> list[MoodleActivity]:
    browser = browser or AgentBrowser(mode="read")
    browser.open(str(course["url"]))
    browser.wait_load()
    raw_activities = browser.eval_json(ACTIVITY_DISCOVERY_JS)
    activities: list[MoodleActivity] = []
    seen: set[tuple[str, str]] = set()
    for raw in raw_activities:
        url = str(raw.get("url") or "")
        cmid = _cmid_from_url(url)
        title = _best_title(raw)
        normalized = normalize_activity_title(title)
        key = (cmid or url, normalized)
        if key in seen:
            continue
        seen.add(key)
        activity_type = _activity_type(url)
        kind, block_number = classify_activity(title, raw.get("activity_text") or "")
        activities.append(
            MoodleActivity(
                course_id=str(course.get("id") or ""),
                course_title=str(course.get("title") or ""),
                course_url=str(course.get("url") or ""),
                cmid=cmid,
                url=url,
                type=activity_type,
                title=title,
                normalized_title=normalized,
                activity_kind=kind,
                block_number=block_number,
                section_title=raw.get("section_title"),
                section_index=raw.get("section_index"),
                completion_text=raw.get("completion_text"),
                visible_context=str(raw.get("activity_text") or ""),
                source="live",
                retrieved_at=utc_now(),
            )
        )
    return activities


def resolve_requested_activities(prompt: str, course: dict[str, Any], *, browser: AgentBrowser | None = None) -> dict[str, Any]:
    requested = parse_requested_activity(prompt)
    activities = discover_live_activities(course, browser=browser)
    if not requested:
        return {"requested": None, "activities": [item.to_dict() for item in activities], "resolved": [], "missing": []}
    kind = requested["kind"]
    numbers = requested["block_numbers"]
    candidates = [item for item in activities if item.type == "quiz" and item.activity_kind == kind]
    if numbers:
        resolved = [item for number in numbers for item in candidates if item.block_number == number]
        found_numbers = {item.block_number for item in resolved}
        missing = [number for number in numbers if number not in found_numbers]
    else:
        resolved = candidates
        missing = []
    resolved.sort(key=lambda item: (item.block_number is None, item.block_number or 0, item.title))
    return {
        "requested": requested,
        "activities": [item.to_dict() for item in activities],
        "resolved": [item.to_dict() for item in resolved],
        "missing": missing,
    }


def classify_activity(title: str, context: str = "") -> tuple[ActivityKind, int | None]:
    haystack = normalize_activity_title(f"{title} {context}")
    test_match = re.search(r"\btest\s*block\s*(\d+)\b", haystack)
    if test_match:
        return "test_block", int(test_match.group(1))
    rechen_match = re.search(r"\brechen(?:uebung|ubung|übung)(?:en)?\s*(\d+)\b", haystack)
    if rechen_match:
        return "rechenuebung", int(rechen_match.group(1))
    if "quiz" in haystack or "test" in haystack:
        return "quiz", None
    return "other", None


def normalize_activity_title(title: str) -> str:
    normalized = title.casefold()
    normalized = normalized.replace("ö", "oe").replace("ü", "ue").replace("ä", "ae").replace("ß", "ss")
    return re.sub(r"\s+", " ", normalized).strip()


def _best_title(raw: dict[str, Any]) -> str:
    candidates = [
        str(raw.get("title") or ""),
        str(raw.get("link_text") or ""),
        str(raw.get("activity_text") or ""),
        str(raw.get("url") or ""),
    ]
    for candidate in candidates:
        clean = re.sub(r"\s+", " ", candidate).strip()
        if clean:
            return clean[:220]
    return "Untitled activity"


def _cmid_from_url(url: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    return str(query.get("id") or "")


def _activity_type(url: str) -> ActivityType:
    lower = url.casefold()
    if "/mod/quiz/" in lower:
        return "quiz"
    if "/mod/resource/" in lower or "/pluginfile.php" in lower:
        return "resource"
    if "/mod/folder/" in lower:
        return "folder"
    if "/mod/page/" in lower or "/mod/url/" in lower:
        return "page"
    if "/mod/assign/" in lower:
        return "assignment"
    return "unknown"
