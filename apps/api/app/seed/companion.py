"""Rafi's companion record (CLAUDE.md §10): diagnosis, characteristics, goals and three months
of entries from his mother, teacher and doctor. Fictional. Dates are relative to today.

The ratings are written to tell a story the demo can show: communication improving, social
play slowly improving, sleep still hard. A separate step from `seed_children`, so databases
seeded before B9 get it too.
"""

# One demo entry per line reads better than wrapped Bangla; Bangla digits are intended.
# ruff: noqa: E501, RUF001

from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.characteristics import load_characteristics
from app.core.dates import BD_TZ, today_bd
from app.models import (
    AccessGrant,
    Characteristics,
    Child,
    Goal,
    GoalProgress,
    Log,
    LogType,
    LogVisibility,
    Notification,
    NotificationKind,
    Role,
    User,
)
from app.models.base import utcnow
from app.seed.children import RAFI_CODE

CHARACTERISTICS: dict[str, dict[str, Any]] = {
    "communication": {
        "main_way": {"selected": ["single_words", "pulls_hand"], "other_text": None},
        "understands": {"selected": ["simple_instructions"], "other_text": None},
        "home_languages": {"selected": ["bangla"], "other_text": None},
    },
    "social_play": {
        "enjoys": {"selected": ["alone", "with_parents"], "other_text": None},
        "favourite_play": "পানি নিয়ে খেলা, বুদবুদ, গাড়ি লাইন করে সাজানো",
        "happy_signs": "হাত নাড়ে, লাফায়, জোরে হাসে",
    },
    "sensory": {
        "senses": {
            "sound": "avoids",
            "light": "no_difference",
            "touch": "seeks",
            "taste_texture": "avoids",
            "smell": "no_difference",
            "movement": "seeks",
        },
        "sensitivities": ["প্রেশার কুকারের সিটি", "ব্লেন্ডারের শব্দ", "চুল কাটা"],
    },
    "triggers": {
        "triggers": {
            "selected": ["loud_noise", "routine_change", "transitions", "haircut_nails"],
            "other_text": None,
        },
    },
    "calming": {
        "calming": {
            "selected": ["deep_pressure", "specific_song", "favourite_object"],
            "other_text": None,
        },
    },
    "strengths": {
        "interests": {"selected": ["numbers", "music", "vehicles"], "other_text": None},
        "strengths_text": "১ থেকে ২০ পর্যন্ত গুনতে পারে। গানের সুর খুব তাড়াতাড়ি মনে রাখে।",
    },
    "daily_living": {
        "sleep": {"selected": ["takes_long", "wakes_at_night"], "other_text": None},
        "eating": {"selected": ["limited"], "other_text": None},
        "toileting": {"selected": ["in_progress"], "other_text": None},
        "dressing": {"selected": ["some_help"], "other_text": None},
    },
    "current_support": {
        "therapies": [
            {
                "type": "speech",
                "other_text": None,
                "provider": "Sample Child Development Centre",
                "frequency": "সপ্তাহে ২ দিন",
            },
            {
                "type": "special_education",
                "other_text": None,
                "provider": "Alor Poth Special School (Sample)",
                "frequency": "রবি থেকে বৃহস্পতি",
            },
        ],
        "school": {"selected": ["special"], "other_text": None},
        "school_name": "Alor Poth Special School (Sample)",
    },
    "health": {"other_conditions": "ঘুমের সমস্যা"},
    "family_goals": {
        "goals": ["মুখে বলে চাইতে পারা", "রাতে তাড়াতাড়ি ঘুমানো", "অন্য বাচ্চাদের সাথে খেলা"],
    },
}

# key: (title, domain, set by)
GOALS = {
    "more": ("চাওয়ার জন্য “আরও” বলা", "communication", "teacher"),
    "turns": ("৩ মিনিট পালা নিয়ে খেলা", "social", "specialist"),
    "sleep": ("রাত ১০টার মধ্যে ঘুম", "sleep", "parent"),
}

# (days ago, hour, author, type, domains, rating for each domain, text, goal, progress,
#  visibility). None visibility = the default (care team).
Entry = tuple[
    int, int, str, LogType, list[str], int | None, str | None, str | None, str | None, str | None
]
OBS, P, C, M = LogType.observation, LogType.progress, LogType.concern, LogType.milestone
S, D, N = LogType.school_day, LogType.therapy_session, LogType.clinical_note
ENTRIES: list[Entry] = [
    (88, 21, "parent", C, ["sleep"], 1, "রাত ১টা পর্যন্ত জেগে ছিল। বিছানায় শুইয়ে দিলেই উঠে পড়ে।", None, None, None),
    (86, 11, "doctor", N, ["communication", "social"], None,
     "Initial review after diagnosis. Communicates mainly by leading an adult's hand; 2-3 "
     "approximations ('pa', 'ma'). Good interest in cause-and-effect toys. Plan: speech therapy "
     "twice a week, parent-mediated play at home, review in 4 weeks.", None, None, None),
    (85, 17, "parent", OBS, ["communication"], 2, "বুদবুদ ফুরিয়ে গেলে আমার হাত টেনে বোতলের কাছে নিয়ে গেল।", None, None, None),
    (82, 12, "teacher", S, ["social", "behaviour_emotions"], 2,
     "Today in class — participation: stayed at the table 2 min. Communication: pulled my hand "
     "to the water tray. Behaviour: cried at the bell for snack time. What worked: a picture "
     "card before the change.", None, None, None),
    (80, 20, "parent", OBS, ["eating"], 2, "শুধু ভাত আর ডিম খেতে চায়। সবজি দেখলে প্লেট সরিয়ে দেয়।", None, None, None),
    (78, 22, "parent", C, ["sleep"], 2, "আজও ঘুমাতে ১২টা বাজল।", "sleep", "no_progress", None),
    (75, 16, "doctor", D, ["communication"], 3,
     "Speech session: imitated 'ba' for bubbles 3 times with a model. Home practice: pause "
     "before giving bubbles and wait 5 seconds for a sound or gesture.", "more", "some", None),
    (74, 12, "teacher", S, ["learning", "social"], 3,
     "Today in class — participation: matched 3 colours. Communication: looked at me when "
     "I paused the song. What worked: singing 'আয় আয় চাঁদ মামা' with a pause.", None, None, None),
    (71, 18, "parent", P, ["communication"], 3, "গাড়ি চাইতে প্রথমবার “গা” বলল!", "more", "some", None),
    (69, 21, "parent", OBS, ["behaviour_emotions", "sensory"], 2, "প্রেশার কুকারের সিটিতে কান চেপে কাঁদল। জড়িয়ে ধরে রাখলে শান্ত হলো।", None, None, None),
    (67, 12, "teacher", S, ["behaviour_emotions"], 3,
     "Arrival was calm today. Transition from blocks to snack: mild protest, settled with a "
     "2-minute warning and the timer.", None, None, None),
    (64, 11, "doctor", N, ["sleep"], None,
     "Sleep onset 1-2 h most nights per parent. Discussed a wind-down routine: dim lights, "
     "same song, no screens after 8 pm. Keep a sleep diary for 2 weeks.", "sleep", "no_progress",
     "clinical"),
    (63, 22, "parent", OBS, ["sleep"], 2, "সন্ধ্যায় পার্কে হাঁটার পর একটু আগে ঘুমাল, রাত ১১টায়।", "sleep", "some", None),
    (60, 12, "teacher", S, ["social"], 3,
     "Today in class — participation: sat in circle time for the whole song. Communication: "
     "waved bye. What worked: sitting next to Arif, who he watches.", None, None, None),
    (58, 17, "parent", OBS, ["communication", "social"], 3, "বাবা অফিস থেকে এলে দরজার দিকে দৌড়ে গেল, হাসল।", None, None, None),
    (55, 16, "doctor", D, ["communication"], 3,
     "Speech session: 4 consistent word approximations ('ba', 'ga', 'pa', 'ma'). Introduced "
     "'more' sign with bubbles.", "more", "some", None),
    (53, 20, "parent", C, ["daily_living", "behaviour_emotions"], 1, "চুল কাটাতে নিয়ে গেলাম, খুব কেঁদেছে। অর্ধেক কেটে ফিরে এলাম।", None, None, None),
    (50, 12, "teacher", S, ["learning"], 3,
     "Counted blocks 1 to 10 with me. Strong interest in numbers — we use number cards as a "
     "reward now.", None, None, None),
    (48, 21, "parent", OBS, ["sleep"], 2, "ঘুমের ডায়েরি লিখছি। এই সপ্তাহে গড়ে রাত ১১:৩০।", "sleep", "some", None),
    (46, 18, "parent", P, ["communication"], 3, "“পা” বলে পানি চাইল, দুবার।", "more", "some", None),
    (43, 12, "teacher", S, ["social", "behaviour_emotions"], 3,
     "Today in class — participation: 3 turns rolling the ball with a classmate. Behaviour: "
     "calm. What worked: short turns with a visual 'my turn / your turn' card.", "turns", "some", None),
    (41, 11, "doctor", N, ["social", "communication"], None,
     "4-week review. Joint attention emerging: follows a point to near objects. Social play "
     "goal: 3 minutes of turn-taking with an adult by next review.", "turns", "some", None),
    (39, 20, "parent", OBS, ["eating"], 3, "আজ আলু ভর্তা একটু খেল!", None, None, None),
    (36, 17, "parent", OBS, ["social"], 3, "চাচাতো বোনের সাথে পাশাপাশি বসে গাড়ি নিয়ে খেলল।", None, None, None),
    (34, 12, "teacher", S, ["communication"], 4,
     "Said 'more' (মোর) for bubbles without a model — first time in class!", "more", "good", None),
    (31, 22, "parent", C, ["sleep"], 2, "রাতে দুবার জেগে উঠেছে।", "sleep", "no_progress", None),
    (29, 16, "doctor", D, ["communication"], 4,
     "Speech session: 8 single words used to request across activities. Next: two-word "
     "combinations ('more bubble') via modelling.", "more", "good", None),
    (27, 18, "parent", M, ["communication"], 4, "নিজে থেকে “মা” ডেকেছে! আমি কেঁদে ফেলেছি।", None, None, None),
    (25, 12, "teacher", S, ["social"], 3,
     "Today in class — participation: block play ~2 min of turns. What worked: first-then "
     "board (first blocks, then snack).", "turns", "some", None),
    (22, 21, "parent", OBS, ["sleep", "behaviour_emotions"], 2, "সন্ধ্যার রুটিন মেনে চলার চেষ্টা করছি, তবু রাত ১১টার আগে ঘুমায় না।", "sleep", "some", None),
    (20, 17, "parent", OBS, ["sensory"], 3, "ব্লেন্ডার চালানোর আগে বলে দিলাম, এবার কান চেপে ধরলেও কাঁদেনি।", None, None, None),
    (18, 12, "teacher", S, ["behaviour_emotions"], 4,
     "Calm all day. Used the quiet corner by himself when the class got loud.", None, None, None),
    (16, 23, "parent", OBS, ["sleep", "behaviour_emotions"], None, "নিজের জন্য লিখে রাখছি: রাফির ঘুম নিয়ে চিন্তায় আমিও রাতে ঘুমাতে পারি না, খুব ক্লান্ত লাগে। ডাক্তারকে এটা বলতে চাই।", None, None, "private"),
    (15, 11, "doctor", N, ["sleep", "communication"], None,
     "Review: expressive vocabulary ~12 words. Sleep onset still late (avg 23:30 per diary). "
     "Referred for a sleep review at the next follow-up. Continue home routine.", None, None,
     "clinical"),
    (13, 12, "teacher", S, ["social"], 4,
     "Turn-taking during structured block play sustained ~3 min with visual schedule + "
     "first-then board. Transition to snack: mild protest, resolved with 2-min warning.",
     "turns", "good", None),
    (12, 18, "parent", P, ["communication", "social"], 4, "বুদবুদ ফুরিয়ে গেলে নিজে থেকে “আরও” বলল — দুইবার!", "more", "good", None),
    (10, 16, "doctor", D, ["communication"], 4,
     "Speech session: first two-word combination 'more ball'. Home: keep pausing and "
     "modelling two words during play.", "more", "good", None),
    (8, 21, "parent", OBS, ["sleep"], 2, "সন্ধ্যায় হাঁটা হয়েছে, রাত ১০:৪০-এ ঘুমাল।", "sleep", "some", None),
    (6, 12, "teacher", S, ["social", "learning"], 4,
     "Handed a ball to another child when asked — first time! Counted to 15.", None, None, None),
    (4, 17, "parent", OBS, ["eating", "communication"], 4, "খাবার টেবিলে “পানি” বলে চাইল।", "more", "good", None),
    (2, 11, "doctor", D, ["communication", "social"], 4,
     "Speech session: 15+ single words, 3 two-word phrases. Joint attention to distant points "
     "now. Recommend continuing turn-taking games at home daily.", "turns", "good", None),
    (1, 12, "teacher", S, ["social", "communication"], 4,
     "Today in class — participation: joined the rhyme with actions. Communication: said "
     "'bye' to me. What worked: sitting in the front row.", None, None, None),
    (0, 9, "parent", OBS, ["sleep"], 3, "কাল রাতে ১০:১৫-এ ঘুমিয়েছে — এ মাসের সবচেয়ে আগে!", "sleep", "some", None),
]  # fmt: skip

# The two newest professional entries are still unread in the parent's notifications.
UNREAD_NOTIFICATIONS = 2


def seed_companion(db: Session) -> int:
    """Rafi's companion record, once. Returns the number of entries created."""
    rafi = db.scalar(select(Child).where(Child.code == RAFI_CODE))
    if rafi is None or db.scalar(select(Log.id).where(Log.child_id == rafi.id).limit(1)):
        return 0
    people = {
        "parent": db.get(User, rafi.parent_id),
        "teacher": _user(db, "teacher@demo.bd"),
        "doctor": _user(db, "doctor@demo.bd"),
    }
    today = today_bd()
    doctor = people["doctor"]
    assert doctor is not None

    rafi.diagnosis_json = {
        "kind": "autism",
        "condition_text": None,
        "diagnosed_on": (today - timedelta(days=110)).strftime("%Y-%m"),
        "diagnosed_by": doctor.name,
        "diagnosed_by_user_id": doctor.id,
    }
    db.add(
        Characteristics(
            child_id=rafi.id,
            version=1,
            answers_json={
                "questionnaire_version": load_characteristics().version,
                "sections": CHARACTERISTICS,
            },
            created_by=rafi.parent_id,
            created_at=_at(today, 105, 21),
        )
    )
    goals: dict[str, Goal] = {}
    for key, (title, domain, by) in GOALS.items():
        author = people["doctor" if by == "specialist" else by]
        assert author is not None
        goals[key] = Goal(
            child_id=rafi.id,
            title=title,
            domain=domain,
            set_by_role=Role(by),
            created_by=author.id,
            created_at=_at(today, 84, 10),
        )
    db.add_all(goals.values())
    db.flush()

    # Today's entry stays a little in the past whenever the seed runs (and still editable).
    latest = utcnow() - timedelta(minutes=90)
    professional: list[Log] = []
    for days, hour, who, kind, domains, rating, text, goal, progress, visibility in ENTRIES:
        author = people[who]
        assert author is not None
        at = min(_at(today, days, hour), latest)
        log = Log(
            child_id=rafi.id,
            author_id=author.id,
            author_role=author.role,
            type=kind,
            occurred_at=at,
            domains=domains,
            ratings_json={d: rating for d in domains} if rating else {},
            text=text,
            goal_id=goals[goal].id if goal else None,
            goal_progress=GoalProgress(progress) if progress else None,
            visibility=LogVisibility(visibility) if visibility else LogVisibility.care_team,
            created_at=at,
        )
        db.add(log)
        if who != "parent":
            professional.append(log)
    db.flush()

    for index, log in enumerate(reversed(professional)):
        author = people["teacher" if log.author_role == Role.teacher else "doctor"]
        assert author is not None
        db.add(
            Notification(
                user_id=rafi.parent_id,
                kind=NotificationKind.log_added,
                payload_json={
                    "child_id": rafi.id,
                    "child_name": rafi.name,
                    "author_name": author.name,
                    "author_role": author.role.value,
                    "log_id": log.id,
                },
                created_at=log.created_at,
                read_at=None
                if index < UNREAD_NOTIFICATIONS
                else log.created_at + timedelta(hours=3),
            )
        )

    # The teacher last opened the timeline 5 days ago, so their card shows a few new entries.
    teacher = people["teacher"]
    assert teacher is not None
    grant = db.scalar(
        select(AccessGrant).where(
            AccessGrant.child_id == rafi.id, AccessGrant.user_id == teacher.id
        )
    )
    if grant is not None:
        grant.logs_seen_at = _at(today, 5, 13)
    db.commit()
    return len(ENTRIES)


def _at(today: date, days_ago: int, hour: int) -> datetime:
    return datetime.combine(today - timedelta(days=days_ago), time(hour), BD_TZ)


def _user(db: Session, email: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    assert user is not None, f"seed users first ({email})"
    return user
