from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, ForeignKey, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UtcDateTime, utcnow


class ConversationMode(StrEnum):
    companion = "companion"  # the companion chatbot (COMPANION_SPEC §13), B11
    results = "results"  # "Ask about my results" for one screening (SCREENING_SPEC §8)


class ChatRole(StrEnum):
    user = "user"
    assistant = "assistant"


class Conversation(Base):
    """One user's chat about one child (COMPANION_SPEC §15). A results conversation is about one
    screening, and its prompt only ever sees that screening."""

    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("children.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    mode: Mapped[ConversationMode] = mapped_column(
        SAEnum(ConversationMode, native_enum=False, length=16)
    )
    screening_id: Mapped[int | None] = mapped_column(
        ForeignKey("screenings.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="ChatMessage.id"
    )


class ChatMessage(Base):
    """One turn. `meta_json` on assistant turns records the prompt version and model."""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[ChatRole] = mapped_column(SAEnum(ChatRole, native_enum=False, length=16))
    content: Mapped[str] = mapped_column(Text)
    meta_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")
