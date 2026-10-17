from datetime import date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, Date, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UtcDateTime, utcnow
from app.models.user import Role


class Characteristics(Base):
    """One version of a child's characteristics answers (COMPANION_SPEC §4). Append-only: every
    saved change is a new row, so the context engine can see what changed and when."""

    __tablename__ = "characteristics"
    __table_args__ = (UniqueConstraint("child_id", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    # See app/core/characteristics.py for the shape.
    answers_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class GoalStatus(StrEnum):
    active = "active"
    achieved = "achieved"
    paused = "paused"


class Goal(Base):
    """A care-plan goal (COMPANION_SPEC §7). B9 reads goals for log goal-progress; creating and
    editing them is B10."""

    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    domain: Mapped[str] = mapped_column(String(32))
    set_by_role: Mapped[Role] = mapped_column(SAEnum(Role, native_enum=False, length=16))
    target_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[GoalStatus] = mapped_column(
        SAEnum(GoalStatus, native_enum=False, length=16), default=GoalStatus.active
    )
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class LogType(StrEnum):
    observation = "observation"
    progress = "progress"
    concern = "concern"
    milestone = "milestone"
    therapy_session = "therapy_session"
    school_day = "school_day"
    clinical_note = "clinical_note"
    activity_done = "activity_done"
    check_in = "check_in"


class LogDomain(StrEnum):
    communication = "communication"
    social = "social"
    behaviour_emotions = "behaviour_emotions"
    sensory = "sensory"
    daily_living = "daily_living"
    learning = "learning"
    motor = "motor"
    sleep = "sleep"
    eating = "eating"


class LogVisibility(StrEnum):
    care_team = "care_team"  # parent + every member
    clinical = "clinical"  # parent + clinical members
    private = "private"  # author + the parent (OPEN_QUESTIONS #11)


class GoalProgress(StrEnum):
    no_progress = "no_progress"
    some = "some"
    good = "good"
    achieved = "achieved"


class Log(Base):
    """One timeline entry (COMPANION_SPEC §5.1).

    Append-only: the author may edit within 24 h (each edit keeps the previous content in
    `log_versions`); after that they add a correction, a new entry whose `corrects_log_id`
    points at the one it replaces. An entry has at most one correction, so corrections form a
    chain.
    """

    __tablename__ = "logs"
    __table_args__ = (Index("ix_logs_child_occurred", "child_id", "occurred_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"))
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # The author's role when writing: the badge stays right even if roles change later.
    author_role: Mapped[Role] = mapped_column(SAEnum(Role, native_enum=False, length=16))
    type: Mapped[LogType] = mapped_column(SAEnum(LogType, native_enum=False, length=20))
    occurred_at: Mapped[datetime] = mapped_column(UtcDateTime)
    # LogDomain values. JSON, filtered with a LIKE on its text form.
    domains: Mapped[list[str]] = mapped_column(JSON, default=list)
    # {domain: 1-5}, "How was it today?" (1 hard … 5 great).
    ratings_json: Mapped[dict[str, int]] = mapped_column(JSON, default=dict)
    text: Mapped[str | None] = mapped_column(Text)
    goal_id: Mapped[int | None] = mapped_column(ForeignKey("goals.id", ondelete="SET NULL"))
    goal_progress: Mapped[GoalProgress | None] = mapped_column(
        SAEnum(GoalProgress, native_enum=False, length=16)
    )
    # The child's mood, 1 (upset) … 5 (very happy).
    mood: Mapped[int | None] = mapped_column(Integer)
    visibility: Mapped[LogVisibility] = mapped_column(
        SAEnum(LogVisibility, native_enum=False, length=16)
    )
    corrects_log_id: Mapped[int | None] = mapped_column(
        ForeignKey("logs.id", ondelete="CASCADE"), unique=True
    )
    # A parent's saved "Explain this to me" note points at the entry it explains.
    explains_log_id: Mapped[int | None] = mapped_column(ForeignKey("logs.id", ondelete="SET NULL"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    edited_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class LogVersion(Base):
    """The content of an entry before one of its edits (OPEN_QUESTIONS #14)."""

    __tablename__ = "log_versions"
    __table_args__ = (UniqueConstraint("log_id", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    log_id: Mapped[int] = mapped_column(ForeignKey("logs.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    # When this version stopped being current.
    edited_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
