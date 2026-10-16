from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UtcDateTime, utcnow
from app.models.chat import Conversation
from app.models.user import Locale


class ScreeningStatus(StrEnum):
    in_progress = "in_progress"
    finalized = "finalized"


class Informant(StrEnum):
    """Who is answering (SCREENING_SPEC §2)."""

    mother = "mother"
    father = "father"
    other_caregiver = "other_caregiver"


class Screening(Base):
    """COMPANION_SPEC §15 `screenings`, plus `informant`, `parent_note` and
    `questionnaire_completed_at` (OPEN_QUESTIONS #14)."""

    __tablename__ = "screenings"

    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    locale: Mapped[Locale] = mapped_column(SAEnum(Locale, native_enum=False, length=2))
    # Fixed when the screening starts: item eligibility and scoring use this age throughout.
    age_months: Mapped[int]
    informant: Mapped[Informant] = mapped_column(SAEnum(Informant, native_enum=False, length=16))
    # Version of the consent text the parent accepted, and when.
    consent_version: Mapped[str | None] = mapped_column(String(40))
    consent_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    status: Mapped[ScreeningStatus] = mapped_column(
        SAEnum(ScreeningStatus, native_enum=False, length=16), default=ScreeningStatus.in_progress
    )
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    # "Anything else you've noticed?" — verbatim for the doctor report, not scored.
    parent_note: Mapped[str | None] = mapped_column(Text)
    questionnaire_completed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    scoring_version: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    finalized_at: Mapped[datetime | None] = mapped_column(UtcDateTime)

    # ORM cascade, so deleting a screening removes its answers on SQLite too (no FK pragma).
    answers: Mapped[list["ScreeningAnswer"]] = relationship(
        back_populates="screening", cascade="all, delete-orphan", order_by="ScreeningAnswer.id"
    )
    tasks: Mapped[list["ScreeningTask"]] = relationship(
        back_populates="screening", cascade="all, delete-orphan", order_by="ScreeningTask.id"
    )
    shares: Mapped[list["ReportShare"]] = relationship(
        back_populates="screening", cascade="all, delete-orphan", order_by="ReportShare.id"
    )
    # "Ask about my results" chats: deleting the screening deletes what was said about it.
    conversations: Mapped[list["Conversation"]] = relationship(cascade="all, delete-orphan")


class ScreeningAnswer(Base):
    """One questionnaire answer. `option` is the stored card key; "other" means the parent's own
    words are waiting for confirmation (or, for unmapped items, are the answer). When the parent
    confirmed a mapping, `option` is the card and `other_text` keeps their words verbatim."""

    __tablename__ = "screening_answers"
    __table_args__ = (UniqueConstraint("screening_id", "item_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    screening_id: Mapped[int] = mapped_column(
        ForeignKey("screenings.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[str] = mapped_column(String(8))
    option: Mapped[str] = mapped_column(String(24))
    other_text: Mapped[str | None] = mapped_column(Text)
    # True when the confirmed card is the one the AI suggested for this exact text.
    mapped_by_ai: Mapped[bool] = mapped_column(Boolean, default=False)
    # The AI's suggestion for `other_text` (status, option, confidence, reason).
    ai_mapping_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, onupdate=utcnow)

    screening: Mapped[Screening] = relationship(back_populates="answers")


class ScreeningTask(Base):
    """The latest upload (or skip) of one Part 2 activity, including the calibration recording
    (OPEN_QUESTIONS #14). `payload_json` keeps the extracted features (never media) so finalize
    can score every task again with the final calibration; `result_json` is the score at upload,
    which the browser uses to decide on a retry."""

    __tablename__ = "screening_tasks"
    __table_args__ = (UniqueConstraint("screening_id", "task"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    screening_id: Mapped[int] = mapped_column(
        ForeignKey("screenings.id", ondelete="CASCADE"), index=True
    )
    # "calibration" or a scoring TaskName.
    task: Mapped[str] = mapped_column(String(24))
    # joint_attention / imitation: "on_screen" or "live".
    variant: Mapped[str | None] = mapped_column(String(16))
    # TaskStatus (ok / low / inconclusive), or ok / fallback for the calibration.
    status: Mapped[str] = mapped_column(String(16))
    # Replayed from a recorded sample session (demo mode, SCREENING_SPEC §9), not a camera.
    demo: Mapped[bool] = mapped_column(Boolean, default=False)
    # None when skipped.
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    result_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)

    screening: Mapped[Screening] = relationship(back_populates="tasks")


class ReportShare(Base):
    """A read-only link to the doctor report (SCREENING_SPEC §7). Only a hash of the token is
    stored, so the link is shown once, when it is made."""

    __tablename__ = "report_shares"

    id: Mapped[int] = mapped_column(primary_key=True)
    screening_id: Mapped[int] = mapped_column(
        ForeignKey("screenings.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    views: Mapped[int] = mapped_column(Integer, default=0)
    last_viewed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)

    screening: Mapped[Screening] = relationship(back_populates="shares")
