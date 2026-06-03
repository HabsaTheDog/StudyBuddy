from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal


@dataclass(frozen=True)
class Course:
    id: str
    title: str
    url: str
    semester: str | None = None


@dataclass(frozen=True)
class SourceRef:
    source_id: str
    kind: Literal["pdf", "moodle_page", "assignment", "quiz_question", "local_file"]
    title: str
    url: str | None = None
    file_path: str | None = None
    page: int | None = None
    section: str | None = None
    retrieved_at: str | None = None


@dataclass(frozen=True)
class QuizQuestionPacket:
    quiz_url: str
    question_id: str
    question_type: str
    prompt: str
    options: list[str]
    visible_context: str
    allowed_sources: list[SourceRef]
    question_index: int | None = None
    prompt_text: str | None = None
    prompt_latex: str | None = None
    prompt_html: str | None = None
    option_objects: list[dict[str, Any]] | None = None
    extraction_quality: dict[str, Any] | None = None


@dataclass(frozen=True)
class AnswerProposal:
    question_id: str
    answer: str | list[str]
    confidence: float
    rationale: str
    citations: list[SourceRef]
    risk_flags: list[str]


def to_jsonable(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: to_jsonable(item) for key, item in value.items()}
    return value
