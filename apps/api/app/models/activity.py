from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UtcDateTime, utcnow


class NotificationKind(StrEnum):
    access_request_received = "access_request_received"
    access_request_approved = "access_request_approved"
    access_request_declined = "access_request_declined"
    # A teacher or specialist added a timeline entry (COMPANION_SPEC §5.2). When a child gets
    # more than 3 in one day, the list shows them as one digest (app/core/notifications.py).
    log_added = "log_added"
    # Never stored: how the list shows a day's log_added rows for one child when there are many.
    log_digest = "log_digest"


class Notification(Base):
    """In-app notification. `payload_json` holds the parameters of the translated text, so the
    web app renders it in the reader's language."""

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[NotificationKind] = mapped_column(
        SAEnum(NotificationKind, native_enum=False, length=40)
    )
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    read_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class AuditLog(Base):
    """Who read or changed which child's data (CLAUDE.md §2.5, COMPANION_SPEC §3.2).

    `action` is a verb (read, write, approve, revoke …); `resource` is what it touched, either
    a kind ("profile", "medications") or kind:id ("grant:12") when one row is meant.
    """

    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_child_at", "child_id", "at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(32))
    resource: Mapped[str] = mapped_column(String(64))
    at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
