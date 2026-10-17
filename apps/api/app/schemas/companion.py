from datetime import date, datetime
from enum import StrEnum
from typing import Annotated, Any, Self

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.core.characteristics import QuestionType
from app.models import GoalProgress, GoalStatus, Locale, LogDomain, LogType, LogVisibility, Role

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Rating = Annotated[int, Field(ge=1, le=5)]
# Month of diagnosis: parents often know only "March 2025".
YearMonth = Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


class DiagnosisKind(StrEnum):
    autism = "autism"
    autism_plus = "autism_plus"  # autism + another condition
    other_condition = "other_condition"  # another developmental condition
    being_assessed = "being_assessed"


class Diagnosis(BaseModel):
    """Activation wizard step 1 (COMPANION_SPEC §1), stored in `children.diagnosis_json`."""

    kind: DiagnosisKind
    # What the other condition is; required for autism_plus and other_condition.
    condition_text: ShortText | None = None
    diagnosed_on: YearMonth | None = None
    # Free text, or a specialist on the child's care team (their name is copied in).
    diagnosed_by: ShortText | None = None
    diagnosed_by_user_id: int | None = None

    @model_validator(mode="after")
    def _condition(self) -> Self:
        needs_text = self.kind in (DiagnosisKind.autism_plus, DiagnosisKind.other_condition)
        if needs_text and not self.condition_text:
            raise ValueError("condition_text is required for this kind")
        if not needs_text:
            self.condition_text = None
        return self


class Specialist(BaseModel):
    """A clinical care-team member, offered as "diagnosed by"."""

    user_id: int
    name: str
    specialty: str | None
    organisation: str | None


# Characteristics -------------------------------------------------------------------------------


class LabelOut(BaseModel):
    id: str
    en: str
    bn: str


class QuestionOut(BaseModel):
    id: str
    type: QuestionType
    text_en: str
    text_bn: str
    options: list[LabelOut]
    rows: list[LabelOut]
    other: bool
    max: int | None


class SectionOut(BaseModel):
    id: str
    title_en: str
    title_bn: str
    questions: list[QuestionOut]


class CharacteristicsQuestionnaireOut(BaseModel):
    version: str
    sections: list[SectionOut]


class CharacteristicsOut(BaseModel):
    """The child's latest answers. Version 0 = nothing saved yet."""

    version: int
    questionnaire_version: str
    # section id → {question id → answer}; see app/core/characteristics.py for answer shapes.
    sections: dict[str, dict[str, Any]]
    updated_at: datetime | None
    updated_by: str | None


class SaveSectionRequest(BaseModel):
    answers: dict[str, Any]


# Goals -----------------------------------------------------------------------------------------


class GoalOut(BaseModel):
    id: int
    title: str
    domain: str
    set_by_role: Role
    status: GoalStatus
    target_date: date | None


# Logs ------------------------------------------------------------------------------------------


class LogAuthor(BaseModel):
    id: int
    name: str
    role: Role


class LogGoal(BaseModel):
    id: int
    title: str


class LogOut(BaseModel):
    id: int
    type: LogType
    author: LogAuthor
    occurred_at: datetime
    domains: list[LogDomain]
    ratings: dict[LogDomain, int]
    text: str | None
    goal: LogGoal | None
    goal_progress: GoalProgress | None
    mood: int | None
    visibility: LogVisibility
    version: int
    created_at: datetime
    edited_at: datetime | None
    corrects_log_id: int | None
    # The newer entry that replaces this one, if the viewer can see it (same visibility).
    corrected_by_log_id: int | None
    explains_log_id: int | None
    # For the viewer: their own entry within 24 h → edit; after that → correct.
    can_edit: bool
    can_correct: bool
    editable_until: datetime


class LogPage(BaseModel):
    items: list[LogOut]
    next_offset: int | None


class LogContent(BaseModel):
    occurred_at: datetime | None = None  # default: now
    domains: list[LogDomain] = Field(default_factory=list, max_length=len(LogDomain))
    ratings: dict[LogDomain, Rating] = Field(default_factory=dict)
    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)] | None = None
    goal_id: int | None = None
    goal_progress: GoalProgress | None = None
    mood: Rating | None = None

    @model_validator(mode="after")
    def _goal_pair(self) -> Self:
        if (self.goal_id is None) != (self.goal_progress is None):
            raise ValueError("goal_id and goal_progress go together")
        self.domains = list(dict.fromkeys(self.domains))
        self.text = self.text or None
        return self


class CreateLogRequest(LogContent):
    type: LogType
    visibility: LogVisibility | None = None  # default by role and type
    corrects_log_id: int | None = None
    explains_log_id: int | None = None


class UpdateLogRequest(LogContent):
    type: LogType
    visibility: LogVisibility
    occurred_at: datetime  # type: ignore[assignment]


class ExplainRequest(BaseModel):
    locale: Locale


class LogExplanation(BaseModel):
    """Not saved: the parent may keep it as their own note (COMPANION_SPEC §5.1)."""

    summary: str
    at_home: str
    ask_next: list[str]
