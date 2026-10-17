from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.dates import age_in_months, today_bd
from app.models import Child, User
from app.seed.children import RAFI_CODE, seed_children
from app.seed.users import DEMO_PASSWORD, seed_users

DEMO_LOGINS = {
    "admin@demo.bd": "admin",
    "parent@demo.bd": "parent",
    "teacher@demo.bd": "teacher",
    "teacher2@demo.bd": "teacher",
    "doctor@demo.bd": "specialist",
}


def test_seed_is_idempotent(db: Session) -> None:
    assert seed_users(db) == 5
    assert seed_users(db) == 0
    assert db.scalar(select(func.count()).select_from(User)) == 5


def test_every_demo_account_logs_in_with_demo_password(db: Session, client: TestClient) -> None:
    seed_users(db)
    for email, role in DEMO_LOGINS.items():
        response = client.post(
            "/api/v1/auth/login", json={"identifier": email, "password": DEMO_PASSWORD}
        )
        assert response.status_code == 200, email
        user = response.json()
        assert user["role"] == role
        # The demo goes straight in; the forced change is shown with a newly created specialist.
        assert user["must_change_password"] is False


def test_demo_specialist_is_verified_and_teachers_have_schools(db: Session) -> None:
    seed_users(db)
    doctor = db.scalar(select(User).where(User.email == "doctor@demo.bd"))
    assert doctor is not None and doctor.verified and doctor.registration_no
    for email in ("teacher@demo.bd", "teacher2@demo.bd"):
        teacher = db.scalar(select(User).where(User.email == email))
        assert teacher is not None and teacher.organisation


def test_demo_children_and_rafis_care_team(db: Session, client: TestClient) -> None:
    seed_users(db)
    assert seed_children(db) == 2
    assert seed_children(db) == 0

    rafi = db.scalar(select(Child).where(Child.code == RAFI_CODE))
    assert rafi is not None and rafi.name == "Rafi"
    assert age_in_months(rafi.dob, today_bd()) == 38

    def login_as(email: str) -> None:
        client.post("/api/v1/auth/login", json={"identifier": email, "password": DEMO_PASSWORD})

    login_as("parent@demo.bd")
    cards = {c["name"]: c for c in client.get("/api/v1/children").json()}
    assert set(cards) == {"Rafi", "Nuha"}
    assert cards["Rafi"]["pending_requests"] == 1
    [pending] = client.get(f"/api/v1/children/{rafi.id}/access-requests").json()
    assert pending["requester"]["name"] == "Rumana Islam"  # teacher2
    members = client.get(f"/api/v1/children/{rafi.id}/grants").json()
    assert {(m["member"]["role"], m["scope"]) for m in members} == {
        ("teacher", "education"),
        ("specialist", "clinical"),
    }
    assert client.get("/api/v1/notifications").json()["unread"] == 1

    for email in ("teacher@demo.bd", "doctor@demo.bd"):
        login_as(email)
        assert [c["name"] for c in client.get("/api/v1/children").json()] == ["Rafi"]
    login_as("teacher2@demo.bd")
    assert client.get("/api/v1/children").json() == []
    assert [r["status"] for r in client.get("/api/v1/access-requests").json()] == ["pending"]


def test_rafis_companion_record(db: Session, client: TestClient) -> None:
    from app.core.characteristics import load_characteristics, validate_section
    from app.seed.companion import CHARACTERISTICS, seed_companion

    seed_users(db)
    seed_children(db)
    created = seed_companion(db)
    assert created > 30
    assert seed_companion(db) == 0

    # The demo answers pass the same validation a parent's would, unchanged.
    for section in load_characteristics().sections:
        assert validate_section(section, CHARACTERISTICS[section.id]) == CHARACTERISTICS[section.id]

    def login_as(email: str) -> None:
        client.post("/api/v1/auth/login", json={"identifier": email, "password": DEMO_PASSWORD})

    login_as("parent@demo.bd")
    [rafi] = [c for c in client.get("/api/v1/children").json() if c["name"] == "Rafi"]
    assert rafi["diagnosis"]["kind"] == "autism"
    assert rafi["characteristics_done"] == rafi["characteristics_total"] == 10
    parent_view = client.get(f"/api/v1/children/{rafi['id']}/logs", params={"limit": 50}).json()
    assert len(parent_view["items"]) == created
    # The two newest professional entries, plus teacher2's pending join request.
    assert client.get("/api/v1/notifications").json()["unread"] == 3
    assert len(client.get(f"/api/v1/children/{rafi['id']}/goals").json()) == 3

    login_as("teacher@demo.bd")
    [card] = client.get("/api/v1/children").json()
    assert card["new_logs"] > 0
    teacher_view = client.get(f"/api/v1/children/{rafi['id']}/logs", params={"limit": 50}).json()
    # The doctor's clinical notes stay out of the teacher's timeline.
    assert 0 < len(teacher_view["items"]) < created
    assert all(item["visibility"] == "care_team" for item in teacher_view["items"])
