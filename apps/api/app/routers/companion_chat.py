"""The companion chat (COMPANION_SPEC §13): parent, teachers and specialists ask about a child,
each within their own scope. One history per user per child; a user may keep several
conversations.

The reply streams as server-sent events:

    event: meta    data: {"conversation_id": 7, "urgent": false}   (first; urgent = the question)
    event: delta   data: {"text": "..."}                           (many)
    event: done    data: {"message_id": 12, "sources": [...], "urgent": true}
    event: error   data: {"message_key": "errors.ai_unavailable"}

Problems found before the stream starts (AI not configured, daily cap, a failed request) are
ordinary JSON errors instead, as in the results chat.
"""

import json
import logging
import re
from collections.abc import Iterator, Sequence
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai import companion_chat, llm
from app.ai.snapshot import Source, build_child_snapshot, shorten, source_of
from app.core import logs as log_rules
from app.core.config import get_settings
from app.core.deps import CurrentUser, DbSession
from app.core.errors import ApiError
from app.core.permissions import ChildAccess, Holder, Need, authorize, require_child_access
from app.models import (
    ChatMessage,
    ChatRole,
    Conversation,
    ConversationMode,
    Goal,
    GoalStatus,
    Log,
    User,
)
from app.routers.results_chat import SSE_HEADERS
from app.schemas.companion_chat import (
    ChatSource,
    ChatSuggestion,
    ChatSuggestionsOut,
    CompanionChatRequest,
    CompanionMessageOut,
    ConversationSummary,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

ChatUser = Annotated[ChildAccess, Depends(require_child_access(Need.use_chat))]

TITLE_MAX = 80
PREVIEW_MAX = 120
# What a one-line preview drops from a reply: citations and Markdown marks.
MARKUP = re.compile(r"\s*\[L\d+\]|\*\*|^#+\s*|^[-*]\s+", re.MULTILINE)

# Starter questions per viewer (keys of companionChat.suggestions in the web messages). The
# child's active goals go after the first one.
ROLE_SUGGESTIONS = {
    Holder.parent: ["play_today", "week_progress", "school_notes", "doctor_questions"],
    Holder.education: ["class_strategies", "home_practice", "calming"],
    Holder.clinical: ["month_summary", "open_concerns", "doctor_questions"],
}


@router.post(
    "/children/{child_id}/chat",
    operation_id="askCompanionChat",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}, "description": "The streamed reply"}},
)
def ask(body: CompanionChatRequest, access: ChatUser, db: DbSession) -> StreamingResponse:
    conversation = (
        _own_conversation(db, access.user, body.conversation_id, access.child.id)
        if body.conversation_id is not None
        else None
    )
    past = conversation.messages if conversation else []
    snapshot, sources = build_child_snapshot(db, access)
    prompt = companion_chat.prompt(access.child.name)
    try:
        deltas = llm.stream_text(
            prompt,
            companion_chat.context(snapshot, access.holder, body.locale),
            companion_chat.history(past, body.message),
            db=db,
            user_id=access.user.id,
            max_output_tokens=companion_chat.MAX_OUTPUT_TOKENS,
        )
    except llm.LLMNotConfiguredError as exc:
        raise ApiError(503, "ai_not_configured") from exc
    except llm.LLMQuotaExceededError as exc:
        raise ApiError(429, "ai_quota_exceeded") from exc
    except llm.LLMError as exc:
        raise ApiError(502, "ai_unavailable") from exc

    if conversation is None:
        # Created once the request is accepted, so the client has an id to continue with.
        # Listings skip conversations without messages, should this first reply fail.
        conversation = Conversation(
            child_id=access.child.id, user_id=access.user.id, mode=ConversationMode.companion
        )
        db.add(conversation)
        db.commit()
    conversation_id = conversation.id
    asked_urgent = companion_chat.is_urgent(body.message)

    def events() -> Iterator[str]:
        yield _event("meta", {"conversation_id": conversation_id, "urgent": asked_urgent})
        parts: list[str] = []
        try:
            for text in deltas:
                parts.append(text)
                yield _event("delta", {"text": text})
        except llm.LLMError:
            yield _event("error", {"message_key": "errors.ai_unavailable"})
            return
        reply = "".join(parts).strip()
        if not reply:
            yield _event("error", {"message_key": "errors.ai_unavailable"})
            return
        cited = companion_chat.cited_ids(reply, sources)
        urgent = asked_urgent or companion_chat.is_urgent("", reply)
        # Saved only once the reply is complete, so history never holds half an answer.
        message_id = _save_turn(db, conversation_id, body.message, reply, prompt, cited, urgent)
        yield _event(
            "done",
            {
                "message_id": message_id,
                "sources": [_source_out(sources[i]).model_dump(mode="json") for i in cited],
                "urgent": urgent,
            },
        )

    return StreamingResponse(events(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/children/{child_id}/conversations", operation_id="listCompanionConversations")
def list_conversations(access: ChatUser, db: DbSession) -> list[ConversationSummary]:
    """The viewer's own companion conversations about this child, most recent first."""
    last = (
        select(ChatMessage.conversation_id, func.max(ChatMessage.id).label("last_id"))
        .group_by(ChatMessage.conversation_id)
        .subquery()
    )
    rows = db.execute(
        select(Conversation, last.c.last_id)
        .join(last, last.c.conversation_id == Conversation.id)
        .where(
            Conversation.child_id == access.child.id,
            Conversation.user_id == access.user.id,
            Conversation.mode == ConversationMode.companion,
        )
        .order_by(last.c.last_id.desc())
    ).all()
    summaries = []
    for conversation, _ in rows:
        messages = conversation.messages
        question = next((m for m in messages if m.role == ChatRole.user), messages[0])
        reply = next((m for m in reversed(messages) if m.role == ChatRole.assistant), messages[-1])
        summaries.append(
            ConversationSummary(
                id=conversation.id,
                title=shorten(question.content, TITLE_MAX),
                preview=shorten(_plain(reply.content), PREVIEW_MAX),
                updated_at=messages[-1].created_at,
            )
        )
    return summaries


@router.get("/conversations/{conversation_id}/messages", operation_id="listCompanionMessages")
def list_messages(
    conversation_id: int, user: CurrentUser, db: DbSession
) -> list[CompanionMessageOut]:
    conversation = db.get(Conversation, conversation_id)
    if (
        conversation is None
        or conversation.user_id != user.id
        or conversation.mode != ConversationMode.companion
    ):
        raise ApiError(404, "not_found")
    # Checked again on every read: a revoked member loses their old conversations too.
    access = authorize(db, user, conversation.child_id, Need.use_chat)
    messages = conversation.messages
    cited = {i for m in messages for i in (m.meta_json or {}).get("cited", [])}
    sources = _current_sources(db, access, cited)
    return [
        CompanionMessageOut(
            id=m.id,
            role=m.role,
            content=m.content,
            created_at=m.created_at,
            sources=[sources[i] for i in (m.meta_json or {}).get("cited", []) if i in sources],
            urgent=bool((m.meta_json or {}).get("urgent")),
        )
        for m in messages
    ]


@router.get("/children/{child_id}/chat/suggestions", operation_id="getCompanionChatSuggestions")
def suggestions(access: ChatUser, db: DbSession) -> ChatSuggestionsOut:
    """Starter questions for the empty chat, by the viewer's role (design Assistant Chat E)."""
    name = access.child.name
    goals: Sequence[str] = []
    if access.can(Need.read_care_plan):
        goals = list(
            db.scalars(
                select(Goal.title)
                .where(Goal.child_id == access.child.id, Goal.status == GoalStatus.active)
                .order_by(Goal.id)
                .limit(2)
            )
        )
    first, *rest = ROLE_SUGGESTIONS[access.holder]
    items = [
        ChatSuggestion(key=first, params={"name": name}),
        *(ChatSuggestion(key="goal_progress", params={"name": name, "goal": g}) for g in goals),
        *(ChatSuggestion(key=key, params={"name": name}) for key in rest),
    ]
    # 4-6 in all: at most five, then the status report.
    items = [*items[:5], ChatSuggestion(key="status_report", params={"name": name})]
    return ChatSuggestionsOut(ai_available=llm.is_configured(), suggestions=items)


def _own_conversation(db: Session, user: User, conversation_id: int, child_id: int) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if (
        conversation is None
        or conversation.user_id != user.id
        or conversation.child_id != child_id
        or conversation.mode != ConversationMode.companion
    ):
        raise ApiError(404, "not_found")
    return conversation


def _save_turn(
    db: Session,
    conversation_id: int,
    question: str,
    reply: str,
    prompt: llm.Prompt,
    cited: list[int],
    urgent: bool,
) -> int:
    conversation = db.get(Conversation, conversation_id)
    assert conversation is not None
    answer = ChatMessage(
        role=ChatRole.assistant,
        content=reply,
        meta_json={
            "prompt": prompt.version,
            "model": get_settings().openai_model,
            "cited": cited,
            "urgent": urgent,
        },
    )
    conversation.messages.extend([ChatMessage(role=ChatRole.user, content=question), answer])
    db.commit()
    return answer.id


def _current_sources(db: Session, access: ChildAccess, ids: set[int]) -> dict[int, ChatSource]:
    """Cited entries as they are now, and only those the viewer can still see."""
    if not ids:
        return {}
    logs = db.scalars(select(Log).where(Log.id.in_(ids), Log.child_id == access.child.id))
    visible = [log for log in logs if log_rules.can_see(access, log)]
    authors = {
        u.id: u.name
        for u in db.scalars(select(User).where(User.id.in_({log.author_id for log in visible})))
    }
    return {log.id: _source_out(source_of(log, authors.get(log.author_id, ""))) for log in visible}


def _plain(text: str) -> str:
    return MARKUP.sub("", text)


def _source_out(source: Source) -> ChatSource:
    return ChatSource.model_validate(source, from_attributes=True)


def _event(name: str, data: dict[str, object]) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
