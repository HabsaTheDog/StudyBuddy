from __future__ import annotations

from enum import Enum
from typing import Any

from .browser import AgentBrowser


class QuizPageState(Enum):
    VIEW = "view"
    ATTEMPT_PAGE = "attempt_page"
    SUMMARY = "summary"
    REVIEW = "review"
    HOME_OR_ERROR = "home_or_error"
    UNKNOWN = "unknown"


DENY_FINAL_TERMS = [
    "submit all and finish",
    "endgültig abgeben",
    "endgueltig abgeben",
    "endgültig absenden",
    "endgueltig absenden",
    "abgeben",
]

FINISH_TO_SUMMARY_TERMS = ["versuch abschließen", "versuch abschliessen", "finish attempt"]
NEXT_PAGE_TERMS = ["nächste seite", "naechste seite", "next page", "weiter"]
START_TERMS = ["test versuchen", "attempt quiz", "versuch beginnen", "versuch fortsetzen", "continue attempt", "start attempt"]


PAGE_STATE_JS = r"""
(() => {
  const text = document.body ? document.body.innerText : "";
  const url = location.href;
  let state = "unknown";
  if (/Home \| FHTW Moodle/i.test(document.title) || /Ungültige Kursmodul-ID|invalid course module/i.test(text)) state = "home_or_error";
  else if (url.includes("/mod/quiz/summary.php")) state = "summary";
  else if (url.includes("/mod/quiz/review.php")) state = "review";
  else if (url.includes("/mod/quiz/attempt.php")) state = "attempt_page";
  else if (url.includes("/mod/quiz/view.php")) state = "view";
  return JSON.stringify({state, title: document.title, url, body_excerpt: text.slice(0, 1500)});
})()
"""


def detect_quiz_page_state(browser: AgentBrowser) -> dict[str, Any]:
    return browser.eval_json(PAGE_STATE_JS)


def is_final_submit_text(text: str) -> bool:
    normalized = text.casefold()
    return any(term in normalized for term in DENY_FINAL_TERMS)


def is_finish_to_summary_text(text: str) -> bool:
    normalized = text.casefold()
    return any(term in normalized for term in FINISH_TO_SUMMARY_TERMS) and not is_final_submit_text(normalized.replace("versuch abschließen", ""))


def click_start_or_continue_attempt(browser: AgentBrowser) -> dict[str, Any]:
    return browser.eval_json(_click_control_js(START_TERMS, deny_terms=DENY_FINAL_TERMS))


def click_next_page(browser: AgentBrowser) -> dict[str, Any]:
    return browser.eval_json(_click_control_js(NEXT_PAGE_TERMS, deny_terms=DENY_FINAL_TERMS + FINISH_TO_SUMMARY_TERMS))


def click_finish_attempt_to_summary(browser: AgentBrowser) -> dict[str, Any]:
    return browser.eval_json(_click_control_js(FINISH_TO_SUMMARY_TERMS, deny_terms=DENY_FINAL_TERMS))


def verify_questions_persisted(browser: AgentBrowser) -> list[dict[str, Any]]:
    return browser.eval_json(r"""
(() => JSON.stringify([...document.querySelectorAll(".que, [id^='question-']")].map((q, idx) => {
  const text = (q.innerText || "").replace(/\s+/g, " ").trim();
  const checked = [...q.querySelectorAll("input[type='checkbox'], input[type='radio']")]
    .filter(input => input.checked)
    .map(input => ({ id: input.id || null, name: input.name || null }));
  const text_values = [...q.querySelectorAll("input[type='text'], input[type='number'], textarea")]
    .map(input => input.value || "")
    .filter(Boolean);
  return {
    question_id: q.id || `question-${idx + 1}`,
    saved: /Antwort gespeichert|Answer saved/i.test(text) || checked.length > 0 || text_values.length > 0,
    moodle_status: /Antwort gespeichert|Answer saved/i.test(text) ? "Antwort gespeichert" :
      /Bisher nicht beantwortet|Not yet answered/i.test(text) ? "Bisher nicht beantwortet" : "unknown",
    checked,
    text_values
  };
})))()
""")


def _click_control_js(allow_terms: list[str], *, deny_terms: list[str]) -> str:
    return f"""
(() => {{
  const allow = {allow_terms!r};
  const deny = {deny_terms!r};
  const controls = [...document.querySelectorAll("button, input[type='submit'], a.btn, a[role='button']")];
  for (const control of controls) {{
    const text = (control.innerText || control.value || control.getAttribute("aria-label") || "").trim().toLowerCase();
    if (!text) continue;
    if (deny.some(term => text.includes(term))) continue;
    if (allow.some(term => text.includes(term))) {{
      control.click();
      return JSON.stringify({{ clicked: true, text }});
    }}
  }}
  return JSON.stringify({{ clicked: false }});
}})()
"""
