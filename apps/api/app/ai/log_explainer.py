"""The "Explain this to me" button on a teacher's or specialist's entry (COMPANION_SPEC §5.1).

The model sees only that one entry (never the child's name or the rest of the record), and
the answer is not saved: the parent may keep it as their own note.
"""

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai import llm
from app.ai.answer_mapper import LANGUAGES
from app.models import Goal, Locale, Log
from app.schemas.companion import LogExplanation


class _Output(BaseModel):
    summary: str
    at_home: str
    ask_next: list[str] = Field(max_length=3)


def prompt() -> llm.Prompt:
    return llm.with_safety(llm.load_prompt("log_explainer"))


def entry_input(log: Log, goal: Goal | None, locale: Locale) -> str:
    lines = [
        f"Answer in: {LANGUAGES[locale]}",
        f"Written by: {log.author_role.value}",
        f"Type: {log.type.value}",
        f"Date: {log.occurred_at.date().isoformat()}",
    ]
    if log.domains:
        lines.append(f"Topics: {', '.join(log.domains)}")
    if goal is not None and log.goal_progress is not None:
        lines.append(f"Goal: {goal.title} (progress: {log.goal_progress.value})")
    lines.append(f"Note:\n<<<\n{log.text or ''}\n>>>")
    return "\n".join(lines)


def explain(
    log: Log, goal: Goal | None, locale: Locale, *, db: Session, user_id: int
) -> LogExplanation:
    """Raises llm.LLMNotConfiguredError / llm.LLMError (incl. the daily cap)."""
    out = llm.structured(prompt(), entry_input(log, goal, locale), _Output, db=db, user_id=user_id)
    return LogExplanation(
        summary=out.summary.strip(),
        at_home=out.at_home.strip(),
        ask_next=[q.strip() for q in out.ask_next if q.strip()],
    )
