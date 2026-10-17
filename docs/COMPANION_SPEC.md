# Companion Module — Specification

Version: `companion-0.1` (POC). The companion turns a child's record into a living, shared profile after diagnosis. Parents, approved teachers and approved specialists keep it updated; the AI keeps a current understanding of the child and uses only that to help.

---

## 1. Lifecycle of a child record

```
screening ──(parent: "My child has been assessed")──► companion
   │                                                       │
   └── screening history, reports stay attached ───────────┘
```

- A parent can activate the companion from a screened child ("My child has been diagnosed / assessed") **or** create a companion profile directly (child was diagnosed elsewhere, never screened in the app).
- **Activation wizard** (parent):
  1. Diagnosis details: what was diagnosed (Autism / Autism + another condition / Other developmental condition / Still being assessed), date, by whom (free text, or pick a specialist on Shohojatri), optional upload of the assessment report.
  2. Child characteristics questionnaire (§4) — can be completed later, but the dashboard nudges until done.
  3. Care team: shows the **Child ID** with copy / share / QR so the parent can give it to teachers and doctors.
  4. Done → child dashboard.
- `child.status` becomes `companion`. Nothing from screening is deleted.
- Built (B9): the diagnosis date is a month (`YYYY-MM`), not before the child's birth month. "Pick a specialist on Shohojatri" offers the child's clinical care-team members (the directory was dropped in B8); their name is copied into the record. `POST /children/{id}/activate` is also how the parent changes the details later. The assessment-report upload arrives with Documents (B10). A child diagnosed elsewhere is added with `/children/new?companion=1`, which continues into the wizard.

## 2. Child ID

- Format `SJ-` + 5 characters from Crockford base32 without ambiguous characters (e.g. `SJ-7K3QX`). Unique, not derived from personal data.
- Typed codes are normalised before matching: case, spaces/dashes, Bangla digits, with or without `SJ`, and Crockford's look-alike rules (O → 0, I/L → 1). Generated codes never have a body starting with `SJ`, so a mistyped `SJ-123` can't read as a whole code.
- Every child has a Child ID, whatever its status (screening or companion). Only the parent sees it; members never do.
- The parent can **regenerate** it (old ID stops working for new requests; existing grants unaffected).

## 3. Roles, requests and access

### 3.1 Request flow (teachers and specialists)

1. Teacher/specialist home shows a **"Request access to a child"** box: Child ID + optional message ("I'm Rafi's class teacher at …").
2. API always answers "If this ID is valid, the parent has been notified" — never reveals whether the ID exists or the child's name (prevents enumeration). Limit: 10 requests per user per rolling 24 h.
   - Every request is stored with the code as typed, including codes that match no child (`child_id` NULL). The requester's own list therefore looks the same either way, and unmatched requests simply expire. The limit counts these too. Repeating an open request for the same code sends nothing new and costs nothing. A malformed code gets a field error (the format is public).
   - A declined requester is told only the code they used, never the child's name.
   - The requester can withdraw a pending request (`cancelled`).
3. Parent sees the request (in-app notification + "Care team" tab) with the requester's name, role, school/clinic, BMDC/registration number for specialists, and verified badge for admin-onboarded specialists.
4. Parent approves (choosing scope options, §3.2) or declines. Requester is notified. The child card appears on their home.
5. Parent can revoke anytime; revoke takes effect immediately. Requests expire after 14 days.

Specialists are onboarded only by Admin (name, specialty, registration number, organisation, phone, email, chamber location for the directory). Admin gets a one-time temporary password to hand over; the specialist must change it at first login.

**Accounts and passwords.** Login is by email or Bangladeshi mobile number (normalised to `+8801XXXXXXXXX`; Bangla digits accepted), with no OTP/verification in the POC. Passwords: at least 8 characters including a digit. A user with `must_change_password` can log in, but every endpoint except `GET /me` and `POST /auth/change-password` answers 403 `password_change_required` until they set their own (no current password needed while replacing a temporary one). There is no self-serve reset: Admin issues a temporary password (`POST /admin/users/{id}/temporary-password`, any non-admin account), which uses the same forced-change flow. Password change, temporary-password reset and deactivation revoke the user's sessions; deactivation takes effect immediately.

### 3.2 Scopes

| data | parent | teacher (`education`) | specialist (`clinical`) |
|---|---|---|---|
| Profile basics, characteristics, triggers, calming strategies, strengths, communication | ✔ | ✔ | ✔ |
| Diagnosis summary (what + date) | ✔ | ✔ | ✔ |
| Goals & care plan (therapies, goals) | ✔ | ✔ | ✔ |
| Medications | ✔ | only if parent ticks "share medications" | ✔ |
| Uploaded documents | ✔ | only if parent ticks "share documents" | ✔ (parent can untick) |
| Screening results & reports | ✔ | ✘ | ✔ |
| Run a screening (start, consent, answer, delete) | ✔ | ✘ | ✘ |
| Logs with visibility `care_team` | ✔ | ✔ | ✔ |
| Logs with visibility `clinical` | ✔ | ✘ | ✔ |
| Logs with visibility `private` | author only (+ parent always) | author only | author only |
| Add logs / goal progress | ✔ | ✔ | ✔ |
| Add clinical notes, edit care plan | ✔ (care plan) | suggest only | ✔ |
| Chat | ✔ | ✔ within scope | ✔ within scope |
| Approve/revoke access, regenerate ID, delete child | ✔ | ✘ | ✘ |

Implement as one dependency, e.g. `require_child_access(child_id, need="read:profile")`, backed by a single permission table in code, with tests for every role × permission. Every non-parent read/write is written to `audit_log (actor_id, child_id, action, resource, at)`. The parent can see "Who viewed or changed what" on the Care team tab.

Implemented in `app/core/permissions.py`. Someone with no relationship to the child (other parents, admins, members without an active grant) gets **404**, so ids don't reveal which children exist; a member lacking one permission gets **403**. The parent's own care-team actions (approve, decline, revoke, change options, new Child ID) are audit-logged too, so the activity feed is complete; it folds repeats of the same thing by the same person on the same day and covers the last 180 days. `can_add_logs` stays true for every member in the POC (the design shows logs as "always on").

## 4. Characteristics questionnaire (post-diagnosis)

Purpose: give the AI and the care team a structured picture of the child. Every question has bilingual options plus **"Other (write)"**; multi-select where natural. Editable later; each edit is a versioned change that feeds the context engine.

Sections (keep each short; one section per screen):
1. **Communication** — main way of communicating (spoken sentences / short phrases / single words / sounds & gestures / picture cards (PECS) or device / pulling an adult's hand / other); understands (most everyday talk / simple instructions / a few words / unsure); languages at home (Bangla / English / other).
2. **Social & play** — enjoys (playing alone / with parents / with other children); favourite kinds of play; how they show they're happy.
3. **Sensory** — for sound, light, touch, taste/texture, smell, movement: *avoids / seeks / no difference*; specific sensitivities (free text chips).
4. **Triggers** — multi-select: loud noise, crowds, change in routine, waiting, transitions between activities, certain clothes, haircut/nail-cutting, hunger, tiredness, other.
5. **What helps them calm down** — quiet corner, favourite toy/object, deep pressure/hug, music, rocking/swinging, a specific song, screen time, other.
6. **Strengths & interests** — things they love and are good at (free text + chips: numbers, letters, music, puzzles, vehicles, animals, drawing…).
7. **Daily living** — sleep (falls asleep easily / takes long / wakes at night), eating (eats most foods / limited foods / very limited), toileting (trained / in progress / not started), dressing.
8. **Current support** — therapies (speech, OT, ABA/behavioural, physiotherapy, special education, other) with provider and how often; school (none / mainstream / special school / home-based) and school name.
9. **Health** — other conditions (free text), medications (prefer entering via a prescription upload, §6).
10. **Family's top goals** — up to 3, free text ("Say what he wants with words", "Sit for meals").

Built (B9): the content (bilingual options) lives in `app/seed/characteristics.yaml`, served by `GET /characteristics/questionnaire`. "Favourite kinds of play", "how they show they're happy" and "other conditions" are free text; dressing got three options not listed here (mostly by themselves / some help / full help). The sensory grid has no "Other" (the free-text chips cover it). Each section is saved on its own (`PUT /children/{id}/characteristics/sections/{section}`); a saved section that changes makes a new version of the whole answer set, and saving identical answers doesn't. A section counts as done once saved, even if empty; skipped sections stay open and the dashboard nudges. Only the parent edits; every member reads, except the Health section's medicines answer, which follows the medications row of §3.2.

## 5. Logs (the heart of continuous tracking)

### 5.1 Log entry

| field | notes |
|---|---|
| `type` | `observation`, `progress`, `concern`, `milestone`, `therapy_session`, `school_day`, `clinical_note`, `activity_done`, `check_in` |
| `author_id`, `author_role` | shown as a badge: Parent / Teacher / Specialist |
| `occurred_at` | defaults to now; can be backdated |
| `domains[]` | `communication`, `social`, `behaviour_emotions`, `sensory`, `daily_living`, `learning`, `motor`, `sleep`, `eating` |
| `ratings{domain: 1–5}` | optional quick rating "How was it today?" (1 hard … 5 great) — powers trend charts |
| `text` | free text in any language |
| `goal_id` + `goal_progress` | optional: `no_progress` / `some` / `good` / `achieved` |
| `mood` | optional emoji scale |
| `visibility` | `care_team` (default) / `clinical` (specialist default for clinical notes) / `private` |
| `attachments` | optional photo of worksheet etc. (not video in POC) |

- **Quick log** on mobile: 3 taps + optional text — pick domain chips → rating → (text) → save. Voice input via the browser's speech recognition where available is a nice-to-have, not required.
- Entries are append-only. Authors can edit within 24 h; after that, add a correction that links to the original. Edits are versioned.
- **"Explain this to me"** button on teacher/specialist entries (parent view): the AI rewrites the entry in simple words in the parent's language, with what it might mean at home and what to ask next time. Not saved unless the parent saves it as a note. This addresses updates the parent can't easily interpret.
- Template prompts per role: Teacher — "Today in class: participation, communication, behaviour, what worked"; Specialist — "Session focus, progress on goals, home recommendations, next review".
- Built (B9) rules: an edit is allowed only to the author and only within 24 h of writing it (not of `occurred_at`); each edit keeps the previous content in `log_versions`. A correction is allowed only after that window, only by the author, and only once per entry (`corrects_log_id` is unique), so corrections form a chain; a correction always has the original's visibility. Who may write what: `clinical_note` only specialists; `clinical` visibility only people who can read clinical entries (not teachers); `check_in` only the app itself. Quick-log ratings rate every chosen topic the same. An entry needs a topic or some text. A parent may keep an explanation as a `private` note whose `explains_log_id` points at the explained entry; the model sees only that one entry (no name, no other record data).

### 5.2 Notifications
Parent gets an in-app notification for new teacher/specialist entries (batched into a daily digest when more than 3). Care team members see new entries on the child card ("2 new").
Built (B9): the digest is formed when the list is read — more than 3 `log_added` notifications for one child on one Bangladesh day show as one `log_digest` item, and reading it reads them all. "N new" counts entries by others, visible to the member, written since the member last opened the first page of the timeline (`access_grants.logs_seen_at`, or the grant date).

## 6. Documents (reports, prescriptions)

- Upload PDF/JPG/PNG ≤ 10 MB; type: assessment report, prescription, therapy plan, school report, test result, other. Stored on disk (`UPLOAD_DIR`) with random file names; served only through an authorised endpoint.
- **Extraction** (`ai/prompts/document_extractor.md`): PDF → text with pypdf; images → the lightweight multimodal model. Returns a **draft**: document date, author/clinic, diagnoses mentioned, medications **exactly as written** (name, strength, dose text, frequency text, duration), tests advised, therapies advised, next follow-up date, other instructions, and `illegible_fields[]`.
- The parent reviews the draft side by side with the image and confirms/edits. Only confirmed data becomes care-plan items, reminders (if the parent ticks "remind me") and a `clinical_note`-type log entry citing the document. The AI never guesses an unreadable dose — it marks it unreadable and asks the parent to check with the prescriber.

## 7. Care plan

- **Goals**: title, domain, set by (role), target date, status (`active` / `achieved` / `paused`), progress history (from logs).
- **Therapies**: type, provider, frequency, start date, home-practice notes.
- **Medications**: as prescribed (from confirmed documents or parent entry), prescriber, start/end. Display-only guidance: "Questions about medicines? Ask the prescribing doctor."
- **Follow-ups**: next appointment dates.
Specialists can add/edit goals, therapies and follow-ups; teachers can suggest goals (parent accepts).

## 8. Schedules & reminders

- Items: `doctor_followup`, `therapy_session`, `home_activity`, `medication`, `outing` (e.g. "evening walk in the park"), `school`, `custom`.
- Recurrence: once / daily / weekly (days) / monthly; reminder offset (at time, 15 min, 1 h, 1 day before).
- POC delivery: in-app reminder centre + "Today" card on the parent home + browser notifications while the app is open (Notification API, ask permission). Email/SMS/push are out of POC scope (design the model so a sender can be added).
- The chatbot can **suggest** reminders (e.g. after a prescription says "follow-up in 3 months", or after a therapist recommends daily practice); suggestions appear as cards with Confirm / Edit / Dismiss. Nothing is scheduled without the parent confirming.
- Marking a `home_activity` done creates an `activity_done` log.

## 9. Activity library (home exercises & games)

Seed 30 activities in `seed/activities.yaml`, each with: id, title_bn/en, domains, goal tags (e.g. `requesting`, `eye_contact`, `turn_taking`, `imitation`, `joint_attention`, `waiting`, `following_instructions`, `sensory_regulation`, `fine_motor`), age range, duration, materials (things found in a Bangladeshi home — steel bowls, dal, a ball, plastic bottles, a dupatta, rice), steps_bn/en, "why this helps", adapt-for notes (e.g. sound-sensitive), safety notes.

Write them in plain language from widely used parent-mediated play approaches (turn-taking games, imitation games, choice-making, songs with pauses, sensory bins). Mark the library "reviewed: false" until a therapist reviews it; show "Activity ideas — check with your therapist" in the UI.

The chatbot recommends **only from this library** (plus the child's own therapist recommendations from logs/documents), personalised: it picks by active goals, age and interests, adapts using sensitivities ("use a soft ball — Rafi dislikes loud sounds"), and explains why it chose it.

## 10. Monthly check-in (stretch for POC)

Re-run the camera activities from screening (Response to name, Look where I point, Copy me) as a "check-in". Results are stored as `check_in` logs with metrics and plotted on the Progress tab ("Turned to name: 1/3 → 2/3 → 3/3"). Copy must say this tracks change over time and is not a re-diagnosis.

## 11. Context engine (how the AI "learns")

### 11.1 Child context document

Stored as versioned JSON (`child_context` table: child_id, version, json, changelog, created_at). Every statement carries `source_ids` (log/document/questionnaire ids) and `as_of`.

```json
{
  "identity": { "name": "Rafi", "age_months": 38, "diagnosis": "...", "diagnosed_on": "...", "diagnosed_by": "..." },
  "communication": [ { "text": "Uses 10–15 single words; points to request snacks", "source_ids": ["log_..."], "as_of": "2026-10-02" } ],
  "social": [...], "sensory": [...], "triggers": [...], "calming_strategies": [...],
  "strengths_interests": [...], "daily_living": [...],
  "care_plan": { "goals": [ {"goal_id":"...","title":"...","status":"active","trend":"improving","evidence_ids":[...]} ],
                 "therapies": [...], "medications": [...], "next_followups": [...] },
  "recent_changes": [ { "text": "Started saying 'pani' at home and in class this week", "polarity": "positive", "source_ids": [...] } ],
  "open_concerns": [ { "text": "Sleep onset > 1 h most nights", "since": "...", "source_ids": [...] } ],
  "domain_trends": { "communication": {"trend":"improving","evidence_ids":[...]}, "...": {} },
  "conflicts": [ { "text": "Parent reports meltdowns at drop-off; teacher reports calm arrival", "source_ids": [...] } ],
  "care_team": [ { "role":"teacher","name":"...","since":"..." } ]
}
```

### 11.2 Update process

- Trigger: new/edited log, confirmed document, characteristics change, care-plan change, screening/check-in result. Debounce 60 s per child; process in a background task (FastAPI `BackgroundTasks` is fine for POC; keep the job function idempotent so it can move to a queue later).
- Input to the LLM (`ai/prompts/context_updater.md`): current context JSON + the new/changed source records (with ids, author role, date) + deterministic stats (rating averages per domain for last 14 vs previous 14 days, goal progress counts).
- Output: full updated JSON **and** a changelog (`added / updated / removed`, each with reason + source ids). Validate against a Pydantic schema; on failure retry once, then keep the old version and log the error.
- Rules in the prompt: never invent facts; every statement must cite sources; prefer recent and direct observations; a professional's observation within their domain (teacher: classroom/learning; specialist: clinical) is recorded as such, not overwritten by others; **disagreements are recorded in `conflicts`, never silently resolved**; medication data only from confirmed documents/parent entries, copied exactly; keep it concise (each section ≤ 6 items, merge similar ones).
- Trends (`improving / stable / needs attention`) are computed **deterministically** from ratings and goal progress first; the LLM may only describe them.

### 11.3 Scope filtering

When a teacher or specialist reads the context or chats, filter the context at read time: a statement is visible only if **all** of its `source_ids` are visible to that viewer (§3.2). Retrieval (§12) applies the same filter. Write tests that a teacher can never receive text derived from a `clinical` log or an unshared document.

## 12. Retrieval

- Chunk logs (one per entry) and confirmed document text (≈ 500 tokens) and embed them (`OPENAI_EMBED_MODEL`). Store vectors in a table (JSON/bytes) and do cosine similarity in numpy — fine for POC scale. Postgres + pgvector later.
- For a chat turn: top-k = 8 by similarity, after scope filtering, plus the last 10 visible entries by time.

## 13. Chatbot

> **Built so far (first version, before B11).** No context engine or retrieval yet: every message rebuilds a plain-text **child snapshot** from the database (`ai/snapshot.py`), filtered with the API's own rules (`ChildAccess.can`, `logs.visible_clause`). It holds basics, diagnosis, care team, the latest characteristics (medicines only for viewers with `read:medications`), active goals and the entries of the last 90 days, newest first, one line each, `[L{id}] date · role name · type · areas · rating · "text"`, capped at ≈ 8,000 tokens, with one line of per-area counts for older entries. The model cites entries as `[L12]`. The server keeps only ids that were in the snapshot, so a citation never reveals an entry the viewer can't see. There's no JSON tail and no suggested actions yet, and status reports are answered in the chat, not saved. `POST /children/{id}/chat` streams `meta` (conversation id, urgent from the question) → `delta`… → `done` (`message_id`, `sources`, `urgent`). `urgent` is a bn/en keyword check on the question (OPEN_QUESTIONS #20), or set when the reply mentions 999. `GET /children/{id}/conversations` lists the viewer's own conversations; `GET /conversations/{id}/messages` re-checks access and returns each reply's sources as they are now visible. `GET /children/{id}/chat/suggestions` returns starter questions by role, as message keys plus the child's name and active goals. B11 replaces the snapshot with the context engine behind the same endpoint and UI.

### 13.1 Who can use it
Parent (full), teacher and specialist (within scope). Separate conversation history per user per child. The results chat in screening (SCREENING_SPEC §8) is a separate, narrower mode.

### 13.2 Prompt assembly (`ai/prompts/companion_system.md`)
system: role + safety rules (`ai/prompts/safety.md`) + style (warm, simple, short paragraphs, in the user's current locale, Bangla by default; for specialists, concise and clinical)
+ viewer role and scope
+ child context (scope-filtered)
+ upcoming schedule (next 14 days) and active goals
+ retrieved entries with ids and dates
+ relevant activity-library items (by goal tags)
+ conversation history (last 12 turns; older turns summarised).

### 13.3 Output
Stream text via SSE. At the end, return a JSON block (parsed server-side, never shown raw) with:
- `citations`: ids of entries/documents used → rendered as small chips ("From teacher's note, 12 Oct") that open the entry.
- `suggested_actions`: reminder drafts, activity cards, "log this" drafts — rendered as confirm cards.
Use the model's structured output / JSON mode for this tail, or a second short call — whichever is more reliable with the chosen model.

### 13.4 Safety rules (`ai/prompts/safety.md`)
- Not a doctor: no diagnosis, no prognosis promises, no medication changes or dose advice ("please ask Dr. X who prescribed it").
- Answer only from the child's record, the activity library and general well-established parenting/communication guidance; say "I don't have that information" when needed and suggest who to ask (teacher/specialist on the care team).
- Urgent situations — injury, self-injury, seizure, breathing problems, not drinking for a day, sudden loss of skills, suspected abuse — tell the parent to contact a doctor immediately or call **999** (Bangladesh national emergency number). Show this as a highlighted card.
- Respectful, strengths-based language; never blame parents; acknowledge feelings briefly, then help.
- Teachers/specialists: never reveal data outside their scope even if asked.

### 13.5 Status report on demand
"Give me a status report" (any language) or the **Status report** button. Parameters: audience (`parent` / `teacher` / `doctor`), period (last 2 weeks / month / 3 months / custom).
Sections: snapshot (age, diagnosis, care team) · overall summary · progress by domain with trend and evidence · goals table · what's working · concerns & changes · schedule adherence (follow-ups, sessions, activities done) · questions for the next appointment · sources.
Numbers and tables are computed deterministically; the LLM writes the narrative from the scope-filtered context. Saved to `status_reports`, printable (print CSS), shareable with the care team.

## 14. Screens & dashboards (behaviour; visuals come from Claude Design)

**Parent home** — greeting; per child: card with photo/avatar, name, age, status chip (Screening / Companion), Child ID; "Start screening" CTA for new screening; "Today" (reminders due, suggested activity); quick-log button.

**Child dashboard (all roles, scope-filtered)** — tabs:
1. **Overview** — "Right now" AI summary (3–5 bullets with citations), recent changes, open concerns, next appointments, active goals with progress.
2. **Timeline** — all entries, filter by author role / domain / type, author badges, "Explain this to me" for parents.
3. **Progress** — per-domain rating trends (Recharts line, 7-day smoothing), goal progress, check-in metrics, screening history.
4. **Care plan** — goals, therapies, medications (scope), follow-ups, schedule.
5. **Documents** — list + viewer + extraction status.
6. **Care team** — members, roles, pending requests (approve/decline with scope options), activity log, Child ID tools (parent only).
7. **Chat** — companion chatbot; Status report button.

**Teacher home** — "Request access to a child" box (Child ID input) · grid of approved child cards (name, age, "2 new" badge) · pending/declined requests list. Tapping a card opens the child dashboard in education scope with "Add classroom note" prominent.

**Specialist home** — same pattern; list can sort by next follow-up; verified badge; "Add clinical note"; screening reports visible on the Progress tab.

**Admin** — specialists list, create specialist (shows one-time password), deactivate, audit log viewer.

## 15. Data model (SQLAlchemy)

```
users(id, role[parent|teacher|specialist|admin], name, email, phone, password_hash, preferred_locale,
      organisation, registration_no, specialty, verified, must_change_password, created_at, is_active)
      -- email stored lower-cased, phone as +8801XXXXXXXXX; either one logs in (no OTP in the POC)
refresh_tokens(id, user_id, jti, expires_at, revoked_at, created_at)   -- revocable sessions
children(id, code[SJ-XXXXX], parent_id, name, dob, sex, status[screening|companion], photo_path,
         diagnosis_json, created_at, deleted_at)
access_requests(id, child_id?, requester_id, child_code, message, status[pending|approved|declined|expired|cancelled], created_at, decided_at)
                 -- child_id NULL when the typed code matched no child (§3.1); child_code = the code as typed
access_grants(id, child_id, user_id, scope[education|clinical], share_medications, share_documents,
              can_add_logs, granted_at, logs_seen_at, revoked_at)
screenings(id, child_id, created_by, locale, age_months, informant[mother|father|other_caregiver],
           consent_version, consent_at, status[in_progress|finalized], is_demo, parent_note,
           questionnaire_completed_at, result_json, scoring_version, created_at, finalized_at)
screening_answers(id, screening_id, item_id, option, other_text, mapped_by_ai, ai_mapping_json, updated_at)
           -- unique (screening_id, item_id); option "other" = own words awaiting confirmation (SCREENING_SPEC §3.3)
screening_tasks(id, screening_id, task, variant, status, demo, payload_json, result_json, created_at)
           -- unique (screening_id, task); task "calibration" or a scored task; payload = features only, NULL when skipped
report_shares(id, screening_id, token_hash, expires_at, revoked_at, views, last_viewed_at, created_at)
           -- token_hash = SHA-256 of the link token (SCREENING_SPEC §7)
characteristics(id, child_id, version, answers_json, created_by, created_at)
           -- unique (child_id, version); answers_json = {questionnaire_version, sections: {id: answers}}
logs(id, child_id, author_id, author_role, type, occurred_at, domains, ratings_json, text, goal_id,
     goal_progress, mood, visibility, corrects_log_id, explains_log_id, version, created_at, edited_at)
           -- corrects_log_id unique (one correction per entry); explains_log_id = a parent's kept explanation
log_versions(id, log_id, version, snapshot_json, edited_at)   -- content before each edit
documents(id, child_id, uploaded_by, doc_type, file_path, mime, size, extracted_json, confirmed_json,
          status[uploaded|extracted|confirmed|failed], visibility, created_at)
goals(id, child_id, title, domain, set_by_role, target_date, status, created_by, created_at)
therapies(id, child_id, type, provider, frequency, start_date, notes)
medications(id, child_id, name, dose_text, frequency_text, prescriber, start_date, end_date, source_document_id)
schedule_items(id, child_id, type, title, starts_at, recurrence_json, remind_offsets, created_by,
               suggested_by_ai, status, created_at)
schedule_occurrences(id, schedule_item_id, due_at, done_at, skipped)
activities(id, slug, data_json, reviewed)
child_context(id, child_id, version, json, changelog_json, created_at)
embeddings(id, child_id, source_type, source_id, visibility, vector, text_hash)
conversations(id, child_id, user_id, mode[companion|results], screening_id, created_at)
messages(id, conversation_id, role, content, meta_json, created_at)
status_reports(id, child_id, created_by, audience, period_start, period_end, content_json, created_at)
specialist_directory(id, user_id?, name, type, address, phone, lat, lng, division, is_sample)
notifications(id, user_id, kind, payload_json, read_at, created_at)
audit_log(id, actor_id, child_id, action, resource, at)   -- resource: a kind ("profile") or kind:id ("grant:12")
```

## 16. API (companion)

```
POST /auth/signup (parent|teacher) · POST /auth/login · POST /auth/refresh · POST /auth/logout · POST /auth/change-password · GET /me · PATCH /me {preferred_locale}
POST /children/{id}/activate                 diagnosis details
POST /children (parent) · GET/PUT /children/{id} · POST /children/{id}/regenerate-code · DELETE /children/{id}
GET /characteristics/questionnaire · GET /children/{id}/characteristics · PUT /children/{id}/characteristics/sections/{section}
POST /access-requests {child_code, message} · GET /access-requests (mine) · POST /access-requests/{id}/cancel
GET /children/{id}/access-requests (pending, for the parent)
POST /access-requests/{id}/approve {scope options} · POST /access-requests/{id}/decline
GET /children/{id}/grants · PATCH /grants/{id} {scope options} · DELETE /grants/{id}
GET /children/{id}/activity (audit feed, parent)
GET /children (cards visible to me)
GET/POST /children/{id}/logs ?author_role&domain&type&offset&limit · GET/PATCH /logs/{id} · POST /logs/{id}/explain
GET /children/{id}/goals                     (create/edit: B10)
POST /children/{id}/documents · GET /documents/{id}/file · POST /documents/{id}/extract · POST /documents/{id}/confirm
GET/POST /children/{id}/goals|therapies|medications · PATCH/DELETE equivalents
GET/POST /children/{id}/schedule · POST /occurrences/{id}/done
GET /children/{id}/context · GET /children/{id}/overview
GET /children/{id}/progress?from&to
POST /children/{id}/chat (SSE) · GET /children/{id}/conversations
POST /children/{id}/status-reports · GET /status-reports/{id}
GET /activities?goal&age
GET /notifications · POST /notifications/{id}/read · POST /notifications/read-all
Admin: POST /admin/specialists · GET /admin/specialists · PATCH /admin/specialists/{id} {is_active} · POST /admin/users/{id}/temporary-password · GET /admin/audit
```
