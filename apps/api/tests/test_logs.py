"""Timeline entries (COMPANION_SPEC §5): visibility per role, the 24 h edit window, corrections,
notifications and "Explain this to me"."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import llm
from app.core import logs as rules
from app.core.permissions import resolve_access
from app.models import (
    AccessGrant,
    AuditLog,
    Child,
    Goal,
    GrantScope,
    Log,
    LogVersion,
    Notification,
    Role,
    User,
)
from app.models.base import utcnow
from app.schemas.companion import LogExplanation
from tests.conftest import MakeChild, MakeUser

ClientFor = Callable[[str], TestClient]


@dataclass
class Family:
    child: Child
    parent: User
    teacher: User
    specialist: User
    outsider: User  # a teacher with no grant


@pytest.fixture
def family(db: Session, make_user: MakeUser, make_child: MakeChild) -> Family:
    parent = make_user(Role.parent, name="Sabrina")
    teacher = make_user(Role.teacher, name="Nasrin", organisation="Alo School")
    specialist = make_user(Role.specialist, name="Dr Tanvir")
    outsider = make_user(Role.teacher, email="outsider@test.bd")
    child = make_child(parent, name="Rafi")
    for member, scope in ((teacher, GrantScope.education), (specialist, GrantScope.clinical)):
        db.add(AccessGrant(child_id=child.id, user_id=member.id, scope=scope))
    db.commit()
    return Family(child, parent, teacher, specialist, outsider)


def _url(family: Family) -> str:
    return f"/api/v1/children/{family.child.id}/logs"


def _post(client: TestClient, family: Family, **body: Any) -> Any:
    body.setdefault("type", "observation")
    body.setdefault("text", "Said 'pani' twice today")
    return client.post(_url(family), json=body)


def _age(db: Session, log_id: int, hours: float) -> None:
    """Moves an entry `hours` into the past, as if written then."""
    log = db.get(Log, log_id)
    assert log is not None
    log.created_at = utcnow() - timedelta(hours=hours)
    db.commit()


def _listed_ids(client: TestClient, family: Family, **params: Any) -> set[int]:
    response = client.get(_url(family), params=params)
    assert response.status_code == 200, response.text
    return {item["id"] for item in response.json()["items"]}


# Visibility ------------------------------------------------------------------------------------

# (author, visibility) → who sees it besides the author. COMPANION_SPEC §3.2, OPEN_QUESTIONS #11.
SEES = {
    ("parent", "care_team"): {"parent", "teacher", "specialist"},
    ("parent", "clinical"): {"parent", "specialist"},
    ("parent", "private"): {"parent"},
    ("teacher", "care_team"): {"parent", "teacher", "specialist"},
    ("teacher", "private"): {"parent", "teacher"},
    ("specialist", "care_team"): {"parent", "teacher", "specialist"},
    ("specialist", "clinical"): {"parent", "specialist"},
    ("specialist", "private"): {"parent", "specialist"},
}


def test_visibility_per_role(family: Family, client_for: ClientFor, db: Session) -> None:
    people = {"parent": family.parent, "teacher": family.teacher, "specialist": family.specialist}
    clients = {name: client_for(user.email or "") for name, user in people.items()}
    written: dict[tuple[str, str], int] = {}
    for author, visibility in SEES:
        response = _post(clients[author], family, visibility=visibility)
        assert response.status_code == 201, (author, visibility, response.text)
        assert response.json()["visibility"] == visibility
        written[(author, visibility)] = response.json()["id"]

    for viewer, client in clients.items():
        expected = {log_id for key, log_id in written.items() if viewer in SEES[key]}
        assert _listed_ids(client, family) == expected, viewer
        for key, log_id in written.items():
            # The single-entry paths agree with the listing: hidden entries are 404.
            got = client.get(f"/api/v1/logs/{log_id}").status_code
            assert got == (200 if viewer in SEES[key] else 404), (viewer, key)
            if viewer not in SEES[key]:
                response = client.patch(
                    f"/api/v1/logs/{log_id}",
                    json={
                        "type": "observation",
                        "visibility": key[1],
                        "text": "x",
                        "occurred_at": utcnow().isoformat(),
                    },
                )
                assert response.status_code == 404, (viewer, key)

    outsider = client_for(family.outsider.email or "")
    assert outsider.get(_url(family)).status_code == 404


def test_can_see_matches_sql_clause(family: Family, client_for: ClientFor, db: Session) -> None:
    for author, visibility in SEES:
        user = getattr(family, author)
        _post(client_for(user.email), family, visibility=visibility)
    logs = list(db.scalars(select(Log)))
    for viewer in (family.parent, family.teacher, family.specialist):
        access = resolve_access(db, viewer, family.child.id)
        assert access is not None
        in_sql = set(db.scalars(select(Log.id).where(rules.visible_clause(access))))
        assert in_sql == {log.id for log in logs if rules.can_see(access, log)}


def test_teacher_cannot_write_clinical(family: Family, client_for: ClientFor) -> None:
    teacher = client_for(family.teacher.email or "")
    response = _post(teacher, family, visibility="clinical")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "log_visibility_not_allowed"
    response = _post(teacher, family, type="clinical_note")
    assert response.json()["error"]["code"] == "log_type_not_allowed"


def test_only_specialists_write_clinical_notes(family: Family, client_for: ClientFor) -> None:
    parent = client_for(family.parent.email or "")
    assert _post(parent, family, type="clinical_note").status_code == 422
    specialist = client_for(family.specialist.email or "")
    response = _post(specialist, family, type="clinical_note")
    assert response.status_code == 201
    # Clinical by default for a specialist's clinical note, care team otherwise.
    assert response.json()["visibility"] == "clinical"
    assert _post(specialist, family, type="therapy_session").json()["visibility"] == "care_team"


def test_check_ins_are_not_typed_in(family: Family, client_for: ClientFor) -> None:
    response = _post(client_for(family.parent.email or ""), family, type="check_in")
    assert response.json()["error"]["code"] == "log_type_not_allowed"


def test_content_rules(family: Family, client_for: ClientFor, db: Session) -> None:
    parent = client_for(family.parent.email or "")
    future = (utcnow() + timedelta(hours=1)).isoformat()
    assert _post(parent, family, occurred_at=future).json()["error"]["code"] == "log_in_future"
    response = _post(parent, family, domains=["sleep"], ratings={"eating": 3})
    assert response.json()["error"]["code"] == "rating_without_domain"
    assert _post(parent, family, text=None).json()["error"]["code"] == "log_empty"
    assert _post(parent, family, ratings={"sleep": 6}, domains=["sleep"]).status_code == 422
    assert _post(parent, family, goal_progress="some").status_code == 422  # without goal_id

    other = Child(parent_id=family.parent.id, name="Nuha", dob=family.child.dob, code="SJ-X0001")
    db.add(other)
    db.flush()
    foreign = Goal(
        child_id=other.id,
        title="x",
        domain="sleep",
        set_by_role=Role.parent,
        created_by=family.parent.id,
    )
    goal = Goal(
        child_id=family.child.id,
        title="Say 'more'",
        domain="communication",
        set_by_role=Role.teacher,
        created_by=family.teacher.id,
    )
    db.add_all([foreign, goal])
    db.commit()
    response = _post(parent, family, goal_id=foreign.id, goal_progress="some")
    assert response.json()["error"]["code"] == "invalid_goal"

    # A quick log: domain chips + one rating, no text.
    response = _post(
        parent,
        family,
        text=None,
        domains=["communication", "social"],
        ratings={"communication": 4, "social": 4},
        goal_id=goal.id,
        goal_progress="good",
        mood=5,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["goal"] == {"id": goal.id, "title": "Say 'more'"}
    assert body["ratings"] == {"communication": 4, "social": 4}


def test_member_reads_are_audited(family: Family, client_for: ClientFor, db: Session) -> None:
    client_for(family.teacher.email or "").get(_url(family))
    rows = db.scalars(select(AuditLog).where(AuditLog.actor_id == family.teacher.id)).all()
    assert [(r.action, r.resource) for r in rows] == [("read", "logs")]


def test_filters_and_pages(family: Family, client_for: ClientFor) -> None:
    parent = client_for(family.parent.email or "")
    teacher = client_for(family.teacher.email or "")
    sleep = _post(parent, family, domains=["sleep"]).json()["id"]
    social = _post(parent, family, domains=["social"], type="milestone").json()["id"]
    school = _post(teacher, family, domains=["social", "learning"], type="school_day").json()["id"]

    assert _listed_ids(parent, family, domain="social") == {social, school}
    assert _listed_ids(parent, family, author_role="teacher") == {school}
    assert _listed_ids(parent, family, type="milestone") == {social}
    first = parent.get(_url(family), params={"limit": 2}).json()
    assert len(first["items"]) == 2 and first["next_offset"] == 2
    rest = parent.get(_url(family), params={"limit": 2, "offset": 2}).json()
    assert [i["id"] for i in rest["items"]] == [sleep] and rest["next_offset"] is None


# Edit window -----------------------------------------------------------------------------------


def _edit(client: TestClient, log_id: int, **body: Any) -> Any:
    body.setdefault("type", "observation")
    body.setdefault("visibility", "care_team")
    body.setdefault("text", "Said 'pani' three times")
    body.setdefault("occurred_at", utcnow().isoformat())
    return client.patch(f"/api/v1/logs/{log_id}", json=body)


def test_author_edits_within_24h(family: Family, client_for: ClientFor, db: Session) -> None:
    parent = client_for(family.parent.email or "")
    log_id = _post(parent, family).json()["id"]
    _age(db, log_id, 23)
    response = _edit(parent, log_id, domains=["communication"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version"] == 2 and body["edited_at"] is not None
    assert body["text"] == "Said 'pani' three times"
    versions = db.scalars(select(LogVersion).where(LogVersion.log_id == log_id)).all()
    assert [(v.version, v.snapshot_json["text"]) for v in versions] == [
        (1, "Said 'pani' twice today")
    ]


def test_edit_window_closes_after_24h(family: Family, client_for: ClientFor, db: Session) -> None:
    parent = client_for(family.parent.email or "")
    log_id = _post(parent, family).json()["id"]
    _age(db, log_id, 24.1)
    response = _edit(parent, log_id)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "log_edit_window_closed"
    listed = parent.get(_url(family)).json()["items"][0]
    assert listed["can_edit"] is False and listed["can_correct"] is True


def test_only_the_author_edits(family: Family, client_for: ClientFor) -> None:
    log_id = _post(client_for(family.teacher.email or ""), family).json()["id"]
    parent = client_for(family.parent.email or "")
    assert _edit(parent, log_id).status_code == 403
    item = parent.get(_url(family)).json()["items"][0]
    assert item["can_edit"] is False and item["can_correct"] is False


def test_edit_keeps_visibility_rules(family: Family, client_for: ClientFor) -> None:
    teacher = client_for(family.teacher.email or "")
    log_id = _post(teacher, family).json()["id"]
    response = _edit(teacher, log_id, visibility="clinical")
    assert response.json()["error"]["code"] == "log_visibility_not_allowed"


# Corrections -----------------------------------------------------------------------------------


def test_correction_chain(family: Family, client_for: ClientFor, db: Session) -> None:
    specialist = client_for(family.specialist.email or "")
    first = _post(specialist, family, type="clinical_note", text="Melatonin 1 ml").json()["id"]

    # Still editable: edit, don't correct.
    response = _post(specialist, family, corrects_log_id=first, text="Melatonin 0.5 ml")
    assert response.json()["error"]["code"] == "log_still_editable"

    _age(db, first, 30)
    # The correction takes the original's visibility, whatever was asked for.
    response = _post(
        specialist, family, corrects_log_id=first, text="Melatonin 0.5 ml", visibility="care_team"
    )
    assert response.status_code == 201, response.text
    second = response.json()
    assert second["corrects_log_id"] == first and second["visibility"] == "clinical"

    response = _post(specialist, family, corrects_log_id=first, text="again")
    assert response.json()["error"]["code"] == "log_already_corrected"

    # The chain continues from the latest entry once its own window has closed.
    _age(db, second["id"], 30)
    third = _post(specialist, family, corrects_log_id=second["id"], text="Melatonin 1 ml").json()
    items = {i["id"]: i for i in specialist.get(_url(family)).json()["items"]}
    assert items[first]["corrected_by_log_id"] == second["id"]
    assert items[second["id"]]["corrected_by_log_id"] == third["id"]
    assert items[third["id"]]["corrected_by_log_id"] is None
    assert items[first]["can_correct"] is False and items[third["id"]]["can_edit"] is True


def test_only_the_author_corrects(family: Family, client_for: ClientFor, db: Session) -> None:
    log_id = _post(client_for(family.teacher.email or ""), family).json()["id"]
    _age(db, log_id, 30)
    response = _post(client_for(family.parent.email or ""), family, corrects_log_id=log_id)
    assert response.status_code == 403


def test_cannot_correct_what_you_cannot_see(
    family: Family, client_for: ClientFor, db: Session
) -> None:
    log_id = _post(client_for(family.specialist.email or ""), family, type="clinical_note").json()
    _age(db, log_id["id"], 30)
    teacher = client_for(family.teacher.email or "")
    assert _post(teacher, family, corrects_log_id=log_id["id"]).status_code == 404


# Notifications ---------------------------------------------------------------------------------


def _parent_notifications(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/v1/notifications")
    assert response.status_code == 200
    return response.json()


def test_professional_entries_notify_the_parent(
    family: Family, client_for: ClientFor, db: Session
) -> None:
    parent = client_for(family.parent.email or "")
    _post(parent, family)
    log_id = _post(client_for(family.teacher.email or ""), family).json()["id"]
    listed = _parent_notifications(parent)
    assert listed["unread"] == 1
    [item] = listed["items"]
    assert item["kind"] == "log_added"
    assert item["payload"]["author_name"] == "Nasrin"
    assert item["payload"]["author_role"] == "teacher"
    assert item["payload"]["log_id"] == log_id
    # Members get no notification, only the card badge.
    assert (
        db.scalars(select(Notification).where(Notification.user_id != family.parent.id)).all() == []
    )


def test_more_than_three_a_day_become_a_digest(family: Family, client_for: ClientFor) -> None:
    teacher = client_for(family.teacher.email or "")
    specialist = client_for(family.specialist.email or "")
    parent = client_for(family.parent.email or "")
    for client in (teacher, teacher, specialist):
        _post(client, family)
    assert [i["kind"] for i in _parent_notifications(parent)["items"]] == ["log_added"] * 3

    _post(teacher, family)
    listed = _parent_notifications(parent)
    assert listed["unread"] == 1
    [digest] = listed["items"]
    assert digest["kind"] == "log_digest"
    assert digest["payload"]["count"] == 4 and digest["payload"]["child_name"] == "Rafi"

    assert parent.post(f"/api/v1/notifications/{digest['id']}/read").status_code == 200
    assert _parent_notifications(parent)["unread"] == 0


def test_digest_is_per_day(family: Family, client_for: ClientFor, db: Session) -> None:
    teacher = client_for(family.teacher.email or "")
    for _ in range(4):
        _post(teacher, family)
    # Yesterday's entries (Bangladesh time) stay separate.
    for n in db.scalars(select(Notification)).all()[:2]:
        n.created_at = utcnow() - timedelta(days=1)
    db.commit()
    kinds = [
        i["kind"] for i in _parent_notifications(client_for(family.parent.email or ""))["items"]
    ]
    assert kinds == ["log_added"] * 4


def test_members_see_how_many_entries_are_new(family: Family, client_for: ClientFor) -> None:
    teacher = client_for(family.teacher.email or "")
    parent = client_for(family.parent.email or "")
    specialist = client_for(family.specialist.email or "")
    _post(parent, family)
    _post(specialist, family)
    _post(specialist, family, type="clinical_note")  # not visible to the teacher
    _post(teacher, family)  # their own

    def badge() -> int:
        [card] = teacher.get("/api/v1/children").json()
        return card["new_logs"]

    assert badge() == 2
    teacher.get(_url(family))
    assert badge() == 0
    _post(parent, family)
    assert badge() == 1


# Explain this to me ----------------------------------------------------------------------------


def test_explain_a_teachers_entry(
    family: Family, client_for: ClientFor, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, str] = {}

    def fake_structured(prompt: llm.Prompt, user_input: str, output: Any, **_: Any) -> Any:
        seen["instructions"], seen["input"] = prompt.text, user_input
        return output(
            summary=" He took turns. ", at_home="Try 'first … then'.", ask_next=["Q?", " "]
        )

    monkeypatch.setattr(llm, "structured", fake_structured)
    teacher = client_for(family.teacher.email or "")
    log_id = _post(teacher, family, text="Turn-taking ~3 min with first-then board").json()["id"]
    parent = client_for(family.parent.email or "")

    response = parent.post(f"/api/v1/logs/{log_id}/explain", json={"locale": "bn"})
    assert response.status_code == 200, response.text
    assert LogExplanation.model_validate(response.json()) == LogExplanation(
        summary="He took turns.", at_home="Try 'first … then'.", ask_next=["Q?"]
    )
    assert "first-then board" in seen["input"] and "Answer in: Bangla" in seen["input"]
    assert "Rafi" not in seen["input"] and "Nasrin" not in seen["input"]
    assert "999" in seen["instructions"]  # the safety rules are appended

    # Nothing was saved; the parent can keep it as a private note linked to the entry.
    assert len(parent.get(_url(family)).json()["items"]) == 1
    response = _post(parent, family, text="He took turns.", explains_log_id=log_id)
    assert response.status_code == 201
    assert response.json()["visibility"] == "private"
    assert response.json()["explains_log_id"] == log_id


def test_explain_rules(
    family: Family, client_for: ClientFor, monkeypatch: pytest.MonkeyPatch
) -> None:
    parent = client_for(family.parent.email or "")
    teacher = client_for(family.teacher.email or "")
    own = _post(parent, family).json()["id"]
    theirs = _post(teacher, family).json()["id"]
    assert parent.post(f"/api/v1/logs/{own}/explain", json={"locale": "en"}).status_code == 409
    assert teacher.post(f"/api/v1/logs/{theirs}/explain", json={"locale": "en"}).status_code == 403
    assert _post(teacher, family, explains_log_id=theirs).status_code == 422

    # No API key in tests: a clear "AI not configured".
    response = parent.post(f"/api/v1/logs/{theirs}/explain", json={"locale": "en"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_not_configured"

    def failing(*_: Any, **__: Any) -> Any:
        raise llm.LLMQuotaExceededError

    monkeypatch.setattr(llm, "structured", failing)
    response = parent.post(f"/api/v1/logs/{theirs}/explain", json={"locale": "en"})
    assert response.status_code == 429
