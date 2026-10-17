"""Turning a child's record into a companion profile: diagnosis, characteristics, goals
(COMPANION_SPEC §1, §4, §7)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.characteristics import empty_answers, load_characteristics, validate_section
from app.core.deps import CurrentUser, DbSession
from app.core.errors import ApiError
from app.core.permissions import ChildAccess, Need, active_grant, require_child_access
from app.models import Characteristics, ChildStatus, GrantScope, User
from app.models.companion import Goal
from app.routers.children import child_out
from app.schemas.children import ChildOut
from app.schemas.companion import (
    CharacteristicsOut,
    CharacteristicsQuestionnaireOut,
    Diagnosis,
    GoalOut,
    SaveSectionRequest,
)

router = APIRouter(tags=["companion"])

ProfileReader = Annotated[ChildAccess, Depends(require_child_access(Need.read_profile))]
ProfileWriter = Annotated[ChildAccess, Depends(require_child_access(Need.write_profile))]
CarePlanReader = Annotated[ChildAccess, Depends(require_child_access(Need.read_care_plan))]


@router.post("/children/{child_id}/activate", operation_id="activateCompanion")
def activate(body: Diagnosis, access: ProfileWriter, db: DbSession) -> ChildOut:
    """Saves the diagnosis details and makes the record a companion profile. Called again to
    change the details later. Nothing from screening is touched (§1)."""
    child = access.child
    if body.diagnosed_on and body.diagnosed_on < child.dob.strftime("%Y-%m"):
        raise ApiError(422, "diagnosis_before_birth", detail={"field": "diagnosed_on"})
    if body.diagnosed_by_user_id is not None:
        grant = active_grant(db, child.id, body.diagnosed_by_user_id)
        if grant is None or grant.scope != GrantScope.clinical:
            raise ApiError(422, "not_a_care_team_specialist", detail={"field": "diagnosed_by"})
        # A snapshot, so the profile still reads right if the member later leaves.
        body.diagnosed_by = db.get(User, body.diagnosed_by_user_id).name  # type: ignore[union-attr]
    child.diagnosis_json = body.model_dump(mode="json")
    child.status = ChildStatus.companion
    db.commit()
    return child_out(db, access)


@router.get("/characteristics/questionnaire", operation_id="getCharacteristicsQuestionnaire")
def get_questionnaire(_: CurrentUser) -> CharacteristicsQuestionnaireOut:
    return CharacteristicsQuestionnaireOut.model_validate(load_characteristics().model_dump())


@router.get("/children/{child_id}/characteristics", operation_id="getCharacteristics")
def get_characteristics(access: ProfileReader, db: DbSession) -> CharacteristicsOut:
    out = _out(db, _latest(db, access.child.id))
    # Medicines written into the profile follow the medications permission, not the profile's
    # (COMPANION_SPEC §3.2: teachers see them only when the parent shares medications).
    if not access.can(Need.read_medications) and "health" in out.sections:
        health = {k: v for k, v in out.sections["health"].items() if k != "medications"}
        out.sections = {**out.sections, "health": health}
    return out


@router.put(
    "/children/{child_id}/characteristics/sections/{section_id}",
    operation_id="saveCharacteristicsSection",
)
def save_section(
    section_id: str, body: SaveSectionRequest, access: ProfileWriter, db: DbSession
) -> CharacteristicsOut:
    """Saves one section (one wizard screen). A change makes a new version; saving the same
    answers again doesn't."""
    section = load_characteristics().section(section_id)
    if section is None:
        raise ApiError(404, "not_found")
    answers = validate_section(section, body.answers)
    latest = _latest(db, access.child.id)
    current = latest.answers_json if latest else empty_answers()
    if latest is not None and current["sections"].get(section_id) == answers:
        return _out(db, latest)

    row = Characteristics(
        child_id=access.child.id,
        version=(latest.version if latest else 0) + 1,
        answers_json={
            "questionnaire_version": load_characteristics().version,
            "sections": {**current["sections"], section_id: answers},
        },
        created_by=access.user.id,
    )
    db.add(row)
    db.commit()
    return _out(db, row)


@router.get("/children/{child_id}/goals", operation_id="listGoals")
def list_goals(access: CarePlanReader, db: DbSession) -> list[GoalOut]:
    goals = db.scalars(
        select(Goal).where(Goal.child_id == access.child.id).order_by(Goal.created_at)
    )
    return [GoalOut.model_validate(goal, from_attributes=True) for goal in goals]


def _latest(db: Session, child_id: int) -> Characteristics | None:
    return db.scalar(
        select(Characteristics)
        .where(Characteristics.child_id == child_id)
        .order_by(Characteristics.version.desc())
        .limit(1)
    )


def _out(db: Session, row: Characteristics | None) -> CharacteristicsOut:
    if row is None:
        empty = empty_answers()
        return CharacteristicsOut(
            version=0,
            questionnaire_version=empty["questionnaire_version"],
            sections={},
            updated_at=None,
            updated_by=None,
        )
    author = db.get(User, row.created_by)
    return CharacteristicsOut(
        version=row.version,
        questionnaire_version=row.answers_json["questionnaire_version"],
        sections=row.answers_json["sections"],
        updated_at=row.created_at,
        updated_by=author.name if author else None,
    )
