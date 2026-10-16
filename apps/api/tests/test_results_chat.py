""" "Ask about my results" (SCREENING_SPEC §8): only this screening reaches the prompt, replies
stream as SSE and are kept per parent per screening. The LLM is mocked."""

import json
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai import llm
from app.models import (
    ChatMessage,
    ChatRole,
    Child,
    Conversation,
    ConversationMode,
    GrantScope,
    Role,
    Screening,
    User,
)
from tests.conftest import MakeChild, MakeUser
from tests.test_screening_results import finalize, grant, part_one, replay
from tests.test_screenings import SCREENINGS, dob_months_ago, start

ClientFor = Callable[[str], TestClient]

OWN_NOTE = "OWN-NOTE-7f3a: sleeps badly"
OTHER_NOTE = "OTHER-NOTE-91c2: lines up cars"
OTHER_CHAT = "OTHER-CHAT-55e0"
OLDER_CHAT = "OLDER-CHAT-2b8d"


@dataclass
class FakeLLM:
    """Stands in for llm.stream_text and records what it was asked."""

    reply: Sequence[str] = ("৫২ মানে ", "কিছু প্রাথমিক লক্ষণ।")
    fail_midway: bool = False
    calls: list[dict[str, Any]] = field(default_factory=list)

    def __call__(
        self, prompt: llm.Prompt, context: str, turns: Sequence[llm.Turn], **_: Any
    ) -> Iterator[str]:
        self.calls.append({"prompt": prompt, "context": context, "turns": list(turns)})
        return self._deltas()

    def _deltas(self) -> Iterator[str]:
        yield from self.reply
        if self.fail_midway:
            raise llm.LLMError("stream broke")


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch) -> FakeLLM:
    fake = FakeLLM()
    monkeypatch.setattr(llm, "stream_text", fake)
    return fake


@pytest.fixture
def parent(make_user: MakeUser) -> User:
    return make_user(Role.parent)


@pytest.fixture
def child(parent: User, make_child: MakeChild) -> Child:
    return make_child(parent, name="Rafi", dob=dob_months_ago(36))


@pytest.fixture
def as_parent(parent: User, client_for: ClientFor) -> TestClient:
    return client_for("parent@test.bd")


def finalized_screening(client: TestClient, child_id: int, db: Session, note: str) -> int:
    screening_id = part_one(client, child_id)["id"]
    replay(client, screening_id, "rtn", "elevated")
    finalize(client, screening_id)
    screening = db.get(Screening, screening_id)
    assert screening is not None
    screening.parent_note = note
    db.commit()
    return int(screening_id)


@pytest.fixture
def screening_id(as_parent: TestClient, child: Child, db: Session) -> int:
    return finalized_screening(as_parent, child.id, db, OWN_NOTE)


def chat_url(screening_id: int) -> str:
    return f"{SCREENINGS}/{screening_id}/chat"


def ask(client: TestClient, screening_id: int, message: str, locale: str = "bn") -> Any:
    return client.post(chat_url(screening_id), json={"message": message, "locale": locale})


def events(response: Any) -> list[tuple[str, dict[str, Any]]]:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    parsed = []
    for block in response.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        parsed.append((lines["event"], json.loads(lines["data"])))
    return parsed


def add_conversation(db: Session, screening: Screening, user_id: int, text: str) -> None:
    conversation = Conversation(
        child_id=screening.child_id,
        user_id=user_id,
        mode=ConversationMode.results,
        screening_id=screening.id,
    )
    conversation.messages.append(ChatMessage(role=ChatRole.user, content=text))
    db.add(conversation)
    db.commit()


# --- what reaches the prompt ------------------------------------------------------------------


def test_prompt_holds_only_this_screening(
    fake_llm: FakeLLM,
    as_parent: TestClient,
    parent: User,
    child: Child,
    db: Session,
    make_user: MakeUser,
    make_child: MakeChild,
    client_for: ClientFor,
) -> None:
    # The same child's earlier screening, with its own chat.
    older_id = finalized_screening(as_parent, child.id, db, "OLDER-NOTE-c4d1")
    older = db.get(Screening, older_id)
    assert older is not None
    add_conversation(db, older, parent.id, OLDER_CHAT)
    # Another family's child, screening and chat.
    other_parent = make_user(Role.parent, email="other@test.bd")
    other_child = make_child(other_parent, name="Mitu", dob=dob_months_ago(30))
    other_id = finalized_screening(client_for("other@test.bd"), other_child.id, db, OTHER_NOTE)
    other = db.get(Screening, other_id)
    assert other is not None
    add_conversation(db, other, other_parent.id, OTHER_CHAT)

    current = finalized_screening(as_parent, child.id, db, OWN_NOTE)
    events(ask(as_parent, current, "এই ফলাফলের মানে কী?"))

    (call,) = fake_llm.calls
    sent = call["context"] + call["prompt"].text + json.dumps([t.content for t in call["turns"]])
    assert OWN_NOTE in call["context"]
    for foreign in (OTHER_NOTE, OTHER_CHAT, OLDER_CHAT, "OLDER-NOTE-c4d1", "Mitu"):
        assert foreign not in sent
    # Not even this child's name: the reply says "your child".
    assert "Rafi" not in sent
    assert [t.content for t in call["turns"]] == ["এই ফলাফলের মানে কী?"]


def test_prompt_carries_the_result_answers_and_class_bands(
    fake_llm: FakeLLM, as_parent: TestClient, screening_id: int, db: Session
) -> None:
    events(ask(as_parent, screening_id, "What does this mean?", locale="en"))
    context = fake_llm.calls[0]["context"]
    assert context.startswith("Reply language: English")
    data = json.loads(context.split("```json\n", 1)[1].rsplit("\n```", 1)[0])

    screening = db.get(Screening, screening_id)
    assert screening is not None and screening.result_json is not None
    assert data["result"]["early_signs_score"] == screening.result_json["score"]
    assert data["result"]["class"] == screening.result_json["risk_class"]
    assert [band["class"] for band in data["class_bands"]] == [
        "low",
        "moderate",
        "elevated",
        "high",
    ]
    assert data["class_bands"][1]["score_from"] == 21
    assert {row["id"] for row in data["questionnaire"]} == {a.item_id for a in screening.answers}
    assert all(row["answer"] for row in data["questionnaire"])
    assert "rtn" in {game["game"] for game in data["games"]}


def test_prompt_ends_with_the_safety_rules(
    fake_llm: FakeLLM, as_parent: TestClient, screening_id: int
) -> None:
    events(ask(as_parent, screening_id, "Does my child have autism?"))
    prompt = fake_llm.calls[0]["prompt"]
    assert prompt.version == "results_explainer-1+safety-1"
    assert prompt.text.endswith(llm.load_prompt("safety").text)
    assert "999" in prompt.text


# --- streaming and history --------------------------------------------------------------------


def test_reply_streams_and_is_kept_with_the_question(
    fake_llm: FakeLLM, as_parent: TestClient, screening_id: int
) -> None:
    streamed = events(ask(as_parent, screening_id, "আমি এখন কী করব?"))
    assert streamed[:2] == [("delta", {"text": "৫২ মানে "}), ("delta", {"text": "কিছু প্রাথমিক লক্ষণ।"})]
    name, done = streamed[-1]
    assert name == "done"

    history = as_parent.get(chat_url(screening_id)).json()
    assert [(m["role"], m["content"]) for m in history["messages"]] == [
        ("user", "আমি এখন কী করব?"),
        ("assistant", "৫২ মানে কিছু প্রাথমিক লক্ষণ।"),
    ]
    assert history["messages"][1]["id"] == done["message_id"]

    # The next question carries the conversation so far.
    events(ask(as_parent, screening_id, "ডাক্তারকে কী জিজ্ঞেস করব?"))
    turns = fake_llm.calls[1]["turns"]
    assert [(t.role, t.content) for t in turns] == [
        ("user", "আমি এখন কী করব?"),
        ("assistant", "৫২ মানে কিছু প্রাথমিক লক্ষণ।"),
        ("user", "ডাক্তারকে কী জিজ্ঞেস করব?"),
    ]


def test_history_sent_to_the_model_is_capped(
    fake_llm: FakeLLM, as_parent: TestClient, screening_id: int
) -> None:
    for n in range(8):
        events(ask(as_parent, screening_id, f"question {n}"))
    turns = fake_llm.calls[-1]["turns"]
    assert len(turns) == 13  # the latest 12 messages + the new question
    assert turns[0].content == "question 1"


def test_a_broken_stream_sends_an_error_and_saves_nothing(
    fake_llm: FakeLLM, as_parent: TestClient, screening_id: int, db: Session
) -> None:
    fake_llm.fail_midway = True
    streamed = events(ask(as_parent, screening_id, "আমি এখন কী করব?"))
    assert streamed[-1] == ("error", {"message_key": "errors.ai_unavailable"})
    assert db.scalar(select(func.count()).select_from(ChatMessage)) == 0


def test_an_empty_reply_is_an_error(
    fake_llm: FakeLLM, as_parent: TestClient, screening_id: int
) -> None:
    fake_llm.reply = ("  ",)
    assert events(ask(as_parent, screening_id, "hi"))[-1][0] == "error"


# --- AI unavailable ---------------------------------------------------------------------------


def test_without_an_api_key_the_chat_says_ai_is_not_configured(
    as_parent: TestClient, screening_id: int
) -> None:
    assert as_parent.get(chat_url(screening_id)).json() == {"ai_available": False, "messages": []}
    response = ask(as_parent, screening_id, "আমি এখন কী করব?")
    assert response.status_code == 503
    assert response.json()["error"]["message_key"] == "errors.ai_not_configured"


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [(llm.LLMQuotaExceededError, 429, "ai_quota_exceeded"), (llm.LLMError, 502, "ai_unavailable")],
)
def test_errors_before_the_stream_are_plain_json(
    monkeypatch: pytest.MonkeyPatch,
    as_parent: TestClient,
    screening_id: int,
    error: type[Exception],
    status: int,
    code: str,
) -> None:
    def refuse(*_: Any, **__: Any) -> Iterator[str]:
        raise error

    monkeypatch.setattr(llm, "stream_text", refuse)
    response = ask(as_parent, screening_id, "hi")
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


# --- access -----------------------------------------------------------------------------------


def test_chat_needs_a_finalized_screening(
    fake_llm: FakeLLM, as_parent: TestClient, child: Child
) -> None:
    screening = start(as_parent, child.id)
    assert ask(as_parent, screening["id"], "hi").status_code == 409
    assert as_parent.get(chat_url(screening["id"])).status_code == 409


def test_only_the_parent_can_chat(
    fake_llm: FakeLLM,
    screening_id: int,
    child: Child,
    db: Session,
    make_user: MakeUser,
    client_for: ClientFor,
) -> None:
    doctor = make_user(Role.specialist, email="doc@test.bd")
    grant(db, child, doctor, GrantScope.clinical)
    make_user(Role.parent, email="stranger@test.bd")
    for email, status in (("doc@test.bd", 403), ("stranger@test.bd", 404)):
        client = client_for(email)
        assert ask(client, screening_id, "hi").status_code == status
        assert client.get(chat_url(screening_id)).status_code == status
    assert fake_llm.calls == []


def test_message_length_is_limited(
    fake_llm: FakeLLM, as_parent: TestClient, screening_id: int
) -> None:
    assert ask(as_parent, screening_id, "x" * 1001).status_code == 422
    assert ask(as_parent, screening_id, "   ").status_code == 422


def test_deleting_the_screening_deletes_its_chat(
    fake_llm: FakeLLM, as_parent: TestClient, child: Child, db: Session
) -> None:
    screening_id = part_one(as_parent, child.id)["id"]
    finalize(as_parent, screening_id)
    events(ask(as_parent, screening_id, "hi"))
    assert as_parent.delete(f"{SCREENINGS}/{screening_id}").status_code == 200
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Conversation)) == 0
    assert db.scalar(select(func.count()).select_from(ChatMessage)) == 0


# --- llm.stream_text --------------------------------------------------------------------------


class FakeStream:
    def __init__(self, events: list[SimpleNamespace]) -> None:
        self.events = events
        self.closed = False

    def __enter__(self) -> "FakeStream":
        return self

    def __exit__(self, *_: object) -> None:
        self.closed = True

    def __iter__(self) -> Iterator[SimpleNamespace]:
        return iter(self.events)


def test_deltas_yield_text_and_turn_failures_into_llm_errors() -> None:
    prompt = llm.Prompt(name="t", version="t-1", text="")
    ok = FakeStream(
        [
            SimpleNamespace(type="response.created"),
            SimpleNamespace(type="response.output_text.delta", delta="Hel"),
            SimpleNamespace(type="response.output_text.delta", delta="lo"),
            SimpleNamespace(type="response.completed"),
        ]
    )
    assert "".join(llm._deltas(ok, prompt)) == "Hello"  # type: ignore[arg-type]
    assert ok.closed

    failed = FakeStream(
        [
            SimpleNamespace(type="response.output_text.delta", delta="Hel"),
            SimpleNamespace(type="response.failed"),
        ]
    )
    with pytest.raises(llm.LLMError):
        list(llm._deltas(failed, prompt))  # type: ignore[arg-type]
