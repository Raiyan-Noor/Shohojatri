"""The child characteristics questionnaire (COMPANION_SPEC §4): content and answer validation.

Like the screening questionnaire, the content ships with the code (app/seed/characteristics.yaml)
rather than living in the database. Answers are stored per child as versioned JSON:

    {"questionnaire_version": "characteristics-1",
     "sections": {"communication": {"main_way": {"selected": ["single_words", "other"],
                                                 "other_text": "..."}, ...}, ...}}

A section key is present once the parent has saved it (even with nothing filled in); skipped
sections are absent.
"""

from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Any, Self

import yaml
from pydantic import BaseModel, ConfigDict, model_validator

from app.core.errors import ApiError

CHARACTERISTICS_PATH = Path(__file__).parents[1] / "seed" / "characteristics.yaml"

OTHER = "other"
TEXT_MAX = 1000
SHORT_MAX = 200
TAG_MAX = 60
TAGS_MAX = 20
THERAPIES_MAX = 10


class QuestionType(StrEnum):
    single = "single"
    multi = "multi"
    grid = "grid"
    text = "text"
    tags = "tags"
    list = "list"
    therapies = "therapies"


class Label(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    en: str
    bn: str


class Question(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    type: QuestionType
    text_en: str
    text_bn: str
    options: tuple[Label, ...] = ()
    rows: tuple[Label, ...] = ()  # grid only
    other: bool = False  # single/multi: offers "Other (write)"
    max: int | None = None  # list only

    @model_validator(mode="after")
    def _shape(self) -> Self:
        needs_options = self.type in (
            QuestionType.single,
            QuestionType.multi,
            QuestionType.grid,
            QuestionType.therapies,
        )
        if needs_options != bool(self.options):
            raise ValueError(f"{self.id}: options don't match type {self.type}")
        if (self.type == QuestionType.grid) != bool(self.rows):
            raise ValueError(f"{self.id}: rows are for grids only")
        if (self.type == QuestionType.list) != (self.max is not None):
            raise ValueError(f"{self.id}: max is for lists only")
        if OTHER in self.option_ids:
            raise ValueError(f"{self.id}: '{OTHER}' is reserved")
        return self

    @property
    def option_ids(self) -> set[str]:
        return {option.id for option in self.options}


class Section(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    title_en: str
    title_bn: str
    questions: tuple[Question, ...]

    def question(self, question_id: str) -> Question | None:
        return next((q for q in self.questions if q.id == question_id), None)


class CharacteristicsQuestionnaire(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    version: str
    sections: tuple[Section, ...]

    @model_validator(mode="after")
    def _unique_ids(self) -> Self:
        ids = [s.id for s in self.sections]
        if len(ids) != len(set(ids)):
            raise ValueError("section ids must be unique")
        for section in self.sections:
            question_ids = [q.id for q in section.questions]
            if len(question_ids) != len(set(question_ids)):
                raise ValueError(f"{section.id}: question ids must be unique")
        return self

    def section(self, section_id: str) -> Section | None:
        return next((s for s in self.sections if s.id == section_id), None)


@lru_cache
def load_characteristics() -> CharacteristicsQuestionnaire:
    data = yaml.safe_load(CHARACTERISTICS_PATH.read_text(encoding="utf-8"))
    return CharacteristicsQuestionnaire.model_validate(data)


def empty_answers() -> dict[str, Any]:
    return {"questionnaire_version": load_characteristics().version, "sections": {}}


def validate_section(section: Section, raw: dict[str, Any]) -> dict[str, Any]:
    """The section's answers, cleaned (trimmed, blanks dropped), or ApiError 422 naming the
    question at fault in `detail.field`."""
    clean: dict[str, Any] = {}
    for question_id, value in raw.items():
        question = section.question(question_id)
        if question is None:
            raise _invalid(question_id)
        answer = _validate(question, value)
        if answer not in (None, "", [], {}):
            clean[question_id] = answer
    return clean


def _validate(q: Question, value: Any) -> Any:
    match q.type:
        case QuestionType.single | QuestionType.multi:
            return _choice(q, value)
        case QuestionType.grid:
            rows = {row.id for row in q.rows}
            if not isinstance(value, dict) or not all(
                k in rows and v in q.option_ids for k, v in value.items()
            ):
                raise _invalid(q.id)
            return dict(value)
        case QuestionType.text:
            return _text(q.id, value, TEXT_MAX)
        case QuestionType.tags:
            return _texts(q.id, value, TAGS_MAX, TAG_MAX)
        case QuestionType.list:
            assert q.max is not None
            return _texts(q.id, value, q.max, SHORT_MAX)
        case QuestionType.therapies:
            return _therapies(q, value)


def _choice(q: Question, value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or set(value) - {"selected", "other_text"}:
        raise _invalid(q.id)
    selected = value.get("selected", [])
    allowed = q.option_ids | ({OTHER} if q.other else set())
    if (
        not isinstance(selected, list)
        or not all(isinstance(s, str) and s in allowed for s in selected)
        or len(set(selected)) != len(selected)
        or (q.type == QuestionType.single and len(selected) > 1)
    ):
        raise _invalid(q.id)
    other_text = _text(q.id, value.get("other_text"), SHORT_MAX)
    # "Other" needs its own words, and own words need "Other".
    if (OTHER in selected) != bool(other_text):
        raise ApiError(422, "other_text_required", detail={"field": q.id})
    if not selected:
        return None
    return {"selected": selected, "other_text": other_text or None}


def _therapies(q: Question, value: Any) -> list[dict[str, str | None]]:
    if not isinstance(value, list) or len(value) > THERAPIES_MAX:
        raise _invalid(q.id)
    rows = []
    for row in value:
        if not isinstance(row, dict) or set(row) - {"type", "other_text", "provider", "frequency"}:
            raise _invalid(q.id)
        kind = row.get("type")
        if kind not in q.option_ids | {OTHER}:
            raise _invalid(q.id)
        other_text = _text(q.id, row.get("other_text"), SHORT_MAX)
        if (kind == OTHER) != bool(other_text):
            raise ApiError(422, "other_text_required", detail={"field": q.id})
        rows.append(
            {
                "type": kind,
                "other_text": other_text or None,
                "provider": _text(q.id, row.get("provider"), SHORT_MAX) or None,
                "frequency": _text(q.id, row.get("frequency"), SHORT_MAX) or None,
            }
        )
    return rows


def _text(field: str, value: Any, limit: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > limit:
        raise _invalid(field)
    return value.strip()


def _texts(field: str, value: Any, count: int, limit: int) -> list[str]:
    if not isinstance(value, list) or len(value) > count:
        raise _invalid(field)
    texts = [_text(field, item, limit) for item in value]
    return [t for t in texts if t]


def _invalid(field: str) -> ApiError:
    return ApiError(422, "invalid_answer", detail={"field": field})
