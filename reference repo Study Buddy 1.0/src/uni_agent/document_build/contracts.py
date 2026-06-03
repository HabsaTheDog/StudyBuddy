from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

QuizAccess = Literal["ask", "none", "authorized"]
SyncPolicy = Literal["require-current", "no-sync"]


@dataclass(frozen=True)
class TaskRef:
    topic: int | None
    task: int | None
    raw: str = ""

    @property
    def key(self) -> tuple[int | None, int | None]:
        return (self.topic, self.task)

    def label(self) -> str:
        if self.topic is not None and self.task is not None:
            return f"Thema {self.topic}/{self.task}"
        if self.topic is not None:
            return f"Thema {self.topic}"
        if self.task is not None:
            return f"Aufgabe {self.task}"
        return self.raw or "Aufgabe"


@dataclass(frozen=True)
class PartialRequirement:
    task: TaskRef
    scope: str
    raw: str = ""


@dataclass(frozen=True)
class DocumentIntent:
    prompt: str
    language: str
    requested_template: str | None
    selected_template: str
    course_hint: str | None
    target_course_id: str | None
    requested_topics: list[int]
    requested_tasks: list[TaskRef]
    exclusions: list[TaskRef]
    partial_requirements: list[PartialRequirement]
    wants_marked_tasks: bool
    wants_worked_solutions: bool
    wants_pdf: bool
    wants_quiz_style: bool
    quiz_access: QuizAccess
    sync_policy: SyncPolicy


@dataclass(frozen=True)
class TemplateSpec:
    id: str
    title: str
    description: str
    supported_goals: list[str]
    required_source_roles: list[str]
    optional_source_roles: list[str]
    section_strategy: str
    renderer: str
    review_profile: str
    requires_model_builder: bool
    allows_local_builder: bool


@dataclass(frozen=True)
class SourceDescriptor:
    id: str
    title: str
    role: str
    status: str
    path: str | None = None
    url: str | None = None
    page_count: int | None = None
    reason: str = ""


@dataclass(frozen=True)
class SourceChunk:
    source_id: str
    title: str
    role: str
    path: str | None
    page: int | None
    text: str


@dataclass(frozen=True)
class PlannedSection:
    id: str
    heading: str
    kind: str
    task_ref: TaskRef | None
    source_ids: list[str]
    builder_mode: str
    required: bool = True
    scope: str | None = None


@dataclass(frozen=True)
class Omission:
    label: str
    reason: str


@dataclass(frozen=True)
class DocumentPlan:
    title: str
    template_id: str
    course: dict[str, Any] | None
    sections: list[PlannedSection]
    sources: list[SourceDescriptor]
    chunks: list[SourceChunk]
    omissions: list[Omission]
    safety: dict[str, Any]
    issues: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class BuiltSection:
    id: str
    heading: str
    body: list[str]
    source_ids: list[str]
    risk_flags: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class BuiltDocument:
    title: str
    subtitle: str
    course: str | None
    language: str
    template_id: str
    sections: list[BuiltSection]
    sources: list[SourceDescriptor]
    omissions: list[Omission]
    risk_flags: list[str]


@dataclass(frozen=True)
class ReviewReport:
    passed: bool
    issues: list[dict[str, Any]]
    repair_instructions: list[str]
    safety: dict[str, Any]


def to_jsonable(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: to_jsonable(item) for key, item in value.items()}
    return value
