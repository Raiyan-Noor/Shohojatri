from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints

from app.models import ChatRole, Locale, Role


class CompanionChatRequest(BaseModel):
    # None starts a new conversation; its id comes back in the `meta` event.
    conversation_id: int | None = None
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    # The app's current language: the reply is written in it (COMPANION_SPEC §13.2).
    locale: Locale


class ChatSource(BaseModel):
    """A timeline entry a reply cited as [L<log_id>]."""

    log_id: int
    date: date
    author_role: Role
    author_name: str
    snippet: str


class CompanionMessageOut(BaseModel):
    id: int
    role: ChatRole
    content: str
    created_at: datetime
    # Assistant turns only: the entries cited (still visible to the viewer), and whether the
    # urgent card was shown.
    sources: list[ChatSource]
    urgent: bool


class ConversationSummary(BaseModel):
    id: int
    title: str  # the first question
    preview: str  # the start of the latest reply
    updated_at: datetime


class ChatSuggestion(BaseModel):
    """A starter question. The web app words it from `key` (messages companionChat.suggestions)."""

    key: str
    params: dict[str, str]


class ChatSuggestionsOut(BaseModel):
    # False when the API has no OpenAI key: the web app says so before the first question.
    ai_available: bool
    suggestions: list[ChatSuggestion]
