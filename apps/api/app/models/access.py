from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, ForeignKey, Index, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UtcDateTime, utcnow


class AccessRequestStatus(StrEnum):
    pending = "pending"
    approved = "approved"
    declined = "declined"
    expired = "expired"
    cancelled = "cancelled"


class AccessRequest(Base):
    """A teacher's or specialist's request to join a child's care team (COMPANION_SPEC §3.1).

    Every request is stored, including ones whose code matches no child (`child_id` NULL).
    The requester sees the same pending entry either way, so their own list never reveals
    whether a Child ID exists. Unmatched requests simply expire.
    """

    __tablename__ = "access_requests"
    __table_args__ = (Index("ix_access_requests_requester_created", "requester_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int | None] = mapped_column(
        ForeignKey("children.id", ondelete="CASCADE"), index=True
    )
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # The code as typed (normalised). Shown back to the requester instead of the child's
    # current code, which may have been regenerated since.
    child_code: Mapped[str] = mapped_column(String(8))
    message: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[AccessRequestStatus] = mapped_column(
        SAEnum(AccessRequestStatus, native_enum=False, length=16),
        default=AccessRequestStatus.pending,
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class GrantScope(StrEnum):
    education = "education"
    clinical = "clinical"


class AccessGrant(Base):
    """Approved care-team membership. Active while `revoked_at` is NULL (COMPANION_SPEC §3)."""

    __tablename__ = "access_grants"

    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    scope: Mapped[GrantScope] = mapped_column(SAEnum(GrantScope, native_enum=False, length=16))
    share_medications: Mapped[bool] = mapped_column(Boolean, default=False)
    share_documents: Mapped[bool] = mapped_column(Boolean, default=False)
    # Always true in the POC: the design shows logs as "always on" for every member.
    can_add_logs: Mapped[bool] = mapped_column(Boolean, default=True)
    granted_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    # When the member last opened the timeline: entries since then show as "N new" on their card.
    logs_seen_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
