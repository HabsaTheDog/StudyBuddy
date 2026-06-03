from __future__ import annotations

import json
from pathlib import Path

from .browser import AgentBrowser, AgentBrowserError
from .storage import ROOT, require_env


LOGIN_PAGE_TOKENS = (
    "moodle login",
    "log in",
    "username",
    "password",
    "kennwort",
    "session has timed out",
    "sitzung ist abgelaufen",
)

LOGIN_URL_TOKENS = (
    "errorcode=4",
    "/login/",
)


def load_selectors() -> dict:
    return json.loads((ROOT / "config" / "moodle.selectors.json").read_text(encoding="utf-8"))


def login() -> dict:
    env = require_env(["MOODLE_DASHBOARD_URL", "MOODLE_USERNAME", "MOODLE_PASSWORD"])
    browser = AgentBrowser()
    browser.open(env["MOODLE_DASHBOARD_URL"])
    browser.wait_load()

    selectors = load_selectors()["login"]
    current_url = browser.get_url()
    snapshot = browser.snapshot(interactive=True)
    login_needed = _is_login_or_timeout_page(browser.get_url(), browser.get_title(), snapshot)

    if login_needed:
        _submit_login_form(browser, selectors, env["MOODLE_USERNAME"], env["MOODLE_PASSWORD"])

    url_after = browser.get_url()
    title = browser.get_title()
    snapshot_after = browser.snapshot(interactive=True)
    if _is_login_or_timeout_page(url_after, title, snapshot_after):
        browser.open(env["MOODLE_DASHBOARD_URL"])
        browser.wait_load()
        retry_snapshot = browser.snapshot(interactive=True)
        if _is_login_or_timeout_page(browser.get_url(), browser.get_title(), retry_snapshot):
            _submit_login_form(browser, selectors, env["MOODLE_USERNAME"], env["MOODLE_PASSWORD"])
            url_after = browser.get_url()
            title = browser.get_title()
            snapshot_after = browser.snapshot(interactive=True)

    if _is_login_or_timeout_page(url_after, title, snapshot_after):
        raise AgentBrowserError(
            "Moodle login did not complete; still on login or session-timeout page. "
            f"Current URL: {url_after}"
        )

    return {
        "url_before": current_url,
        "url_after": url_after,
        "title": title,
        "authenticated": True,
    }


def _is_login_or_timeout_page(url: str, title: str, snapshot: str) -> bool:
    url_folded = url.casefold()
    if any(token in url_folded for token in LOGIN_URL_TOKENS):
        return True

    haystack = f"{title}\n{snapshot}".casefold()
    has_login_form = any(token in haystack for token in ("username", "password", "kennwort"))
    has_login_context = any(token in haystack for token in ("moodle login", "log in", "session has timed out", "sitzung ist abgelaufen"))
    return has_login_form and has_login_context


def _submit_login_form(browser: AgentBrowser, selectors: dict, username: str, password: str) -> None:
    _dismiss_login_overlays(browser)
    filled_username = _try_fill(browser, selectors["username_selectors"], username)
    filled_password = _try_fill(browser, selectors["password_selectors"], password)
    if not filled_username or not filled_password:
        raise AgentBrowserError("Could not find Moodle username/password fields.")
    clicked = _try_click(browser, selectors["submit_selectors"])
    if not clicked:
        browser.run(["press", "Enter"], check=False)
    browser.wait_load()


def _dismiss_login_overlays(browser: AgentBrowser) -> None:
    clicked = _try_click(
        browser,
        [
            "text=Continue",
            "a:has-text('Continue')",
            "button:has-text('Continue')",
            "text=Weiter",
            "a:has-text('Weiter')",
            "button:has-text('Weiter')",
        ],
    )
    if clicked:
        browser.wait_load()


def _try_fill(browser: AgentBrowser, selectors: list[str], value: str) -> bool:
    for selector in selectors:
        try:
            browser.batch([["fill", selector, value]], check=True)
            return True
        except AgentBrowserError:
            continue
    return False


def _try_click(browser: AgentBrowser, selectors: list[str]) -> bool:
    for selector in selectors:
        try:
            browser.batch([["click", selector]], check=True)
            return True
        except AgentBrowserError:
            continue
    return False


def snapshot(url: str | None = None) -> str:
    env = require_env(["MOODLE_DASHBOARD_URL"])
    browser = AgentBrowser()
    browser.open(url or env["MOODLE_DASHBOARD_URL"])
    browser.wait_load()
    return browser.snapshot(interactive=True)
