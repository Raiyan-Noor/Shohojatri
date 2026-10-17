"""The timeline: entries by the parent, teachers and specialists (COMPANION_SPEC §5)."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import llm, log_explainer
from app.core import logs as rules
from app.core.deps import CurrentUser, DbSession
from app.core.errors import ApiError
from app.core.notifications import notify
from app.core.permissions import ChildAccess, Holder, Need, authorize, require_child_access
from app.models import (
    Goal,
    Log,
    LogDomain,
    LogType,
    LogVersion,
    LogVisibility,
    NotificationKind,
    Role,
    User,
)
from app.models.base import utcnow
from app.schemas.companion import (
    CreateLogRequest,
    ExplainRequest,
    LogAuthor,
    LogContent,
    LogExplanation,
    LogGoal,
    LogOut,
    LogPage,
    UpdateLogRequest,
)

router = APIRouter(tags=["logs"])

LogReader = Annotated[ChildAccess, Depends(require_child_access(Need.read_logs))]
LogWriter = Annotated[ChildAccess, Depends(require_child_access(Need.write_logs))]

PAGE_MAX = 50


@router.get("/children/{child_id}/logs", operation_id="listLogs")
def list_logs(
    access: LogReader,
    db: DbSession,
    author_role: Role | None = None,
    domain: LogDomain | None = None,
    log_type: Annotated[LogType | None, Query(alias="type")] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=PAGE_MAX)] = 30,
) -> LogPage:
    """Newest first. Opening the first page counts as "seen" for a member's "N new" badge."""
    query = select(Log).where(Log.child_id == access.child.id, rules.visible_clause(access))
    if author_role is not None:
        query = query.where(Log.author_role == author_role)
    if domain is not None:
        query = query.where(rules.domain_filter(domain))
    if log_type is not None:
        query = query.where(Log.type == log_type)
    rows = list(
        db.scalars(
            query.order_by(Log.occurred_at.desc(), Log.id.desc()).offset(offset).limit(limit + 1)
        )
    )
    if access.grant is not None and offset == 0:
        access.grant.logs_seen_at = utcnow()
        db.commit()
    more = len(rows) > limit
    return LogPage(
        items=_out(db, access, rows[:limit]),
        next_offset=offset + limit if more else None,
    )


@router.post(
    "/children/{child_id}/logs", operation_id="createLog", status_code=status.HTTP_201_CREATED
)
def create_log(body: CreateLogRequest, access: LogWriter, db: DbSession) -> LogOut:
    now = utcnow()
    visibility = body.visibility or (
        LogVisibility.private
        if body.explains_log_id
        else rules.default_visibility(access, body.type)
    )
    if body.corrects_log_id is not None:
        original = _same_child_log(db, access, body.corrects_log_id)
        rules.check_correctable(original, access.user.id, now, _corrected(db, original.id))
        # A correction is read by exactly the people who read the original.
        visibility = original.visibility
    if body.explains_log_id is not None:
        explained = _same_child_log(db, access, body.explains_log_id)
        if access.holder is not Holder.parent or explained.author_role == Role.parent:
            raise ApiError(422, "log_not_explainable", detail={"field": "explains_log_id"})
    rules.check_can_write(access, body.type, visibility)
    _check_content(db, access, body, now)

    log = Log(
        child_id=access.child.id,
        author_id=access.user.id,
        author_role=access.user.role,
        type=body.type,
        occurred_at=body.occurred_at or now,
        domains=[d.value for d in body.domains],
        ratings_json={d.value: r for d, r in body.ratings.items()},
        text=body.text,
        goal_id=body.goal_id,
        goal_progress=body.goal_progress,
        mood=body.mood,
        visibility=visibility,
        corrects_log_id=body.corrects_log_id,
        explains_log_id=body.explains_log_id,
        created_at=now,
    )
    db.add(log)
    db.flush()
    if access.holder is not Holder.parent:
        # Every entry is visible to the parent, whatever its visibility.
        notify(
            db,
            access.child.parent_id,
            NotificationKind.log_added,
            child_id=access.child.id,
            child_name=access.child.name,
            author_name=access.user.name,
            author_role=access.user.role.value,
            log_id=log.id,
        )
    db.commit()
    return _out(db, access, [log])[0]


@router.get("/logs/{log_id}", operation_id="getLog")
def get_log(log_id: int, user: CurrentUser, db: DbSession) -> LogOut:
    access, log = _visible_log(db, user, log_id, Need.read_logs)
    return _out(db, access, [log])[0]


@router.patch("/logs/{log_id}", operation_id="updateLog")
def update_log(log_id: int, body: UpdateLogRequest, user: CurrentUser, db: DbSession) -> LogOut:
    """The author's edit within 24 h. The previous content is kept as a version."""
    access, log = _visible_log(db, user, log_id, Need.write_logs)
    now = utcnow()
    if log.author_id != user.id:
        raise ApiError(403, "forbidden")
    if not rules.can_edit(log, user.id, now):
        raise ApiError(409, "log_edit_window_closed")
    if log.corrects_log_id is not None and body.visibility != log.visibility:
        raise ApiError(422, "log_visibility_not_allowed", detail={"field": "visibility"})
    rules.check_can_write(access, body.type, body.visibility)
    _check_content(db, access, body, now)

    db.add(
        LogVersion(log_id=log.id, version=log.version, snapshot_json=_snapshot(log), edited_at=now)
    )
    log.type = body.type
    log.visibility = body.visibility
    log.occurred_at = body.occurred_at
    log.domains = [d.value for d in body.domains]
    log.ratings_json = {d.value: r for d, r in body.ratings.items()}
    log.text = body.text
    log.goal_id = body.goal_id
    log.goal_progress = body.goal_progress
    log.mood = body.mood
    log.version += 1
    log.edited_at = now
    db.commit()
    return _out(db, access, [log])[0]


@router.post("/logs/{log_id}/explain", operation_id="explainLog")
def explain_log(
    log_id: int, body: ExplainRequest, user: CurrentUser, db: DbSession
) -> LogExplanation:
    """Rewrites a teacher's or specialist's entry in simple words for the parent. Not saved."""
    access, log = _visible_log(db, user, log_id, Need.read_logs)
    if access.holder is not Holder.parent:
        raise ApiError(403, "forbidden")
    if log.author_role == Role.parent or not log.text:
        raise ApiError(409, "log_not_explainable")
    goal = db.get(Goal, log.goal_id) if log.goal_id else None
    try:
        return log_explainer.explain(log, goal, body.locale, db=db, user_id=user.id)
    except llm.LLMNotConfiguredError as exc:
        raise ApiError(503, "ai_not_configured") from exc
    except llm.LLMQuotaExceededError as exc:
        raise ApiError(429, "ai_quota_exceeded") from exc
    except llm.LLMError as exc:
        raise ApiError(502, "ai_unavailable") from exc


def _visible_log(db: Session, user: User, log_id: int, need: Need) -> tuple[ChildAccess, Log]:
    log = db.get(Log, log_id)
    if log is None:
        raise ApiError(404, "not_found")
    access = authorize(db, user, log.child_id, need)
    if not rules.can_see(access, log):
        raise ApiError(404, "not_found")
    return access, log


def _same_child_log(db: Session, access: ChildAccess, log_id: int) -> Log:
    log = db.get(Log, log_id)
    if log is None or log.child_id != access.child.id or not rules.can_see(access, log):
        raise ApiError(404, "not_found")
    return log


def _corrected(db: Session, log_id: int) -> bool:
    return db.scalar(select(Log.id).where(Log.corrects_log_id == log_id)) is not None


def _check_content(db: Session, access: ChildAccess, body: LogContent, now: datetime) -> None:
    rules.check_content(
        occurred_at=body.occurred_at or now,
        domains=[d.value for d in body.domains],
        ratings={d.value: r for d, r in body.ratings.items()},
        text=body.text,
        now=now,
    )
    if body.goal_id is not None:
        goal = db.get(Goal, body.goal_id)
        if goal is None or goal.child_id != access.child.id:
            raise ApiError(422, "invalid_goal", detail={"field": "goal_id"})


def _snapshot(log: Log) -> dict[str, object]:
    return {
        "type": log.type.value,
        "visibility": log.visibility.value,
        "occurred_at": log.occurred_at.isoformat(),
        "domains": log.domains,
        "ratings": log.ratings_json,
        "text": log.text,
        "goal_id": log.goal_id,
        "goal_progress": log.goal_progress.value if log.goal_progress else None,
        "mood": log.mood,
    }


def _out(db: Session, access: ChildAccess, logs: list[Log]) -> list[LogOut]:
    if not logs:
        return []
    ids = [log.id for log in logs]
    authors = {
        u.id: u
        for u in db.scalars(select(User).where(User.id.in_({log.author_id for log in logs})))
    }
    goal_ids = {log.goal_id for log in logs if log.goal_id is not None}
    goals = (
        {g.id: g for g in db.scalars(select(Goal).where(Goal.id.in_(goal_ids)))} if goal_ids else {}
    )
    corrections = {
        original: correction
        for correction, original in db.execute(
            select(Log.id, Log.corrects_log_id).where(
                Log.corrects_log_id.in_(ids), rules.visible_clause(access)
            )
        )
    }
    now = utcnow()
    out = []
    for log in logs:
        author = authors[log.author_id]
        goal = goals.get(log.goal_id) if log.goal_id is not None else None
        corrected_by = corrections.get(log.id)
        out.append(
            LogOut(
                id=log.id,
                type=log.type,
                author=LogAuthor(id=author.id, name=author.name, role=log.author_role),
                occurred_at=log.occurred_at,
                domains=[LogDomain(d) for d in log.domains],
                ratings={LogDomain(d): r for d, r in log.ratings_json.items()},
                text=log.text,
                goal=LogGoal(id=goal.id, title=goal.title) if goal else None,
                goal_progress=log.goal_progress,
                mood=log.mood,
                visibility=log.visibility,
                version=log.version,
                created_at=log.created_at,
                edited_at=log.edited_at,
                corrects_log_id=log.corrects_log_id,
                corrected_by_log_id=corrected_by,
                explains_log_id=log.explains_log_id,
                can_edit=rules.can_edit(log, access.user.id, now),
                can_correct=rules.can_correct(log, access.user.id, now, corrected_by is not None),
                editable_until=rules.editable_until(log),
            )
        )
    return out
