from __future__ import annotations

import re
from typing import Any

from .storage import ROOT, read_json


COURSE_ALIASES = {
    "math": ["math", "mathe", "mathematik", "maes", "engineering science"],
    "electrical": ["elektrotechnik", "electrical", "etlb"],
    "dynamics": ["dynamik", "dynamic", "dyn", "phdyn"],
    "english": ["english", "eng"],
}


def load_course_cards() -> list[dict[str, Any]]:
    data = read_json(ROOT / "state" / "course_agent_cards.json", default={})
    courses = data.get("courses") if isinstance(data, dict) else None
    return courses if isinstance(courses, list) else []


def load_synced_courses(*, refresh_if_missing: bool = False) -> list[dict[str, Any]]:
    cards = load_course_cards()
    if cards:
        return [_course_from_card(card) for card in cards]
    index = read_json(ROOT / "state" / "course_index.json", default={})
    courses = index.get("courses") if isinstance(index, dict) else None
    if isinstance(courses, list) and courses:
        return courses
    if refresh_if_missing:
        from .sync import sync_moodle

        sync_moodle(download=False, write_output=False)
        return load_synced_courses(refresh_if_missing=False)
    return []


def course_briefs_for_prompt(prompt: str, *, limit: int = 4) -> list[dict[str, Any]]:
    cards = load_course_cards()
    ranked = rank_course_cards(prompt, cards)
    return [_brief_from_card(card) for card in ranked[:limit]]


def course_brief_for_url(url: str | None) -> dict[str, Any] | None:
    if not url:
        return None
    for card in load_course_cards():
        candidates = [card.get("course_url")]
        for key in ["quizzes", "assignments", "pages", "files"]:
            candidates.extend(item.get("url") for item in card.get(key, []) if isinstance(item, dict))
        if any(candidate and str(candidate) in url for candidate in candidates):
            return _brief_from_card(card)
    return None


def rank_course_cards(prompt: str, cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    terms = _terms_from_text(prompt)
    prompt_lower = prompt.casefold()
    ranked: list[dict[str, Any]] = []
    for card in cards:
        haystack = _card_haystack(card)
        score = sum(4 if len(term) > 3 else 2 for term in terms if term in haystack)
        for canonical, aliases in COURSE_ALIASES.items():
            if canonical in terms or any(alias in prompt_lower for alias in aliases):
                if any(alias in haystack for alias in aliases):
                    score += 8
        if any(marker in prompt_lower for marker in ["dynamik 1", "dyn1", "phdyn", "physikalische grundlagen der dynamik"]):
            if "phdyn" in haystack or "physikalische grundlagen der dynamik" in haystack:
                score += 20
            if "dyn2" in haystack or "anwendungen der dynamik" in haystack:
                score -= 6
        if any(marker in prompt_lower for marker in ["dynamik 2", "dyn2", "anwendungen der dynamik"]):
            if "dyn2" in haystack or "anwendungen der dynamik" in haystack:
                score += 20
        if score:
            ranked.append({**card, "score": score})
    ranked.sort(key=lambda item: (-int(item.get("score") or 0), str(item.get("course_title") or "")))
    return ranked


def _course_from_card(card: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": card.get("course_id"),
        "title": card.get("course_title"),
        "url": card.get("course_url"),
        "semester": card.get("semester"),
        "semester_period": card.get("semester_period"),
        "agent_brief": card.get("agent_brief"),
        "sync_retrieved_at": card.get("retrieved_at"),
        "link_counts_by_type": card.get("link_counts_by_type"),
        "quizzes": card.get("quizzes") or [],
        "assignments": card.get("assignments") or [],
        "pages": card.get("pages") or [],
        "files": card.get("files") or [],
    }


def _brief_from_card(card: dict[str, Any]) -> dict[str, Any]:
    return {
        "course_id": card.get("course_id"),
        "course_title": card.get("course_title"),
        "course_url": card.get("course_url"),
        "retrieved_at": card.get("retrieved_at"),
        "link_counts_by_type": card.get("link_counts_by_type"),
        "agent_brief": card.get("agent_brief"),
        "quizzes": card.get("quizzes", [])[:10],
        "assignments": card.get("assignments", [])[:10],
        "pages": card.get("pages", [])[:10],
        "files": card.get("files", [])[:10],
    }


def _card_haystack(card: dict[str, Any]) -> str:
    parts = [
        card.get("course_title"),
        card.get("course_id"),
        card.get("agent_brief"),
    ]
    for key in ["quizzes", "assignments", "pages", "files"]:
        for item in card.get(key, []) or []:
            if isinstance(item, dict):
                parts.extend([item.get("title"), item.get("url")])
    return " ".join(str(part) for part in parts if part).casefold()


def _terms_from_text(text: str) -> set[str]:
    stop = {
        "the",
        "next",
        "quiz",
        "test",
        "please",
        "moodle",
        "aufgabe",
        "erstelle",
        "eine",
        "einen",
        "für",
        "fuer",
        "und",
        "oder",
        "bearbeite",
        "loese",
        "löse",
    }
    terms = {
        word.casefold()
        for word in re.findall(r"[a-zA-ZäöüÄÖÜß0-9]{3,}", text)
        if word.casefold() not in stop
    }
    prompt_lower = text.casefold()
    for canonical, aliases in COURSE_ALIASES.items():
        if any(alias in prompt_lower for alias in aliases):
            terms.add(canonical)
            terms.update(aliases)
    return terms
