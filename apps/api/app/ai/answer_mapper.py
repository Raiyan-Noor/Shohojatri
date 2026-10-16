"""Maps a parent's own-words answer onto one of the item's answer cards (SCREENING_SPEC §3.3).

The result is only a suggestion: the parent confirms it or picks another card.
"""

from dataclasses import asdict, dataclass
from enum import StrEnum
from functools import lru_cache
from typing import Any, Literal

from pydantic import BaseModel, create_model
from sqlalchemy.orm import Session

from app.ai import llm
from app.models import Locale
from app.scoring.items import Item

UNCLEAR = "unclear"

# What each card means, for the model. Users see the translated labels in the web app instead.
OPTION_MEANINGS = {
    "usually": "Yes, most of the time",
    "sometimes": "Sometimes",
    "rarely": "Rarely or never",
    "not_sure": "Not sure / haven't noticed",
    "sentences": "Puts 2 or more words together",
    "single_words": "Uses single words",
    "sounds_gestures": "Uses sounds or gestures, or pulls your hand",
    "little": "Rarely tries to communicate",
    "no": "No",
    "yes": "Yes",
    # q20 (hearing): never mapped, but the results chat describes the answer.
    "yes_normal": "Yes, and the result was normal",
    "yes_problem": "Yes, and it found a problem",
}
LANGUAGES = {Locale.bn: "Bangla", Locale.en: "English"}


class MappingStatus(StrEnum):
    suggested = "suggested"
    unclear = "unclear"  # the model couldn't match the text to a card
    unavailable = "unavailable"  # AI not configured, or the call failed


@dataclass(frozen=True)
class OtherMapping:
    status: MappingStatus
    option: str | None = None
    confidence: float | None = None
    reason: str | None = None

    def as_json(self) -> dict[str, Any]:
        return asdict(self)


@lru_cache
def _output_model(options: tuple[str, ...]) -> type[BaseModel]:
    # The allowed keys go into the JSON schema, so the model can't answer with another one.
    return create_model(
        "AnswerMapping",
        mapped_option=(Literal[(*options, UNCLEAR)], ...),  # type: ignore[valid-type]
        confidence=(float, ...),
        short_reason=(str, ...),
    )


def _input(item: Item, text: str, locale: Locale) -> str:
    cards = "\n".join(f"- {key}: {OPTION_MEANINGS[key]}" for key in item.options)
    return (
        f"Question (English): {item.text_en}\n"
        f"Question (Bangla): {item.text_bn}\n"
        f"Allowed cards:\n{cards}\n"
        f"Write short_reason in: {LANGUAGES[locale]}\n"
        f"Parent's answer:\n<<<\n{text}\n>>>"
    )


def map_other_answer(
    item: Item, text: str, locale: Locale, *, db: Session, user_id: int
) -> OtherMapping:
    """Never raises: when the AI can't help (not configured, failed, or the user's daily cap is
    used up), the parent picks the closest card themselves."""
    try:
        prompt = llm.load_prompt("answer_mapper")
        out = llm.structured(
            prompt,
            _input(item, text, locale),
            _output_model(item.options),
            db=db,
            user_id=user_id,
        )
    except (llm.LLMNotConfiguredError, llm.LLMError):
        return OtherMapping(MappingStatus.unavailable)

    data = out.model_dump()
    reason = data["short_reason"].strip() or None
    if data["mapped_option"] == UNCLEAR:
        return OtherMapping(MappingStatus.unclear, reason=reason)
    confidence = min(max(float(data["confidence"]), 0.0), 1.0)
    return OtherMapping(MappingStatus.suggested, data["mapped_option"], confidence, reason)
