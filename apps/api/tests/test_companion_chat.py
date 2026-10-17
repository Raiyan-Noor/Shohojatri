"""Companion chat, first version (COMPANION_SPEC §13): the scope-filtered child snapshot, the SSE
stream, citations, the urgent flag, conversations and suggestions. The LLM is mocked."""

from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.ai import companion_chat, llm
from app.ai.snapshot import build_child_snapshot
from app.core.permissions import resolve_access
from app.models import (
    AccessGrant,
    Characteristics,
    ChatMessage,
    Child,
    Conversation,
    Goal,
    GrantScope,
    Log,
    LogType,
    LogVisibility,
    Role,
    User,
)
from app.models.base import utcnow
from tests.conftest import MakeChild, MakeUser
from tests.test_results_chat import FakeLLM, events
from tests.test_screenings import dob_months_ago

ClientFor = Callable[[str], TestClient]
API = "/api/v1"

CARE_TEAM = "CARE-TEAM-1a2b: stacked 5 blocks"
CLINICAL = "CLINICAL-3c4d: sleep onset 23:30"
PARENT_PRIVATE = "PARENT-PRIVATE-5e6f: I am exhausted"
TEACHER_PRIVATE = "TEACHER-PRIVATE-7a8b: try the red cards"
DOCTOR_PRIVATE = "DOCTOR-PRIVATE-9c0d: consider a referral"
MEDICINE = "MEDICINE-1f2e: Syrup X 1 ml at night"
OLD_ENTRY = "OLD-ENTRY-3a4b: from last year"


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch) -> FakeLLM:
    fake = FakeLLM(reply=("রাফি এখন ", "বেশি শব্দ বলছে।"))
    monkeypatch.setattr(llm, "stream_text", fake)
    return fake


@pytest.fixture
def parent(make_user: MakeUser) -> User:
    return make_user(Role.parent, name="Farhana")


@pytest.fixture
def teacher(make_user: MakeUser) -> User:
    return make_user(Role.teacher, name="Nasrin")


@pytest.fixture
def doctor(make_user: MakeUser) -> User:
    return make_user(Role.specialist, name="Dr. Tanvir")


@pytest.fixture
def child(parent: User, teacher: User, doctor: User, make_child: MakeChild, db: Session) -> Child:
    child = make_child(parent, name="Rafi", dob=dob_months_ago(38))
    db.add_all(
        [
            AccessGrant(child_id=child.id, user_id=teacher.id, scope=GrantScope.education),
            AccessGrant(child_id=child.id, user_id=doctor.id, scope=GrantScope.clinical),
            Goal(
                child_id=child.id,
                title="Say 'more' to ask",
                domain="communication",
                set_by_role=Role.teacher,
                created_by=teacher.id,
            ),
            Characteristics(
                child_id=child.id,
                version=1,
                answers_json={
                    "questionnaire_version": "characteristics-1",
                    "sections": {
                        "health": {"other_conditions": "sleep problems", "medications": MEDICINE},
                        "strengths": {"strengths_text": "counts to 20"},
                    },
                },
                created_by=parent.id,
            ),
        ]
    )
    db.commit()
    entries = [
        (teacher, CARE_TEAM, LogVisibility.care_team, 1),
        (doctor, CLINICAL, LogVisibility.clinical, 2),
        (parent, PARENT_PRIVATE, LogVisibility.private, 3),
        (teacher, TEACHER_PRIVATE, LogVisibility.private, 4),
        (doctor, DOCTOR_PRIVATE, LogVisibility.private, 5),
        (parent, OLD_ENTRY, LogVisibility.care_team, 200),
    ]
    for author, text, visibility, days_ago in entries:
        add_log(db, child, author, text, visibility, days_ago)
    return child


def add_log(
    db: Session,
    child: Child,
    author: User,
    text: str,
    visibility: LogVisibility = LogVisibility.care_team,
    days_ago: int = 1,
) -> Log:
    at = utcnow() - timedelta(days=days_ago)
    log = Log(
        child_id=child.id,
        author_id=author.id,
        author_role=author.role,
        type=LogType.observation,
        occurred_at=at,
        domains=["communication"],
        ratings_json={"communication": 4},
        text=text,
        visibility=visibility,
        created_at=at,
    )
    db.add(log)
    db.commit()
    return log


def snapshot_for(db: Session, user: User, child: Child) -> str:
    access = resolve_access(db, user, child.id)
    assert access is not None
    return build_child_snapshot(db, access)[0]


def ask(client: TestClient, child_id: int, message: str, **extra: Any) -> Any:
    body = {"message": message, "locale": "bn", **extra}
    return client.post(f"{API}/children/{child_id}/chat", json=body)


def log_id(db: Session, text: str) -> int:
    log = db.query(Log).filter(Log.text == text).one()
    return log.id


# --- the snapshot -----------------------------------------------------------------------------


def test_the_parent_snapshot_holds_everything(
    db: Session, parent: User, child: Child, teacher: User
) -> None:
    text = snapshot_for(db, parent, child)
    for expected in (
        CARE_TEAM,
        CLINICAL,
        PARENT_PRIVATE,
        TEACHER_PRIVATE,
        DOCTOR_PRIVATE,
        MEDICINE,
        "Say 'more' to ask",
        "counts to 20",
        "Age: 38 months",
        "Nasrin (teacher)",
    ):
        assert expected in text, expected
    line = next(x for x in text.splitlines() if CARE_TEAM in x)
    assert line.startswith(f"[L{log_id(db, CARE_TEAM)}] ")
    assert " · teacher Nasrin · observation · communication · rating 4/5 · " in line


def test_a_teachers_snapshot_leaves_out_clinical_private_and_unshared_data(
    db: Session, teacher: User, child: Child
) -> None:
    text = snapshot_for(db, teacher, child)
    assert CARE_TEAM in text
    assert TEACHER_PRIVATE in text  # their own private note
    for hidden in (CLINICAL, PARENT_PRIVATE, DOCTOR_PRIVATE, MEDICINE):
        assert hidden not in text, hidden
    assert "Medicines: not shared with you" in text


def test_a_teacher_sees_medicines_once_the_parent_shares_them(
    db: Session, teacher: User, child: Child
) -> None:
    grant = db.query(AccessGrant).filter(AccessGrant.user_id == teacher.id).one()
    grant.share_medications = True
    db.commit()
    text = snapshot_for(db, teacher, child)
    assert MEDICINE in text
    assert "not shared with you" not in text


def test_a_specialists_snapshot_has_clinical_entries_but_not_others_private_ones(
    db: Session, doctor: User, child: Child
) -> None:
    text = snapshot_for(db, doctor, child)
    for shown in (CARE_TEAM, CLINICAL, DOCTOR_PRIVATE, MEDICINE):
        assert shown in text, shown
    for hidden in (PARENT_PRIVATE, TEACHER_PRIVATE):
        assert hidden not in text, hidden


def test_entries_older_than_90_days_become_one_count_line(
    db: Session, parent: User, child: Child
) -> None:
    text = snapshot_for(db, parent, child)
    assert OLD_ENTRY not in text
    assert "Older entries not shown: 1 (communication 1)." in text


def test_the_entries_budget_keeps_the_newest(
    db: Session, parent: User, child: Child, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.ai.snapshot.LOG_TOKEN_BUDGET", 60)
    text = snapshot_for(db, parent, child)
    assert CARE_TEAM in text  # the newest
    assert DOCTOR_PRIVATE not in text
    assert "Older entries not shown: 5" in text


def test_a_correction_replaces_the_entry_it_corrects(
    db: Session, parent: User, teacher: User, child: Child
) -> None:
    original = db.get(Log, log_id(db, CARE_TEAM))
    assert original is not None
    fix = add_log(db, child, teacher, "CORRECTED: stacked 3 blocks")
    fix.corrects_log_id = original.id
    db.commit()
    text = snapshot_for(db, parent, child)
    assert CARE_TEAM not in text
    assert f"corrects L{original.id}" in text


# --- access -----------------------------------------------------------------------------------


def test_someone_outside_the_care_team_cannot_chat_or_read(
    fake_llm: FakeLLM, child: Child, make_user: MakeUser, client_for: ClientFor
) -> None:
    make_user(Role.parent, email="stranger@test.bd")
    stranger = client_for("stranger@test.bd")
    # 404, not 403: ids don't reveal which children exist (COMPANION_SPEC §3.2).
    assert ask(stranger, child.id, "Hi").status_code == 404
    assert stranger.get(f"{API}/children/{child.id}/conversations").status_code == 404
    assert stranger.get(f"{API}/children/{child.id}/chat/suggestions").status_code == 404
    assert fake_llm.calls == []


def test_signed_out_users_get_401(client: TestClient, child: Child) -> None:
    assert ask(client, child.id, "Hi").status_code == 401


def test_a_revoked_teacher_loses_the_chat_and_their_old_conversations(
    fake_llm: FakeLLM, teacher: User, child: Child, client_for: ClientFor, db: Session
) -> None:
    as_teacher = client_for("teacher@test.bd")
    meta = events(ask(as_teacher, child.id, "How was class?"))[0][1]
    grant = db.query(AccessGrant).filter(AccessGrant.user_id == teacher.id).one()
    grant.revoked_at = utcnow()
    db.commit()
    assert ask(as_teacher, child.id, "Hi").status_code == 404
    url = f"{API}/conversations/{meta['conversation_id']}/messages"
    assert as_teacher.get(url).status_code == 404


def test_nobody_reads_or_continues_another_users_conversation(
    fake_llm: FakeLLM, parent: User, child: Child, client_for: ClientFor
) -> None:
    conversation_id = events(ask(client_for("parent@test.bd"), child.id, "Hi"))[0][1][
        "conversation_id"
    ]
    as_teacher = client_for("teacher@test.bd")
    assert as_teacher.get(f"{API}/conversations/{conversation_id}/messages").status_code == 404
    response = ask(as_teacher, child.id, "Hi", conversation_id=conversation_id)
    assert response.status_code == 404
    assert as_teacher.get(f"{API}/children/{child.id}/conversations").json() == []


# --- the stream -------------------------------------------------------------------------------


def test_the_reply_streams_meta_then_deltas_then_done(
    fake_llm: FakeLLM, child: Child, client_for: ClientFor, db: Session
) -> None:
    care, clinical = log_id(db, CARE_TEAM), log_id(db, CLINICAL)
    fake_llm.reply = (f"In class he stacked blocks [L{care}]", f" and slept late [L{clinical}].")
    parsed = events(ask(client_for("parent@test.bd"), child.id, "কেমন চলছে?"))

    names = [name for name, _ in parsed]
    assert names == ["meta", "delta", "delta", "done"]
    meta, done = parsed[0][1], parsed[-1][1]
    assert meta == {"conversation_id": meta["conversation_id"], "urgent": False}
    assert [d["text"] for _, d in parsed[1:-1]] == list(fake_llm.reply)
    assert [s["log_id"] for s in done["sources"]] == [care, clinical]
    assert done["sources"][0]["author_role"] == "teacher"
    assert done["sources"][0]["author_name"] == "Nasrin"
    assert done["sources"][0]["snippet"] == CARE_TEAM
    assert done["urgent"] is False

    saved = db.get(ChatMessage, done["message_id"])
    assert saved is not None and saved.meta_json is not None
    assert saved.meta_json["cited"] == [care, clinical]
    assert saved.meta_json["prompt"] == "companion_system-1+safety-1"


def test_citations_of_entries_the_viewer_cannot_see_are_dropped(
    fake_llm: FakeLLM, child: Child, client_for: ClientFor, db: Session
) -> None:
    clinical = log_id(db, CLINICAL)
    fake_llm.reply = (f"Something [L{clinical}] and [L99999].",)
    done = events(ask(client_for("teacher@test.bd"), child.id, "Any doctor notes?"))[-1][1]
    assert done["sources"] == []


def test_the_prompt_has_the_snapshot_the_safety_rules_and_the_locale(
    fake_llm: FakeLLM, child: Child, client_for: ClientFor
) -> None:
    events(ask(client_for("teacher@test.bd"), child.id, "What works in class?", locale="en"))
    (call,) = fake_llm.calls
    prompt, context = call["prompt"], call["context"]
    assert "family and care team of Rafi" in prompt.text
    assert prompt.text.endswith(llm.load_prompt("safety").text)
    assert context.startswith("Reply language: English\nStyle: Write for a teacher")
    assert CARE_TEAM in context and CLINICAL not in context
    assert [t.content for t in call["turns"]] == ["What works in class?"]


def test_a_conversation_continues_with_the_last_12_messages(
    fake_llm: FakeLLM, parent: User, child: Child, client_for: ClientFor, db: Session
) -> None:
    as_parent = client_for("parent@test.bd")
    conversation_id = events(ask(as_parent, child.id, "Q0"))[0][1]["conversation_id"]
    for n in range(1, 8):
        events(ask(as_parent, child.id, f"Q{n}", conversation_id=conversation_id))
    turns = fake_llm.calls[-1]["turns"]
    assert len(turns) == companion_chat.HISTORY_MESSAGES + 1
    assert turns[0].content == "Q1" and turns[-1].content == "Q7"

    listed = as_parent.get(f"{API}/children/{child.id}/conversations").json()
    assert [(c["id"], c["title"]) for c in listed] == [(conversation_id, "Q0")]
    assert listed[0]["preview"] == "রাফি এখন বেশি শব্দ বলছে।"

    messages = as_parent.get(f"{API}/conversations/{conversation_id}/messages").json()
    assert len(messages) == 16
    assert [m["role"] for m in messages[:2]] == ["user", "assistant"]


def test_previews_drop_citations_and_markdown(
    fake_llm: FakeLLM, child: Child, client_for: ClientFor
) -> None:
    fake_llm.reply = ("### Summary\n**More words** this week [L1].\n- turn-taking",)
    as_parent = client_for("parent@test.bd")
    events(ask(as_parent, child.id, "How is he?"))
    (listed,) = as_parent.get(f"{API}/children/{child.id}/conversations").json()
    assert listed["preview"] == "Summary More words this week. turn-taking"


def test_saved_sources_follow_the_entries_current_visibility(
    fake_llm: FakeLLM, parent: User, child: Child, client_for: ClientFor, db: Session
) -> None:
    care = add_log(db, child, parent, "Played with blocks at home").id
    fake_llm.reply = (f"Blocks [L{care}].",)
    as_teacher = client_for("teacher@test.bd")
    meta = events(ask(as_teacher, child.id, "Blocks?"))[0][1]
    url = f"{API}/conversations/{meta['conversation_id']}/messages"
    assert [s["log_id"] for s in as_teacher.get(url).json()[1]["sources"]] == [care]

    # The parent makes it private: the chip goes, the saved text stays.
    log = db.get(Log, care)
    assert log is not None
    log.visibility = LogVisibility.private
    db.commit()
    reply = as_teacher.get(url).json()[1]
    assert reply["sources"] == [] and reply["content"] == f"Blocks [L{care}]."


def test_a_broken_stream_saves_nothing(
    fake_llm: FakeLLM, child: Child, client_for: ClientFor, db: Session
) -> None:
    fake_llm.fail_midway = True
    parsed = events(ask(client_for("parent@test.bd"), child.id, "Hi"))
    assert [name for name, _ in parsed][-1] == "error"
    assert db.query(ChatMessage).count() == 0
    # The empty conversation isn't listed.
    as_parent = client_for("parent@test.bd")
    assert db.query(Conversation).count() == 1
    assert as_parent.get(f"{API}/children/{child.id}/conversations").json() == []


def test_without_an_api_key_the_chat_says_ai_is_not_configured(
    child: Child, client_for: ClientFor
) -> None:
    as_parent = client_for("parent@test.bd")
    response = ask(as_parent, child.id, "Hi")
    assert response.status_code == 503
    assert response.json()["error"]["message_key"] == "errors.ai_not_configured"
    suggestions = as_parent.get(f"{API}/children/{child.id}/chat/suggestions").json()
    assert suggestions["ai_available"] is False


# --- urgent -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "He had a seizure 10 minutes ago",
        "She is not breathing properly",
        "He keeps hurting himself, biting his hand",
        "Suddenly lost his words this week",
        "রাফির খিঁচুনি হচ্ছে",
        "মাথায় আঘাত পেয়েছে",
        "নিজেকে আঘাত করছে",
        "শ্বাস নিতে পারছে না",
        "হঠাৎ করে সব শব্দ ভুলে যাচ্ছে",
        "সকাল থেকে পানি খাচ্ছে না",
    ],
)
def test_urgent_phrases_are_flagged(message: str) -> None:
    assert companion_chat.is_urgent(message)


@pytest.mark.parametrize(
    "message",
    [
        "What can I play with Rafi today?",
        "How is his talking this week?",
        "আজ রাফির সাথে কী খেলতে পারি?",
        "ঘুমের সমস্যার জন্য কী করতে পারি?",
        "এই বিষয়ে কী করব?",
    ],
)
def test_everyday_questions_are_not_urgent(message: str) -> None:
    assert not companion_chat.is_urgent(message)


def test_urgent_is_sent_in_meta_and_done(
    fake_llm: FakeLLM, child: Child, client_for: ClientFor
) -> None:
    parsed = events(ask(client_for("parent@test.bd"), child.id, "রাফির খিঁচুনি হচ্ছে"))
    assert parsed[0][1]["urgent"] is True and parsed[-1][1]["urgent"] is True


def test_a_reply_that_says_999_is_urgent(
    fake_llm: FakeLLM, child: Child, client_for: ClientFor, db: Session
) -> None:
    fake_llm.reply = ("এখনই ৯৯৯-এ কল করুন।",)
    parsed = events(ask(client_for("parent@test.bd"), child.id, "ও খুব ঘুম ঘুম করছে"))
    assert parsed[0][1]["urgent"] is False and parsed[-1][1]["urgent"] is True
    conversation_id = parsed[0][1]["conversation_id"]
    url = f"{API}/conversations/{conversation_id}/messages"
    assert client_for("parent@test.bd").get(url).json()[1]["urgent"] is True


# --- suggestions ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("email", "first"),
    [
        ("parent@test.bd", "play_today"),
        ("teacher@test.bd", "class_strategies"),
        ("specialist@test.bd", "month_summary"),
    ],
)
def test_suggestions_by_role_name_the_child_and_goals(
    child: Child, client_for: ClientFor, email: str, first: str
) -> None:
    out = client_for(email).get(f"{API}/children/{child.id}/chat/suggestions").json()
    keys = [s["key"] for s in out["suggestions"]]
    assert keys[0] == first and keys[1] == "goal_progress" and keys[-1] == "status_report"
    assert 4 <= len(keys) <= 6
    assert out["suggestions"][1]["params"] == {"name": "Rafi", "goal": "Say 'more' to ask"}
    assert all(s["params"]["name"] == "Rafi" for s in out["suggestions"])
