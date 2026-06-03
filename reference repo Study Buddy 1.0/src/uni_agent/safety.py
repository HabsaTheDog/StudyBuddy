from __future__ import annotations

import json
from pathlib import Path

from .storage import ROOT


def _load_config(name: str) -> dict:
    return json.loads((ROOT / "config" / name).read_text(encoding="utf-8"))


def normalize(value: str) -> str:
    return value.casefold().replace("ß", "ss")


def contains_any(text: str, patterns: list[str]) -> list[str]:
    haystack = normalize(text)
    return [pattern for pattern in patterns if normalize(pattern) in haystack]


def find_submit_risks(text: str) -> list[str]:
    policy = _load_config("agent-browser.policy.json")
    return contains_any(text, policy.get("deny_text_patterns", []))


def assessment_risk_flags(text: str) -> list[str]:
    guardrails = _load_config("quiz.guardrails.json")
    risks = contains_any(text, guardrails.get("high_risk_terms", []))
    return [f"high-risk-term:{item}" for item in risks]


def looks_safe_practice(text: str) -> bool:
    guardrails = _load_config("quiz.guardrails.json")
    return bool(contains_any(text, guardrails.get("safe_terms", [])))


def should_use_review_only(text: str) -> tuple[bool, list[str]]:
    flags = assessment_risk_flags(text)
    if looks_safe_practice(text):
        # Moodle help/example pages can mention exam-related features while still
        # being explicit practice/example content. Allow only under --fill-safe;
        # final submit controls are still blocked independently.
        return False, []
    if flags:
        return True, flags
    return True, ["ambiguous-assessment-context"]
