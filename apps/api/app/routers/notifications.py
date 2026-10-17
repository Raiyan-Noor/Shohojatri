from fastapi import APIRouter
from sqlalchemy import select, update

from app.core.deps import CurrentUser, DbSession
from app.core.errors import ApiError
from app.core.notifications import same_digest, with_digests
from app.models import Notification
from app.models.base import utcnow
from app.schemas.notifications import NotificationList, NotificationOut
from app.schemas.users import OkResponse

router = APIRouter(prefix="/notifications", tags=["notifications"])

_LIST_LIMIT = 50
# Rows looked at to build the list: digests fold many rows into one item.
_SCAN_LIMIT = 300


@router.get("", operation_id="listNotifications")
def list_notifications(user: CurrentUser, db: DbSession) -> NotificationList:
    rows = db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(_SCAN_LIMIT)
    )
    items = with_digests(list(rows))
    return NotificationList(
        items=[NotificationOut.model_validate(n) for n in items[:_LIST_LIMIT]],
        unread=sum(1 for n in items if n.read_at is None),
    )


@router.post("/{notification_id}/read", operation_id="markNotificationRead")
def mark_read(notification_id: int, user: CurrentUser, db: DbSession) -> OkResponse:
    notification = db.get(Notification, notification_id)
    if notification is None or notification.user_id != user.id:
        raise ApiError(404, "not_found")
    # Reading a digest reads every entry it stands for.
    now = utcnow()
    for n in same_digest(db, notification):
        if n.read_at is None:
            n.read_at = now
    db.commit()
    return OkResponse()


@router.post("/read-all", operation_id="markAllNotificationsRead")
def mark_all_read(user: CurrentUser, db: DbSession) -> OkResponse:
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    db.commit()
    return OkResponse()
