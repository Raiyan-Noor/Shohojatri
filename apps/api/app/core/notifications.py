from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dates import BD_TZ
from app.models import Notification, NotificationKind

# More than this many new entries for one child on one day become a daily digest (§5.2).
DIGEST_AFTER = 3


def notify(db: Session, user_id: int, kind: NotificationKind, **payload: Any) -> None:
    """Queues an in-app notification; saved by the caller's commit.

    The payload holds only what the text needs. It is a snapshot: a later rename doesn't
    rewrite old notifications.
    """
    db.add(Notification(user_id=user_id, kind=kind, payload_json=payload))


@dataclass
class ListedNotification:
    """A stored notification, or a digest standing for several (id = the newest one's)."""

    id: int
    kind: NotificationKind
    payload: dict[str, Any]
    read_at: datetime | None
    created_at: datetime


def _day_key(n: Notification) -> tuple[Any, date] | None:
    if n.kind != NotificationKind.log_added:
        return None
    return n.payload_json.get("child_id"), n.created_at.astimezone(BD_TZ).date()


def with_digests(rows: list[Notification]) -> list[ListedNotification]:
    """Folds each child's new-entry notifications into one digest on days with more than
    DIGEST_AFTER of them. `rows` are newest first; so is the result. Grouped when read, so
    there is no scheduler (OPEN_QUESTIONS, "decided without asking")."""
    groups: dict[tuple[Any, date], list[Notification]] = {}
    for n in rows:
        key = _day_key(n)
        if key is not None:
            groups.setdefault(key, []).append(n)

    listed: list[ListedNotification] = []
    for n in rows:
        key = _day_key(n)
        group = groups.get(key) if key is not None else None
        if group is None or len(group) <= DIGEST_AFTER:
            listed.append(ListedNotification(n.id, n.kind, n.payload_json, n.read_at, n.created_at))
        elif n is group[0]:
            unread = [m for m in group if m.read_at is None]
            listed.append(
                ListedNotification(
                    id=n.id,
                    kind=NotificationKind.log_digest,
                    payload={
                        "child_id": n.payload_json.get("child_id"),
                        "child_name": n.payload_json.get("child_name"),
                        "count": len(group),
                    },
                    read_at=None if unread else max(m.read_at for m in group if m.read_at),
                    created_at=n.created_at,
                )
            )
    return listed


def same_digest(db: Session, n: Notification) -> list[Notification]:
    """The notifications listed together with `n` (just `n` unless it's part of a digest)."""
    key = _day_key(n)
    if key is None:
        return [n]
    start = datetime.combine(key[1], time(), BD_TZ)
    candidates = db.scalars(
        select(Notification).where(
            Notification.user_id == n.user_id,
            Notification.kind == NotificationKind.log_added,
            Notification.created_at >= start,
            Notification.created_at < start + timedelta(days=1),
        )
    )
    group = [m for m in candidates if _day_key(m) == key]
    return group if len(group) > DIGEST_AFTER else [n]
