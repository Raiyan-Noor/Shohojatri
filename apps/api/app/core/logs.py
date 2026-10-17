"""Timeline entries: who sees which, who may write what, editing and corrections
(COMPANION_SPEC §3.2, §5.1).

Visibility is checked in two forms that must agree: `can_see` for one entry and
`visible_clause` for SQL listings and counts. Tests cover both against the same table.
"""

from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, String, cast, false, or_, true

from app.core.errors import ApiError
from app.core.permissions import ChildAccess, Holder, Need
from app.models import Log, LogType, LogVisibility

EDIT_WINDOW = timedelta(hours=24)
# Written by the app itself (monthly check-in, B13), never typed in.
SYSTEM_TYPES = frozenset({LogType.check_in})
# Clock skew between a phone and the server.
FUTURE_SLACK = timedelta(minutes=5)


def can_see(access: ChildAccess, log: Log) -> bool:
    if log.author_id == access.user.id or access.holder is Holder.parent:
        return True
    match log.visibility:
        case LogVisibility.care_team:
            return access.can(Need.read_logs)
        case LogVisibility.clinical:
            return access.can(Need.read_clinical_logs)
        case LogVisibility.private:
            return False


def visible_clause(access: ChildAccess) -> ColumnElement[bool]:
    """SQL twin of `can_see` (the caller filters by child)."""
    if access.holder is Holder.parent:
        return true()
    shown = [
        visibility
        for visibility, need in (
            (LogVisibility.care_team, Need.read_logs),
            (LogVisibility.clinical, Need.read_clinical_logs),
        )
        if access.can(need)
    ]
    return or_(
        Log.author_id == access.user.id,
        Log.visibility.in_(shown) if shown else false(),
    )


def default_visibility(access: ChildAccess, log_type: LogType) -> LogVisibility:
    """Care team, except a specialist's clinical note, which defaults to clinical."""
    if log_type == LogType.clinical_note and access.holder is Holder.clinical:
        return LogVisibility.clinical
    return LogVisibility.care_team


def check_can_write(access: ChildAccess, log_type: LogType, visibility: LogVisibility) -> None:
    if not access.can(Need.write_logs):
        raise ApiError(403, "forbidden")
    if log_type in SYSTEM_TYPES:
        raise ApiError(422, "log_type_not_allowed", detail={"field": "type"})
    if log_type == LogType.clinical_note and not access.can(Need.write_clinical_notes):
        raise ApiError(422, "log_type_not_allowed", detail={"field": "type"})
    # Writing an entry you could no longer read would make it vanish from your own timeline.
    if visibility == LogVisibility.clinical and not access.can(Need.read_clinical_logs):
        raise ApiError(422, "log_visibility_not_allowed", detail={"field": "visibility"})


def check_content(
    *,
    occurred_at: datetime,
    domains: list[str],
    ratings: dict[str, int],
    text: str | None,
    now: datetime,
) -> None:
    if occurred_at > now + FUTURE_SLACK:
        raise ApiError(422, "log_in_future", detail={"field": "occurred_at"})
    if set(ratings) - set(domains):
        raise ApiError(422, "rating_without_domain", detail={"field": "ratings"})
    if not (text or domains):
        raise ApiError(422, "log_empty", detail={"field": "text"})


def editable_until(log: Log) -> datetime:
    return log.created_at + EDIT_WINDOW


def can_edit(log: Log, user_id: int, now: datetime) -> bool:
    return log.author_id == user_id and now < editable_until(log)


def can_correct(log: Log, user_id: int, now: datetime, corrected: bool) -> bool:
    """Corrections replace edits once the 24 h window has closed (§5.1)."""
    return log.author_id == user_id and now >= editable_until(log) and not corrected


def check_correctable(log: Log, user_id: int, now: datetime, corrected: bool) -> None:
    if log.author_id != user_id:
        raise ApiError(403, "forbidden")
    if now < editable_until(log):
        raise ApiError(409, "log_still_editable")
    if corrected:
        raise ApiError(409, "log_already_corrected")


def domain_filter(domain: str) -> ColumnElement[bool]:
    """Entries tagged with `domain`. The JSON list's text form contains `"domain"` on SQLite and
    Postgres alike; no domain name is a quoted substring of another."""
    return cast(Log.domains, String).like(f'%"{domain}"%')
