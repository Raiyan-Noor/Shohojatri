"""The child snapshot: what the companion chat may know about a child, as plain text.

Built fresh from the database on every message, filtered to what the viewer may see. That's
the whole of the chat's knowledge in this first version; B11's context engine and retrieval
replace it behind the same endpoint.

Scope rules are the API's own: `ChildAccess.can` for whole sections and `logs.visible_clause`
for entries. A teacher therefore never gets clinical entries, other people's private entries
or medicines the parent didn't share.

Each entry is one line headed by its id (`[L12]`), so the model can cite it and the UI can
turn the citation into a source chip.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import logs as log_rules
from app.core.characteristics import OTHER, Question, QuestionType, load_characteristics
from app.core.dates import BD_TZ, age_in_months, today_bd
from app.core.permissions import ChildAccess, Holder, Need
from app.models import AccessGrant, Characteristics, Goal, GoalStatus, Log, User
from app.models.base import utcnow

LOG_WINDOW = timedelta(days=90)
# A budget for the entries section. Counted as one token per non-ASCII character (Bangla
# tokenises at roughly that rate or better) and four characters per token otherwise.
LOG_TOKEN_BUDGET = 8000
ENTRY_TEXT_MAX = 700
SNIPPET_MAX = 180
# The characteristics question holding the prescription text (health section).
MEDICINES = "medications"

ROLE_NAMES = {"parent": "parent", "teacher": "teacher", "specialist": "specialist"}
SCOPE_NAMES = {
    Holder.parent: "parent (sees everything)",
    Holder.education: "teacher (education access)",
    Holder.clinical: "specialist (clinical access)",
}


@dataclass(frozen=True)
class Source:
    """One entry the reply may cite, for the source chip and its bottom sheet."""

    log_id: int
    date: date
    author_role: str
    author_name: str
    snippet: str


def build_child_snapshot(db: Session, access: ChildAccess) -> tuple[str, dict[int, Source]]:
    """The snapshot text and the entries in it, keyed by log id."""
    child, today = access.child, today_bd()
    names = _names(db, access)
    lines = [
        f"# {child.name}",
        f"Today: {today.isoformat()}",
        f"Age: {age_in_months(child.dob, today)} months",
    ]
    if child.sex is not None:
        lines.append(f"Sex: {child.sex.value}")
    if access.can(Need.read_diagnosis):
        lines.append(f"Diagnosis: {_diagnosis(child.diagnosis_json)}")
    lines += ["", "## You are talking to", f"{access.user.name}, {SCOPE_NAMES[access.holder]}"]
    lines += ["", "## Care team", *_care_team(db, access, names)]
    lines += ["", *_characteristics(db, access)]
    goals = _goals(db, access)
    if access.can(Need.read_care_plan):
        lines += ["", "## Active goals"]
        active = [g for g in goals.values() if g.status == GoalStatus.active]
        lines += [f"- {g.title} ({g.domain}, set by {g.set_by_role.value})" for g in active] or [
            "- none recorded"
        ]
    lines += [
        "",
        "## Not in the record yet",
        "Therapy schedules, appointments, reminders and uploaded documents are not in the app "
        "yet. If asked, say so and suggest asking the care team.",
    ]
    entries, sources = _entries(db, access, names, goals)
    lines += ["", *entries]
    return "\n".join(lines), sources


def _names(db: Session, access: ChildAccess) -> dict[int, str]:
    """Display names of everyone who has written about the child or is on the care team."""
    ids = set(db.scalars(select(Log.author_id).where(Log.child_id == access.child.id)))
    ids |= set(
        db.scalars(select(AccessGrant.user_id).where(AccessGrant.child_id == access.child.id))
    )
    ids.add(access.child.parent_id)
    return {u.id: u.name for u in db.scalars(select(User).where(User.id.in_(ids)))}


def _diagnosis(raw: dict[str, Any] | None) -> str:
    if not raw:
        return "none recorded"
    kind = {
        "autism": "autism",
        "autism_plus": f"autism and {raw.get('condition_text')}",
        "other_condition": str(raw.get("condition_text")),
        "being_assessed": "being assessed (no diagnosis yet)",
    }.get(raw.get("kind", ""), "recorded")
    parts = [kind]
    if raw.get("diagnosed_on"):
        parts.append(f"since {raw['diagnosed_on']}")
    if raw.get("diagnosed_by"):
        parts.append(f"by {raw['diagnosed_by']}")
    return ", ".join(parts)


def _care_team(db: Session, access: ChildAccess, names: dict[int, str]) -> list[str]:
    rows = [f"- {names.get(access.child.parent_id, 'Parent')} (parent)"]
    grants = db.scalars(
        select(AccessGrant).where(
            AccessGrant.child_id == access.child.id, AccessGrant.revoked_at.is_(None)
        )
    )
    for grant in grants:
        user = db.get(User, grant.user_id)
        if user is None or not user.is_active:
            continue
        detail = ", ".join(x for x in (user.specialty, user.organisation) if x)
        role = "teacher" if user.role.value == "teacher" else "specialist"
        rows.append(f"- {user.name} ({role}{', ' + detail if detail else ''})")
    return rows


def _characteristics(db: Session, access: ChildAccess) -> list[str]:
    row = db.scalar(
        select(Characteristics)
        .where(Characteristics.child_id == access.child.id)
        .order_by(Characteristics.version.desc())
        .limit(1)
    )
    if row is None or not access.can(Need.read_profile):
        return ["## Characteristics", "Not filled in yet."]
    answers = row.answers_json.get("sections", {})
    show_medicines = access.can(Need.read_medications)
    lines = [f"## Characteristics (from the parent's questionnaire, {_day(row.created_at)})"]
    for section in load_characteristics().sections:
        saved = answers.get(section.id) or {}
        parts = [
            f"{_label(question)}: {_answer(question, saved[question.id])}"
            for question in section.questions
            if question.id in saved and (show_medicines or question.id != MEDICINES)
        ]
        if parts:
            lines.append(f"- {section.title_en}: " + "; ".join(parts))
    if not show_medicines:
        lines.append("- Medicines: not shared with you (only the family and doctors see them)")
    return lines


def _label(question: Question) -> str:
    return question.text_en.split("(")[0].strip().rstrip("?").lower()


def _answer(question: Question, value: Any) -> str:
    options = {o.id: o.en for o in question.options}
    match question.type:
        case QuestionType.single | QuestionType.multi:
            chosen = [options.get(s, s) for s in value.get("selected", []) if s != OTHER]
            if value.get("other_text"):
                chosen.append(f'"{value["other_text"]}"')
            return ", ".join(chosen)
        case QuestionType.grid:
            rows = {r.id: r.en for r in question.rows}
            return ", ".join(f"{rows.get(k, k)} {options.get(v, v)}" for k, v in value.items())
        case QuestionType.tags | QuestionType.list:
            return "; ".join(f'"{v}"' for v in value)
        case QuestionType.therapies:
            return "; ".join(
                " ".join(
                    x
                    for x in (
                        row.get("other_text") or options.get(row["type"], row["type"]),
                        f"at {row['provider']}" if row.get("provider") else "",
                        f"({row['frequency']})" if row.get("frequency") else "",
                    )
                    if x
                )
                for row in value
            )
        case _:
            return f'"{value}"'


def _goals(db: Session, access: ChildAccess) -> dict[int, Goal]:
    if not access.can(Need.read_care_plan):
        return {}
    goals = db.scalars(select(Goal).where(Goal.child_id == access.child.id).order_by(Goal.id))
    return {g.id: g for g in goals}


def _entries(
    db: Session, access: ChildAccess, names: dict[int, str], goals: dict[int, Goal]
) -> tuple[list[str], dict[int, Source]]:
    cutoff = utcnow() - LOG_WINDOW
    visible = list(
        db.scalars(
            select(Log)
            .where(Log.child_id == access.child.id, log_rules.visible_clause(access))
            .order_by(Log.occurred_at.desc(), Log.id.desc())
        )
    )
    # A correction replaces the entry it corrects.
    replaced = {log.corrects_log_id for log in visible if log.corrects_log_id}
    current = [log for log in visible if log.id not in replaced]

    lines = ["## Timeline entries (newest first; cite as [L<id>])"]
    sources: dict[int, Source] = {}
    older: Counter[str] = Counter()
    older_total, budget = 0, LOG_TOKEN_BUDGET
    for log in current:
        line = _entry_line(log, names, goals) if log.occurred_at >= cutoff else None
        cost = _tokens(line) if line else 0
        if line is None or cost > budget:
            older_total += 1
            older.update(log.domains or ["no area"])
            budget = 0  # keep the cut contiguous: everything after it counts as older
            continue
        budget -= cost
        lines.append(line)
        sources[log.id] = source_of(log, names.get(log.author_id, ""))
    if not sources:
        lines.append("- No entries in the last 90 days.")
    if older_total:
        counts = ", ".join(f"{domain} {n}" for domain, n in older.most_common())
        lines.append(f"Older entries not shown: {older_total} ({counts}).")
    return lines, sources


def source_of(log: Log, author_name: str) -> Source:
    return Source(
        log_id=log.id,
        date=_day(log.occurred_at),
        author_role=log.author_role.value,
        author_name=author_name,
        snippet=shorten(log.text or ", ".join(log.domains), SNIPPET_MAX),
    )


def _entry_line(log: Log, names: dict[int, str], goals: dict[int, Goal]) -> str:
    parts = [
        f"[L{log.id}] {_day(log.occurred_at).isoformat()}",
        f"{ROLE_NAMES.get(log.author_role.value, log.author_role.value)} "
        f"{names.get(log.author_id, '')}".strip(),
        log.type.value,
    ]
    if log.domains:
        parts.append(", ".join(log.domains))
    if log.ratings_json:
        ratings = set(log.ratings_json.values())
        parts.append(
            f"rating {ratings.pop()}/5"
            if len(ratings) == 1
            else "ratings " + ", ".join(f"{d} {r}/5" for d, r in log.ratings_json.items())
        )
    if log.mood:
        parts.append(f"mood {log.mood}/5")
    goal = goals.get(log.goal_id) if log.goal_id else None
    if goal is not None:
        progress = f", {log.goal_progress.value.replace('_', ' ')}" if log.goal_progress else ""
        parts.append(f'goal "{goal.title}"{progress}')
    if log.visibility.value != "care_team":
        parts.append(f"visibility {log.visibility.value}")
    if log.corrects_log_id:
        parts.append(f"corrects L{log.corrects_log_id}")
    if log.text:
        parts.append(f'"{shorten(log.text, ENTRY_TEXT_MAX)}"')
    return " · ".join(parts)


def _day(at: datetime) -> date:
    return at.astimezone(BD_TZ).date()


def shorten(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _tokens(text: str) -> int:
    wide = sum(1 for c in text if ord(c) > 127)
    return wide + (len(text) - wide) // 4 + 1
