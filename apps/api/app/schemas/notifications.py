from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models import NotificationKind, Role


class NotificationPayload(BaseModel):
    """Parameters for the translated text. Which fields are set depends on `kind`."""

    child_id: int | None = None
    child_name: str | None = None
    # Declined requests only carry the code the requester typed, never the child's name.
    child_code: str | None = None
    requester_name: str | None = None
    requester_role: Role | None = None
    # log_added: who wrote the entry.
    author_name: str | None = None
    author_role: Role | None = None
    log_id: int | None = None
    # log_digest: how many entries it stands for.
    count: int | None = None


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: NotificationKind
    payload: NotificationPayload
    read_at: datetime | None
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    unread: int
