from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


QuizAccess = Literal["ask", "none", "authorized"]
ResourceRole = Literal[
    "theory",
    "formula_sheet",
    "exercise",
    "solution",
    "datasheet",
    "quiz_style_source",
    "assignment",
    "other",
]
ResourceStatus = Literal["selected", "available_not_used", "authorization_required", "excluded"]


@dataclass(frozen=True)
class UserIntent:
    prompt: str
    goal: str
    artifact_type: str
    language: str
    course_hint: str | None
    audience: str
    required_sections: list[str]
    wants_quiz_style: bool
    wants_solutions_at_end: bool
    wants_complete_theory: bool
    quiz_access: QuizAccess
    max_repair_cycles: int
    requested_sheet_number: int | None = None
    requested_task_number: int | None = None


@dataclass(frozen=True)
class ResourceDescriptor:
    id: str
    title: str
    role: ResourceRole
    status: ResourceStatus
    path: str | None = None
    url: str | None = None
    page_count: int | None = None
    reason: str = ""
    safety_note: str | None = None


@dataclass(frozen=True)
class SourceChunk:
    source_id: str
    title: str
    role: ResourceRole
    path: str | None
    page: int | None
    text: str


@dataclass(frozen=True)
class ResourceBundle:
    intent: UserIntent
    selected_course: dict[str, Any] | None
    resources: list[ResourceDescriptor]
    source_chunks: list[SourceChunk]
    quiz_permission: dict[str, Any]
    coverage_matrix: list[dict[str, Any]]
    omissions: list[dict[str, Any]]


@dataclass(frozen=True)
class LayoutSpec:
    document_style: str
    density: str
    include_toc: bool = True
    quiz_solutions_position: str = "end"


@dataclass(frozen=True)
class DocumentSection:
    heading: str
    body: list[str]
    source_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class QuizQuestion:
    id: str
    question_type: str
    question: str
    options: list[str]
    answer: str
    explanation: str
    source_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class DocumentDraft:
    title: str
    subtitle: str
    course: str | None
    language: str
    layout: LayoutSpec
    sections: list[DocumentSection]
    quiz_questions: list[QuizQuestion]
    source_map: list[dict[str, Any]]
    requirements_trace: list[dict[str, Any]]
    risk_flags: list[str]


@dataclass(frozen=True)
class ReviewReport:
    passed: bool
    issues: list[dict[str, Any]]
    repair_instructions: list[str]
    requirements_trace: list[dict[str, Any]]
    safety: dict[str, Any]


def to_jsonable(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: to_jsonable(item) for key, item in value.items()}
    return value
