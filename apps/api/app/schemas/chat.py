from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints

from app.models import ChatRole, Locale


class ChatMessageOut(BaseModel):
    id: int
    role: ChatRole
    content: str
    created_at: datetime


class ResultsChatOut(BaseModel):
    # False when the API has no OpenAI key: the web app shows "AI not available" up front.
    ai_available: bool
    messages: list[ChatMessageOut]


class ResultsChatRequest(BaseModel):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
    # The app's current language: the reply is written in it (SCREENING_SPEC §8).
    locale: Locale
