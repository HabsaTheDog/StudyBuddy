from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import os
import re


@dataclass(frozen=True)
class SemesterInfo:
    token: str
    label: str
    start: date
    end: date
    is_current: bool


def today() -> date:
    override = os.environ.get("STUDY_BUDDY_TODAY", "").strip()
    if override:
        return date.fromisoformat(override)
    return date.today()


def current_semester_tokens(day: date | None = None) -> set[str]:
    day = day or today()
    if 2 <= day.month <= 8:
        return {f"ss{day.year}", f"ss {day.year}", f"sommersemester {day.year}"}
    if day.month >= 9:
        return {f"ws{day.year}", f"ws {day.year}", f"ws {day.year}/{str(day.year + 1)[-2:]}", f"wintersemester {day.year}"}
    previous = day.year - 1
    return {f"ws{previous}", f"ws {previous}", f"ws {previous}/{str(day.year)[-2:]}", f"wintersemester {previous}"}


def infer_semester_info(text: str, *, day: date | None = None) -> SemesterInfo | None:
    text_lower = " ".join(str(text or "").casefold().split())
    match = re.search(r"\b(ss|ws)[-\s]?(\d{4})(?:/(\d{2,4}))?\b", text_lower)
    if not match:
        match = re.search(r"\b(sommersemester|wintersemester)\s+(\d{4})(?:/(\d{2,4}))?\b", text_lower)
    if not match:
        return None
    kind_raw, year_raw, next_year_raw = match.groups()
    kind = "ss" if kind_raw in {"ss", "sommersemester"} else "ws"
    year = int(year_raw)
    if kind == "ss":
        start = date(year, 2, 1)
        end = date(year, 8, 31)
        token = f"SS{year}"
        label = f"Sommersemester {year}"
    else:
        next_year = _normalize_next_year(year, next_year_raw)
        start = date(year, 9, 1)
        end = date(next_year, 2, 28)
        token = f"WS{year}/{str(next_year)[-2:]}"
        label = f"Wintersemester {year}/{str(next_year)[-2:]}"
    check_day = day or today()
    return SemesterInfo(token=token, label=label, start=start, end=end, is_current=start <= check_day <= end)


def semester_payload(text: str, *, day: date | None = None) -> dict[str, object] | None:
    info = infer_semester_info(text, day=day)
    if not info:
        return None
    return {
        "token": info.token,
        "label": info.label,
        "start": info.start.isoformat(),
        "end": info.end.isoformat(),
        "is_current": info.is_current,
    }


def _normalize_next_year(year: int, value: str | None) -> int:
    if not value:
        return year + 1
    if len(value) == 2:
        return int(str(year)[:2] + value)
    return int(value)
