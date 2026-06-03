from __future__ import annotations

from typing import Any
from urllib.parse import parse_qsl, urlparse

from .browser import AgentBrowser
from .courses import index_courses
from .knowledge import load_synced_courses
from .moodle import login
from .storage import utc_now


VALIDATE_ACTIVITY_JS = r"""
(() => {
  const body = document.body ? document.body.innerText : "";
  return JSON.stringify({
    title: document.title,
    url: location.href,
    body_excerpt: body.slice(0, 2000),
    has_quiz_view: location.href.includes("/mod/quiz/view.php"),
    has_error: /Ungültige Kursmodul-ID|invalid course module|error/i.test(body),
    is_home: /Home \| FHTW Moodle/i.test(document.title)
  });
})()
"""


def run_moodle_preflight(target_course: dict[str, Any] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"checked_at": utc_now(), "actions": []}
    courses = load_synced_courses(refresh_if_missing=False)
    result["initial_course_count"] = len(courses)
    if len(courses) < 20:
        login_result = login()
        result["actions"].append({"action": "login", "url_after": login_result.get("url_after")})
        courses = [course.__dict__ for course in index_courses()]
        result["actions"].append({"action": "index_courses", "count": len(courses)})
    result["course_count"] = len(courses)
    if target_course:
        browser = AgentBrowser(mode="read")
        browser.open(str(target_course["url"]))
        browser.wait_load()
        result["target_course"] = {
            "title": target_course.get("title"),
            "url": target_course.get("url"),
            "resolved_url": browser.get_url(),
            "page_title": browser.get_title(),
            "ok": str(target_course.get("id") or "") in browser.get_url() or "course/view.php" in browser.get_url(),
        }
    return result


def validate_quiz_activity_url(activity: dict[str, Any], *, browser: AgentBrowser | None = None) -> dict[str, Any]:
    browser = browser or AgentBrowser(mode="read")
    url = str(activity.get("url") or "")
    browser.open(url)
    browser.wait_load()
    state = browser.eval_json(VALIDATE_ACTIVITY_JS)
    expected_cmid = str(activity.get("cmid") or _cmid_from_url(url))
    actual_cmid = _cmid_from_url(str(state.get("url") or ""))
    resolved_url = str(state.get("url") or "")
    ok = (
        ("/mod/quiz/view.php" in resolved_url or "/mod/quiz/attempt.php" in resolved_url or "/mod/quiz/summary.php" in resolved_url)
        and not state.get("is_home")
        and not state.get("has_error")
        and (not expected_cmid or not actual_cmid or expected_cmid == actual_cmid)
    )
    return {
        "checked_at": utc_now(),
        "activity": activity,
        "state": state,
        "expected_cmid": expected_cmid,
        "actual_cmid": actual_cmid,
        "ok": ok,
        "status": "ok" if ok else "stale_url",
    }


def _cmid_from_url(url: str) -> str:
    parsed = urlparse(url)
    return str(dict(parse_qsl(parsed.query, keep_blank_values=True)).get("id") or "")
