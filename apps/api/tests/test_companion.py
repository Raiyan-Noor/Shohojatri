"""Activation and the characteristics questionnaire (COMPANION_SPEC §1, §4)."""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.characteristics import QuestionType, load_characteristics
from app.models import AccessGrant, Characteristics, Child, ChildStatus, GrantScope, Role, User
from tests.conftest import MakeChild, MakeUser

ClientFor = Callable[[str], TestClient]


@pytest.fixture
def setup(db: Session, make_user: MakeUser, make_child: MakeChild) -> tuple[Child, User, User]:
    parent = make_user(Role.parent)
    teacher = make_user(Role.teacher, name="Nasrin")
    specialist = make_user(Role.specialist, name="Dr Tanvir")
    child = make_child(parent, name="Rafi")
    db.add(AccessGrant(child_id=child.id, user_id=teacher.id, scope=GrantScope.education))
    db.add(AccessGrant(child_id=child.id, user_id=specialist.id, scope=GrantScope.clinical))
    db.commit()
    return child, teacher, specialist


def test_questionnaire_has_the_spec_sections(client_for: ClientFor, setup: Any) -> None:
    sections = [s.id for s in load_characteristics().sections]
    assert sections == [
        "communication", "social_play", "sensory", "triggers", "calming",
        "strengths", "daily_living", "current_support", "health", "family_goals",
    ]  # fmt: skip
    for section in load_characteristics().sections:
        for q in section.questions:
            assert q.text_bn and q.text_en
            assert all(o.bn and o.en for o in (*q.options, *q.rows))
            if q.type == QuestionType.multi:
                assert q.other, f"{q.id}: multi-select questions offer Other"
    body = client_for("teacher@test.bd").get("/api/v1/characteristics/questionnaire").json()
    assert [s["id"] for s in body["sections"]] == sections


def _save(client: TestClient, child: Child, section: str, answers: dict[str, Any]) -> Any:
    return client.put(
        f"/api/v1/children/{child.id}/characteristics/sections/{section}",
        json={"answers": answers},
    )


def test_sections_are_versioned(client_for: ClientFor, setup: Any, db: Session) -> None:
    child, _, _ = setup
    parent = client_for("parent@test.bd")
    empty = parent.get(f"/api/v1/children/{child.id}/characteristics").json()
    assert empty["version"] == 0 and empty["sections"] == {}

    answers = {
        "main_way": {"selected": ["single_words", "other"], "other_text": " Hums tunes "},
        "understands": {"selected": ["simple_instructions"]},
        "home_languages": {"selected": []},  # blank answers are dropped
    }
    body = _save(parent, child, "communication", answers).json()
    assert body["version"] == 1
    assert body["sections"]["communication"] == {
        "main_way": {"selected": ["single_words", "other"], "other_text": "Hums tunes"},
        "understands": {"selected": ["simple_instructions"], "other_text": None},
    }
    # The same answers again: no new version.
    assert _save(parent, child, "communication", answers).json()["version"] == 1

    grid = {"senses": {"sound": "avoids", "movement": "seeks"}, "sensitivities": ["blender"]}
    assert _save(parent, child, "sensory", grid).json()["version"] == 2
    goals = {"goals": ["Say what he wants with words", "Sit for meals"]}
    latest = _save(parent, child, "family_goals", goals).json()
    assert latest["version"] == 3
    assert set(latest["sections"]) == {"communication", "sensory", "family_goals"}

    rows = db.scalars(select(Characteristics).order_by(Characteristics.version)).all()
    assert [set(r.answers_json["sections"]) for r in rows] == [
        {"communication"},
        {"communication", "sensory"},
        {"communication", "sensory", "family_goals"},
    ]
    [card] = parent.get("/api/v1/children").json()
    assert (card["characteristics_done"], card["characteristics_total"]) == (3, 10)


@pytest.mark.parametrize(
    ("section", "answers", "code"),
    [
        ("communication", {"main_way": {"selected": ["telepathy"]}}, "invalid_answer"),
        ("communication", {"understands": {"selected": ["few_words", "unsure"]}}, "invalid_answer"),
        ("communication", {"main_way": {"selected": ["other"]}}, "other_text_required"),
        ("communication", {"main_way": {"selected": [], "other_text": "x"}}, "other_text_required"),
        ("communication", {"nope": "x"}, "invalid_answer"),
        (
            "current_support",
            {"school": {"selected": ["other"], "other_text": "x"}},
            "invalid_answer",
        ),
        ("sensory", {"senses": {"sound": "loves"}}, "invalid_answer"),
        ("family_goals", {"goals": ["a", "b", "c", "d"]}, "invalid_answer"),
        ("health", {"other_conditions": "x" * 1001}, "invalid_answer"),
        (
            "current_support",
            {"therapies": [{"type": "other", "provider": "Shishu Bikash"}]},
            "other_text_required",
        ),
    ],
)
def test_invalid_answers(
    client_for: ClientFor, setup: Any, section: str, answers: dict[str, Any], code: str
) -> None:
    child, _, _ = setup
    response = _save(client_for("parent@test.bd"), child, section, answers)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["detail"]["field"] == next(iter(answers))


def test_therapies(client_for: ClientFor, setup: Any) -> None:
    child, _, _ = setup
    rows = [
        {"type": "speech", "provider": "Shishu Bikash Kendro", "frequency": "twice a week"},
        {"type": "other", "other_text": "Music therapy"},
    ]
    body = _save(client_for("parent@test.bd"), child, "current_support", {"therapies": rows}).json()
    assert body["sections"]["current_support"]["therapies"][1] == {
        "type": "other", "other_text": "Music therapy", "provider": None, "frequency": None,
    }  # fmt: skip


def test_who_reads_and_writes(client_for: ClientFor, setup: Any, make_user: MakeUser) -> None:
    child, _, _ = setup
    url = f"/api/v1/children/{child.id}/characteristics"
    for email in ("teacher@test.bd", "specialist@test.bd"):
        member = client_for(email)
        assert member.get(url).status_code == 200
        assert _save(member, child, "triggers", {}).status_code == 403
    make_user(Role.parent, email="other@test.bd")
    assert client_for("other@test.bd").get(url).status_code == 404
    assert _save(client_for("parent@test.bd"), child, "nope", {}).status_code == 404


def test_medications_follow_the_sharing_option(
    client_for: ClientFor, setup: Any, db: Session
) -> None:
    child, teacher, _ = setup
    health = {"other_conditions": "Sleep problems", "medications": "Melatonin 1 ml at night"}
    _save(client_for("parent@test.bd"), child, "health", health)
    url = f"/api/v1/children/{child.id}/characteristics"

    def seen(email: str) -> dict[str, Any]:
        return client_for(email).get(url).json()["sections"]["health"]

    assert seen("teacher@test.bd") == {"other_conditions": "Sleep problems"}
    assert seen("specialist@test.bd") == health
    assert seen("parent@test.bd") == health
    grant = db.scalar(select(AccessGrant).where(AccessGrant.user_id == teacher.id))
    assert grant is not None
    grant.share_medications = True
    db.commit()
    assert seen("teacher@test.bd") == health


# Activation ------------------------------------------------------------------------------------


def _activate(client: TestClient, child: Child, **body: Any) -> Any:
    return client.post(f"/api/v1/children/{child.id}/activate", json=body)


def test_activate(client_for: ClientFor, setup: Any, db: Session) -> None:
    child, _, specialist = setup
    parent = client_for("parent@test.bd")
    response = _activate(
        parent, child, kind="autism", diagnosed_on="2026-06", diagnosed_by="Dr Rahman",
        condition_text="ignored for autism",
    )  # fmt: skip
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "companion"
    assert body["diagnosis"] == {
        "kind": "autism", "condition_text": None, "diagnosed_on": "2026-06",
        "diagnosed_by": "Dr Rahman", "diagnosed_by_user_id": None,
    }  # fmt: skip

    # Again, to change it: picking a care-team specialist copies their name.
    body = _activate(parent, child, kind="being_assessed", diagnosed_by_user_id=specialist.id)
    assert body.json()["diagnosis"]["diagnosed_by"] == "Dr Tanvir"
    # Members see the summary (§3.2 "Diagnosis summary").
    [card] = client_for("teacher@test.bd").get("/api/v1/children").json()
    assert card["diagnosis"]["kind"] == "being_assessed"
    db.refresh(child)
    assert child.status == ChildStatus.companion


def test_activate_rules(client_for: ClientFor, setup: Any) -> None:
    child, teacher, _ = setup
    parent = client_for("parent@test.bd")
    assert _activate(parent, child, kind="autism_plus").status_code == 422  # what else?
    assert _activate(parent, child, kind="autism", diagnosed_on="2026-13").status_code == 422
    early = _activate(parent, child, kind="autism", diagnosed_on="2020-01")
    assert early.json()["error"]["code"] == "diagnosis_before_birth"
    not_clinical = _activate(parent, child, kind="autism", diagnosed_by_user_id=teacher.id)
    assert not_clinical.json()["error"]["code"] == "not_a_care_team_specialist"
    assert _activate(client_for("specialist@test.bd"), child, kind="autism").status_code == 403


# Every new child endpoint, for every role: parent, teacher, specialist, another parent, admin.
OK = 200
MATRIX = [
    ("GET", "/children/{id}/characteristics", None, (OK, OK, OK, 404, 404)),
    ("PUT", "/children/{id}/characteristics/sections/triggers", {"answers": {}},
     (OK, 403, 403, 404, 404)),
    ("POST", "/children/{id}/activate", {"kind": "autism"}, (OK, 403, 403, 404, 404)),
    ("GET", "/children/{id}/goals", None, (OK, OK, OK, 404, 404)),
    ("GET", "/children/{id}/logs", None, (OK, OK, OK, 404, 404)),
    ("POST", "/children/{id}/logs", {"type": "observation", "text": "x"},
     (201, 201, 201, 404, 404)),
]  # fmt: skip


@pytest.mark.parametrize(("method", "path", "body", "expected"), MATRIX)
def test_endpoint_matrix(
    client_for: ClientFor,
    setup: Any,
    make_user: MakeUser,
    method: str,
    path: str,
    body: Any,
    expected: tuple[int, ...],
) -> None:
    child, _, _ = setup
    make_user(Role.parent, email="other@test.bd")
    make_user(Role.admin)
    emails = ("parent@test.bd", "teacher@test.bd", "specialist@test.bd", "other@test.bd",
              "admin@test.bd")  # fmt: skip
    url = "/api/v1" + path.format(id=child.id)
    got = tuple(client_for(email).request(method, url, json=body).status_code for email in emails)
    assert got == expected
