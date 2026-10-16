"""Ask about my results (SCREENING_SPEC §8): a streamed chat about one finalized screening.

Parent only: it is part of the parent's result screen. One conversation per parent per
screening, kept so the chat is still there when they come back.

The reply streams as server-sent events:

    event: delta   data: {"text": "..."}         (many)
    event: done    data: {"message_id": 12}      (the saved reply)
    event: error   data: {"message_key": "errors.ai_unavailable"}

Problems found before the stream starts (AI not configured, daily cap, a failed request) are
ordinary JSON errors instead, so the browser can show them without parsing a stream.
"""

import json
import logging
from collections.abc import Iterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import llm, results_chat
from app.core.config import get_settings
from app.core.deps import DbSession
from app.core.errors import ApiError
from app.core.screenings import ScreeningWriter, require_finalized
from app.models import ChatMessage, ChatRole, Conversation, ConversationMode, Screening
from app.schemas.chat import ChatMessageOut, ResultsChatOut, ResultsChatRequest

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

SSE_HEADERS = {
    # no-transform: stops proxies and Next's compression from buffering the stream.
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
}


@router.get("/screenings/{screening_id}/chat", operation_id="getResultsChat")
def get_results_chat(writer: ScreeningWriter, db: DbSession) -> ResultsChatOut:
    require_finalized(writer.screening)
    conversation = _conversation(db, writer.screening, writer.access.user.id)
    messages = conversation.messages if conversation else []
    return ResultsChatOut(
        ai_available=llm.is_configured(),
        messages=[_message_out(m) for m in messages],
    )


@router.post(
    "/screenings/{screening_id}/chat",
    operation_id="askResultsChat",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}, "description": "The streamed reply"}},
)
def ask_results_chat(
    body: ResultsChatRequest, writer: ScreeningWriter, db: DbSession
) -> StreamingResponse:
    screening, user = writer.screening, writer.access.user
    require_finalized(screening)
    conversation = _conversation(db, screening, user.id)
    past = conversation.messages if conversation else []
    prompt = results_chat.prompt()
    try:
        deltas = llm.stream_text(
            prompt,
            results_chat.screening_context(screening, body.locale),
            results_chat.history(past, body.message),
            db=db,
            user_id=user.id,
        )
    except llm.LLMNotConfiguredError as exc:
        raise ApiError(503, "ai_not_configured") from exc
    except llm.LLMQuotaExceededError as exc:
        raise ApiError(429, "ai_quota_exceeded") from exc
    except llm.LLMError as exc:
        raise ApiError(502, "ai_unavailable") from exc

    def events() -> Iterator[str]:
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
        # Saved only once the reply is complete, so history never holds half an answer or a
        # question without one.
        message_id = _save_turn(db, screening, user.id, body.message, reply, prompt)
        yield _event("done", {"message_id": message_id})

    return StreamingResponse(events(), media_type="text/event-stream", headers=SSE_HEADERS)


def _conversation(db: Session, screening: Screening, user_id: int) -> Conversation | None:
    return db.scalar(
        select(Conversation).where(
            Conversation.screening_id == screening.id,
            Conversation.user_id == user_id,
            Conversation.mode == ConversationMode.results,
        )
    )


def _save_turn(
    db: Session, screening: Screening, user_id: int, question: str, reply: str, prompt: llm.Prompt
) -> int:
    conversation = _conversation(db, screening, user_id)
    if conversation is None:
        conversation = Conversation(
            child_id=screening.child_id,
            user_id=user_id,
            mode=ConversationMode.results,
            screening_id=screening.id,
        )
        db.add(conversation)
    answer = ChatMessage(
        role=ChatRole.assistant,
        content=reply,
        meta_json={"prompt": prompt.version, "model": get_settings().openai_model},
    )
    conversation.messages.extend([ChatMessage(role=ChatRole.user, content=question), answer])
    db.commit()
    return answer.id


def _event(name: str, data: dict[str, object]) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _message_out(message: ChatMessage) -> ChatMessageOut:
    return ChatMessageOut(
        id=message.id, role=message.role, content=message.content, created_at=message.created_at
    )
