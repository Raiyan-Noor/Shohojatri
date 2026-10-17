from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.access_requests import expire_stale_requests
from app.core.characteristics import load_characteristics
from app.core.child_codes import new_code
from app.core.dates import BD_TZ, age_in_months, today_bd
from app.core.deps import DbSession, require_roles
from app.core.errors import ApiError
from app.core.logs import visible_clause
from app.core.permissions import ChildAccess, Holder, Need, require_child_access
from app.models import (
    AccessGrant,
    AccessRequest,
    AccessRequestStatus,
    AuditLog,
    Characteristics,
    Child,
    Log,
    Role,
    User,
)
from app.models.base import utcnow
from app.schemas.access import ActivityActor, ActivityEntry, Grant, IncomingAccessRequest, Person
from app.schemas.children import ChildCode, ChildOut, CreateChildRequest
from app.schemas.companion import Diagnosis

router = APIRouter(prefix="/children", tags=["children"])

ParentUser = Annotated[User, Depends(require_roles(Role.parent))]
ChildViewer = Annotated[User, Depends(require_roles(Role.parent, Role.teacher, Role.specialist))]
ProfileReader = Annotated[ChildAccess, Depends(require_child_access(Need.read_profile))]
AccessManager = Annotated[ChildAccess, Depends(require_child_access(Need.manage_access))]

_ACTIVITY_DAYS = 180
_ACTIVITY_ROWS = 2000
_ACTIVITY_ENTRIES = 50


@router.post("", operation_id="createChild", status_code=status.HTTP_201_CREATED)
def create_child(body: CreateChildRequest, user: ParentUser, db: DbSession) -> ChildOut:
    if body.dob > today_bd():
        raise ApiError(422, "dob_in_future", detail={"field": "dob"})
    child = Child(parent_id=user.id, code=new_code(db), name=body.name, dob=body.dob, sex=body.sex)
    db.add(child)
    db.commit()
    return child_out(db, ChildAccess(child, user, Holder.parent, None))


@router.get("", operation_id="listChildren")
def list_children(user: ChildViewer, db: DbSession) -> list[ChildOut]:
    """The children on the viewer's home: a parent's own, or those a member was approved for."""
    if user.role == Role.parent:
        expire_stale_requests(db)
        children = db.scalars(
            select(Child)
            .where(Child.parent_id == user.id, Child.deleted_at.is_(None))
            .order_by(Child.created_at)
        )
        return [child_out(db, ChildAccess(c, user, Holder.parent, None)) for c in children]

    rows = db.execute(
        select(Child, AccessGrant)
        .join(AccessGrant, AccessGrant.child_id == Child.id)
        .where(
            AccessGrant.user_id == user.id,
            AccessGrant.revoked_at.is_(None),
            Child.deleted_at.is_(None),
        )
        .order_by(AccessGrant.granted_at.desc())
    ).all()
    for child, _ in rows:
        # A card shows profile basics, so each one counts as a profile read.
        audit.record(db, user.id, child.id, Need.read_profile.verb, Need.read_profile.object)
    db.commit()
    return [
        child_out(db, ChildAccess(child, user, Holder(grant.scope.value), grant))
        for child, grant in rows
    ]


@router.get("/{child_id}", operation_id="getChild")
def get_child(access: ProfileReader, db: DbSession) -> ChildOut:
    if access.holder is Holder.parent:
        expire_stale_requests(db)
    return child_out(db, access)


@router.post("/{child_id}/regenerate-code", operation_id="regenerateChildCode")
def regenerate_code(access: AccessManager, db: DbSession) -> ChildCode:
    """New Child ID. The old one stops working for new requests; current members keep access
    and requests already sent stay open."""
    access.child.code = new_code(db)
    audit.record(db, access.user.id, access.child.id, "regenerate", "child_code")
    db.commit()
    return ChildCode(code=access.child.code)


@router.get("/{child_id}/access-requests", operation_id="listChildAccessRequests")
def list_child_access_requests(access: AccessManager, db: DbSession) -> list[IncomingAccessRequest]:
    expire_stale_requests(db)
    rows = db.execute(
        select(AccessRequest, User)
        .join(User, User.id == AccessRequest.requester_id)
        .where(
            AccessRequest.child_id == access.child.id,
            AccessRequest.status == AccessRequestStatus.pending,
        )
        .order_by(AccessRequest.created_at.desc())
    ).all()
    return [
        IncomingAccessRequest(
            id=request.id,
            requester=Person.model_validate(requester),
            message=request.message,
            child_code=request.child_code,
            created_at=request.created_at,
        )
        for request, requester in rows
    ]


@router.get("/{child_id}/grants", operation_id="listChildGrants")
def list_child_grants(access: AccessManager, db: DbSession) -> list[Grant]:
    """Active care-team members (the parent is implied)."""
    rows = db.execute(
        select(AccessGrant, User)
        .join(User, User.id == AccessGrant.user_id)
        .where(AccessGrant.child_id == access.child.id, AccessGrant.revoked_at.is_(None))
        .order_by(AccessGrant.granted_at)
    ).all()
    return [Grant.of(grant, member) for grant, member in rows]


@router.get("/{child_id}/activity", operation_id="listChildActivity")
def list_child_activity(access: AccessManager, db: DbSession) -> list[ActivityEntry]:
    """Who viewed or changed what, newest first (COMPANION_SPEC §3.2)."""
    since = utcnow() - timedelta(days=_ACTIVITY_DAYS)
    rows = db.execute(
        select(AuditLog, User)
        .join(User, User.id == AuditLog.actor_id)
        .where(AuditLog.child_id == access.child.id, AuditLog.at >= since)
        .order_by(AuditLog.at.desc(), AuditLog.id.desc())
        .limit(_ACTIVITY_ROWS)
    ).all()

    entries: list[ActivityEntry] = []
    by_key: dict[tuple[int, str, str, date], ActivityEntry] = {}
    subjects = _subject_names(db, [row.resource for row, _ in rows])
    for row, actor in rows:
        key = (actor.id, row.action, row.resource, row.at.astimezone(BD_TZ).date())
        if key in by_key:
            by_key[key].count += 1
            continue
        if len(entries) == _ACTIVITY_ENTRIES:
            continue
        kind = row.resource.split(":")[0]
        entry = ActivityEntry(
            actor=ActivityActor(id=actor.id, name=actor.name, role=actor.role),
            action=row.action,
            resource=kind,
            subject_name=subjects.get(row.resource),
            at=row.at,
            count=1,
        )
        by_key[key] = entry
        entries.append(entry)
    return entries


def child_out(db: Session, access: ChildAccess) -> ChildOut:
    child = access.child
    is_parent = access.holder is Holder.parent
    pending = 0
    if is_parent:
        # Callers expire stale requests first.
        pending = db.scalar(
            select(func.count())
            .select_from(AccessRequest)
            .where(
                AccessRequest.child_id == child.id,
                AccessRequest.status == AccessRequestStatus.pending,
            )
        )
    latest = db.scalar(
        select(Characteristics.answers_json)
        .where(Characteristics.child_id == child.id)
        .order_by(Characteristics.version.desc())
        .limit(1)
    )
    new_logs = 0
    if access.grant is not None:
        seen = access.grant.logs_seen_at or access.grant.granted_at
        new_logs = db.scalar(
            select(func.count())
            .select_from(Log)
            .where(
                Log.child_id == child.id,
                Log.author_id != access.user.id,
                Log.created_at > seen,
                visible_clause(access),
            )
        )
    return ChildOut(
        id=child.id,
        name=child.name,
        dob=child.dob,
        age_months=age_in_months(child.dob, today_bd()),
        sex=child.sex,
        status=child.status,
        access=access.holder,
        code=child.code if is_parent else None,
        pending_requests=pending or 0,
        member_since=access.grant.granted_at if access.grant else None,
        diagnosis=Diagnosis.model_validate(child.diagnosis_json) if child.diagnosis_json else None,
        characteristics_done=len(latest["sections"]) if latest else 0,
        characteristics_total=len(load_characteristics().sections),
        new_logs=new_logs or 0,
    )


def _subject_names(db: Session, resources: list[str]) -> dict[str, str]:
    """`grant:12` / `access_request:5` → the member's or requester's name."""
    ids: dict[str, set[int]] = {"grant": set(), "access_request": set()}
    for resource in resources:
        kind, _, raw_id = resource.partition(":")
        if kind in ids and raw_id.isdigit():
            ids[kind].add(int(raw_id))

    names: dict[str, str] = {}
    if ids["grant"]:
        for grant_id, name in db.execute(
            select(AccessGrant.id, User.name)
            .join(User, User.id == AccessGrant.user_id)
            .where(AccessGrant.id.in_(ids["grant"]))
        ):
            names[f"grant:{grant_id}"] = name
    if ids["access_request"]:
        for request_id, name in db.execute(
            select(AccessRequest.id, User.name)
            .join(User, User.id == AccessRequest.requester_id)
            .where(AccessRequest.id.in_(ids["access_request"]))
        ):
            names[f"access_request:{request_id}"] = name
    return names
