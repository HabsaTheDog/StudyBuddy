from __future__ import annotations

from urllib.parse import urljoin

from .browser import AgentBrowser
from .storage import ROOT, require_env, utc_now, write_json
from .types import Course, to_jsonable


COURSE_EXTRACTION_JS = r"""
(() => {
  const links = [...document.querySelectorAll("a[href*='/course/view.php']")];
  const seen = new Set();
  const courses = [];
  for (const link of links) {
    const href = link.href;
    const title = (link.innerText || link.getAttribute("aria-label") || link.title || "").trim();
    if (!href || !title || seen.has(href)) continue;
    seen.add(href);
    const url = new URL(href);
    courses.push({
      id: url.searchParams.get("id") || href,
      title,
      url: href,
      semester: null
    });
  }
  return JSON.stringify(courses);
})()
"""


def index_courses() -> list[Course]:
    env = require_env(["MOODLE_DASHBOARD_URL"])
    browser = AgentBrowser()
    browser.open(env["MOODLE_DASHBOARD_URL"])
    browser.wait_load()
    raw_courses = browser.eval_json(COURSE_EXTRACTION_JS)
    courses = [
        Course(
            id=str(item.get("id") or item["url"]),
            title=" ".join(str(item.get("title", "")).split()),
            url=urljoin(env["MOODLE_DASHBOARD_URL"], item["url"]),
            semester=item.get("semester"),
        )
        for item in raw_courses
        if item.get("url") and item.get("title")
    ]
    target = ROOT / "state" / "course_index.json"
    write_json(
        target,
        {
            "dashboard_url": env["MOODLE_DASHBOARD_URL"],
            "indexed_at": utc_now(),
            "courses": to_jsonable(courses),
        },
    )
    return courses
