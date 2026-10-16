"""The only module that calls OpenAI (CLAUDE.md §5).

Prompt files (each with a `version` header), one structured-output call (`structured`) and
streamed chat replies (`stream_text`). Chat prompts end with the shared safety rules
(`with_safety`, COMPANION_SPEC §13.4).

Without OPENAI_API_KEY the app still runs: callers get LLMNotConfiguredError and fall back.
Each user has a daily call cap (LLM_DAILY_CAP); past it, callers get LLMQuotaExceededError,
which is an LLMError, so every caller already falls back.
"""

import logging
import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import openai
from openai.types.responses import EasyInputMessageParam
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.dates import today_bd
from app.models import LlmUsage

logger = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).with_name("prompts")
_FRONT_MATTER = re.compile(r"\A---\n(?P<head>.*?)\n---\n(?P<body>.*)\Z", re.DOTALL)


class LLMNotConfiguredError(Exception):
    """No API key configured."""


class LLMError(Exception):
    """The call failed, timed out, or returned something unusable."""


class LLMQuotaExceededError(LLMError):
    """The user has used up today's LLM calls."""


@dataclass(frozen=True)
class Prompt:
    name: str
    version: str
    text: str


@lru_cache
def load_prompt(name: str) -> Prompt:
    """Reads app/ai/prompts/<name>.md. Each file starts with a `version:` front-matter header."""
    raw = (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8").replace("\r\n", "\n")
    match = _FRONT_MATTER.match(raw)
    if match is None:
        raise ValueError(f"prompt {name}: missing front matter")
    head = dict(line.split(":", 1) for line in match["head"].splitlines() if ":" in line)
    version = head.get("version", "").strip()
    if not version:
        raise ValueError(f"prompt {name}: missing version")
    return Prompt(name=name, version=version, text=match["body"].strip())


def with_safety(prompt: Prompt) -> Prompt:
    """`prompt` followed by the safety rules. The version names both, so a stored reply says
    which rules it was written under."""
    safety = load_prompt("safety")
    return Prompt(
        name=prompt.name,
        version=f"{prompt.version}+{safety.version}",
        text=f"{prompt.text}\n\n{safety.text}",
    )


@dataclass(frozen=True)
class Turn:
    role: Literal["user", "assistant"]
    content: str


def is_configured() -> bool:
    return bool(get_settings().openai_api_key)


@lru_cache
def _client(api_key: str, timeout: float) -> openai.OpenAI:
    # One retry: a parent is waiting on the answer, so fail fast and fall back.
    return openai.OpenAI(api_key=api_key, timeout=timeout, max_retries=1)


def _take_quota(db: Session, user_id: int) -> None:
    """Counts one call for today, or raises LLMQuotaExceededError. Commits.

    The insert-if-missing and the guarded increment are single statements, so two workers
    can't both take the last call.
    """
    cap = get_settings().llm_daily_cap
    if cap <= 0:
        return
    day = today_bd()
    dialect = postgresql if db.get_bind().dialect.name == "postgresql" else sqlite
    db.execute(
        dialect.insert(LlmUsage)
        .values(user_id=user_id, day=day, calls=0)
        .on_conflict_do_nothing(index_elements=["user_id", "day"])
    )
    taken = db.execute(
        update(LlmUsage)
        .where(LlmUsage.user_id == user_id, LlmUsage.day == day, LlmUsage.calls < cap)
        .values(calls=LlmUsage.calls + 1)
    )
    db.commit()
    if taken.rowcount == 0:  # type: ignore[attr-defined]
        logger.info("LLM daily cap reached for user %s", user_id)
        raise LLMQuotaExceededError


def structured[T: BaseModel](
    prompt: Prompt, user_input: str, output: type[T], *, db: Session, user_id: int
) -> T:
    """One instruction + input → a validated `output` object (Structured Outputs).

    Counts against `user_id`'s daily cap, whether or not the call then succeeds.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        raise LLMNotConfiguredError
    _take_quota(db, user_id)
    client = _client(settings.openai_api_key, settings.openai_timeout_seconds)
    effort = settings.openai_reasoning_effort
    try:
        response = client.responses.parse(
            model=settings.openai_model,
            instructions=prompt.text,
            input=user_input,
            text_format=output,
            reasoning={"effort": effort} if effort else openai.omit,  # type: ignore[typeddict-item]
            # Child data: don't keep it on OpenAI's side for later retrieval.
            store=False,
        )
    except (openai.OpenAIError, ValueError) as exc:
        # Never log the input: it is the parent's text about their child.
        logger.warning("LLM call %s@%s failed: %s", prompt.name, prompt.version, type(exc).__name__)
        raise LLMError from exc
    if response.output_parsed is None:
        raise LLMError
    return response.output_parsed


def stream_text(
    prompt: Prompt,
    context: str,
    turns: Sequence[Turn],
    *,
    db: Session,
    user_id: int,
    max_output_tokens: int = 2000,
) -> Iterator[str]:
    """A chat reply, streamed as text deltas.

    `context` (the data the reply may use) is appended to the instructions; `turns` is the
    conversation, ending with the user's new message. Configuration, the daily cap and the
    request itself are checked before this returns, so the caller can still answer with an
    error status; failures after that surface as LLMError while iterating.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        raise LLMNotConfiguredError
    _take_quota(db, user_id)
    client = _client(settings.openai_api_key, settings.openai_timeout_seconds)
    effort = settings.openai_reasoning_effort
    messages: list[EasyInputMessageParam] = [
        {"role": turn.role, "content": turn.content} for turn in turns
    ]
    try:
        stream = client.responses.create(
            model=settings.openai_model,
            instructions=f"{prompt.text}\n\n{context}",
            input=messages,  # type: ignore[arg-type]
            reasoning={"effort": effort} if effort else openai.omit,  # type: ignore[typeddict-item]
            max_output_tokens=max_output_tokens,
            store=False,
            stream=True,
        )
    except openai.OpenAIError as exc:
        logger.warning(
            "LLM stream %s@%s failed: %s", prompt.name, prompt.version, type(exc).__name__
        )
        raise LLMError from exc
    return _deltas(stream, prompt)


def _deltas(stream: openai.Stream[Any], prompt: Prompt) -> Iterator[str]:
    try:
        with stream:
            for event in stream:
                if event.type == "response.output_text.delta":
                    yield event.delta
                elif event.type in ("error", "response.failed"):
                    raise LLMError(event.type)
                elif event.type == "response.incomplete":
                    # Out of output tokens: keep what was written rather than fail the reply.
                    logger.info("LLM stream %s@%s ended incomplete", prompt.name, prompt.version)
    except openai.OpenAIError as exc:
        logger.warning(
            "LLM stream %s@%s broke: %s", prompt.name, prompt.version, type(exc).__name__
        )
        raise LLMError from exc
