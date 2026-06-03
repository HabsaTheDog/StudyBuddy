from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .storage import ROOT, read_json


PHDYN_SLUG = "bmr-vz-2-ss2026-phdyn-de-physikalische-grundlagen-der-dynamik"

BLOCK_SOURCE_HINTS = {
    6: ["kontrollfragen_dyn6", "factsheet_starrer", "factsheet_kreisel"],
    7: ["kontrollfragen_dyn7", "factsheet_dalembert", "factsheet_kra", "factsheet_reibung"],
    8: ["kontrollfragen_dyn8", "factsheet_dalembert", "factsheet_lagrange"],
}

QUERY_EXPANSIONS = {
    "freiheitsgrade": ["3N - s", "3n", "zwangsbedingungen", "verallgemeinerte koordinaten"],
    "virtuelle arbeit": ["δw", "dalembert", "d'alembert"],
    "kugel": ["kugelkoordinaten", "theta", "phi", "oberfläche"],
    "oberfläche": ["kugelkoordinaten", "theta", "phi"],
}


def source_excerpts_for_question(
    question: dict[str, Any],
    *,
    page: dict[str, Any] | None = None,
    limit: int = 6,
) -> list[dict[str, Any]]:
    block_number = _block_number_from_page(page or {})
    terms = _terms_for_question(question)
    for key, additions in QUERY_EXPANSIONS.items():
        if key in " ".join(terms):
            terms.extend(additions)

    index = read_json(ROOT / "state" / "document_index.json", default={})
    documents = index.get("documents", []) if isinstance(index, dict) else []
    scored: list[tuple[int, dict[str, Any]]] = []
    for document in documents:
        path = str(document.get("path") or "")
        name = str(document.get("name") or Path(path).name)
        path_lower = path.casefold()
        if PHDYN_SLUG not in path_lower:
            continue
        block_bonus = _block_source_bonus(path_lower, block_number)
        for page_entry in document.get("pages", []):
            text = str(page_entry.get("text") or "")
            normalized = text.casefold()
            score = block_bonus + sum(2 for term in terms if term and term in normalized)
            if score > 0:
                scored.append(
                    (
                        score,
                        {
                            "title": name,
                            "kind": "local_document_excerpt",
                            "path": path,
                            "page": page_entry.get("page"),
                            "text": text[:2200],
                        },
                    )
                )
    scored.sort(key=lambda item: item[0], reverse=True)
    return [item for _, item in scored[:limit]]


def _block_source_bonus(path_lower: str, block_number: int | None) -> int:
    if block_number is None:
        return 0
    hints = BLOCK_SOURCE_HINTS.get(block_number, [])
    return 8 if any(hint in path_lower for hint in hints) else 0


def _block_number_from_page(page: dict[str, Any]) -> int | None:
    text = f"{page.get('title') or ''} {page.get('url') or ''}".casefold()
    match = re.search(r"test\s*block\s*(\d+)", text)
    return int(match.group(1)) if match else None


def _terms_for_question(question: dict[str, Any]) -> list[str]:
    text = f"{question.get('prompt') or ''} {question.get('prompt_text') or ''} {question.get('visible_context') or ''}".casefold()
    words = re.findall(r"[a-zA-ZäöüÄÖÜß0-9δ]+", text)
    stop = {"frage", "antwort", "wählen", "welche", "wahr", "falsch", "punkte", "oder", "und", "der", "die", "das"}
    return [word for word in words if len(word) >= 3 and word not in stop]
