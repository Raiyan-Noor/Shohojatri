# Open questions

Kickoff review (B0) of `CLAUDE.md`, `docs/SCREENING_SPEC.md`, `docs/COMPANION_SPEC.md`, `PROMPTS.md` and the design handoff (`design/design_handoff_shohojatri/README.md`).

Format: issue → **recommended default** (what we'll do unless told otherwise) · phases affected. Answered items move to the spec (and CHANGELOG) and are deleted here.

---

### 1. ~~Design already exists — still build "plain" first?~~ Resolved in B1
Handoff tokens and fonts are used from B1; CLAUDE.md §7/§8 updated.

### 2. Route map: design's map vs. PROMPTS/CLAUDE.md
Design routes use singular `/screening/new`, `/screening/[id]/…` for the flow and plural `/screenings/[id]/report|clinician` for reports (spec §7 agrees on the plural report routes). It also adds routes that no phase owns: `/children/new?step=`, `/reminders`, `/children/[id]/activities/[activityId]`, `/children/[id]/reports/[reportId]`, quick-log as a sheet (`?log=new`).
**Default:** Adopt the design's map verbatim, extra routes included, so B14 needs no route changes. Mixed singular/plural is cosmetic. · B4, B7, B9, B11, B12
*B9:* the wizard is `/children/[id]/activate?step=diagnosis|traits|section|team|done` (`&section=` for one part), so it serves a screened child and a new one alike; `/children/new?companion=1` creates the child first and continues there. Quick log is a sheet with no route. Extra B9 routes: `/children/[id]/profile` (+ `/profile/edit?section=`), `/children/[id]/logs/new` (`?corrects=`), `/children/[id]/logs/[logId]/edit`.

### 3. Screens with no design, and missing English copy
Not designed: landing, `/share/[token]` recipient view (+ expired/revoked), `/teacher`, `/specialist`, `/admin`, clinician web view. Screening Flow, Results, Companion and Parent Report frames are Bangla-only.
**Default:** Build these from the primitives (clinician web view and share view reuse the Doctor Report body in a `reading-max` column). Landing = the in-app splash (Onboarding 01). Ask Claude Design for the teacher/specialist/admin screens before B14. Write English copy as we build, following the design's content rules. · B2, B3, B7, B13
*B7:* the clinician web view and `/share/[token]` (with expired / revoked / not-found states) reuse the Doctor Report body on an A4-width sheet rather than a `reading-max` column, because the report's tables need the width.

### 4. `ai/llm.py` is needed before the phase that creates it — partly resolved in B4
B4 uses `llm.py` + `answer_mapper.md` for "Other" answers (SCREENING §3.3); B8 is where `llm.py` is built.
**Default:** Minimal `llm.py` in B4 (client, JSON-output helper, "AI not configured" fallback, model names from env, confirmed against OpenAI docs). B8 adds SSE streaming and `safety.md`. · B4, B8
*B4:* built as described (Responses API structured outputs, `store=False`, prompt files with a `version` front-matter header). Streaming, `safety.md` and embeddings (`OPENAI_EMBED_MODEL`) remain for B8.
*B8:* `stream_text` (Responses API streaming, checked before the first byte so errors are plain JSON), `with_safety` and `safety.md` added. Embeddings move to B11, where retrieval needs them.

### 6. ~~Confidence rules overlap~~ Resolved in B5
The default was adopted and is now SCREENING_SPEC §6.4.

### 7. Look & watch (T4): weight and stimulus
§4.7 says it's unvalidated "hence low weight", but §6.1 gives it 0.10 (same as imitation, double free play). Its stimulus also needs animated children + a recorded traditional Bangla rhyme, which nobody has been asked to produce.
**Default:** Treat T4 as stretch: build it last in B6 with a simple SVG stimulus. Keep 0.10 in `config.yaml` as the spec says (weights renormalise when it's skipped). Flag the weight for the clinical advisor. · B5, B6
*B5:* 0.10 is in `scoring/config.yaml`, and a skipped T4 renormalises away. The weight still needs the clinical advisor.
*B6:* built last as SVG stand-ins (three dancing children / floating shapes) with a synthesized pentatonic tune, not a traditional rhyme. The real stimulus (animated or filmed children with a recorded Bangla rhyme) still needs producing, and the weight still needs the clinical advisor.

### 8. Voice prompts in Bangla
T2 ("দেখো!"), T3 ("এভাবে করো!", "এত্ত বড়!", 3-2-1 countdown) and calibration (soft sound) need audio. B6 suggests the Web Speech API, but most Android/desktop Chrome installs have no bn-BD voice, and the design supplies no audio.
**Default:** A team member records short clips (bn + en) as static assets. Web Speech is the fallback; a visual cue is used if neither works. · B6
*B6:* there are no recorded clips yet, so every line ("দেখো!", "এভাবে করো!", "এত্ত বড়!", the 3-2-1 countdown) uses the Web Speech API (`lib/activities/sound.ts`) when the browser has a voice for the page's language. Otherwise a soft chime plays and the on-screen cue carries the trial; an English voice never speaks to a child on the Bangla page. Calibration, the reward and Look & watch use synthesized tones. Still open: record bn + en clips and switch `say()` to them.

### 9. Monthly check-ins: seeded but not built
CLAUDE.md §10 requires Rafi's seed to include two monthly check-ins; COMPANION §10 and B13 call the feature a stretch. It's also unclear whether teachers see check-ins: they are `check_in` logs (visible to teachers via `care_team`) but are re-runs of screening tasks (screening results are hidden from teachers per §3.2).
**Default:** Seed check-ins as `check_in` logs with metrics and plot them on Progress; the check-in runner stays a stretch. Check-in logs default to `clinical` visibility, and the parent can change it per entry. · B9, B13
*B9:* not seeded yet. A `check_in` log needs somewhere to keep its metrics, which belongs with the Progress tab (B13), so the two seeded check-ins move to B13. The API already refuses `check_in` from users (only the app writes them).

### 10. Specialist access to a screening, and requests for screening-only children
SCREENING §7 says a parent can share with an on-platform specialist "in-app (grants access to that screening via the normal access flow)". But the normal flow is requester-initiated and grants are child-level, not per screening. Also unspecified: can access be requested for a child still in `screening` status?
**Default:** Child IDs exist for every child, whatever their status. "Share in-app" = the parent picks a Shohojatri specialist (from the directory) and sends an invite, which creates a normal child-level `clinical` grant once the specialist accepts. No per-screening grants. · B3, B7, B8
*B3:* the first half is built (every child has a Child ID and can receive requests, in COMPANION_SPEC §2). The parent-initiated invite is still open for B7/B8.
*B7:* sharing is by link only (SCREENING_SPEC §7). The in-app invite needs the specialist directory, so it moves to B8.
*B8:* the specialist directory and "Find specialists" were dropped from B8 by decision, so the in-app invite stays open (no phase owns it now).

### 11. What "private" log visibility means
COMPANION §3.2 shows `private` as "author only (+ parent always)" in the parent column and "author only" for others. That reads as: a teacher's private note is still visible to the parent.
**Default:** `private` = author + the child's parent. The UI labels it "Only you and the parent" for non-parents and "Only me" for the parent's own entries. · B3, B9, B11
*B9:* built as the default (`app/core/logs.py`, tested per role). The labels are worded neutrally so they read right to anyone: "Only the parent can see this" / "Only the writer and the parent can see this".

### 12. Sharing status reports across scopes
COMPANION §13.5 says status reports are "shareable with the care team". A report a parent or specialist generates (full or clinical scope) would then reach teachers, which conflicts with §11.3 (teachers never receive clinical-derived text).
**Default:** Store the scope a report was generated under. Sharing sends it only to members whose scope covers it; for others the UI offers "generate a teacher version" (regenerated from education-scoped context). · B11

### 13. Demo screenings and the real record
Not specified: whether demo-mode screenings (`is_demo`) appear in screening history, change `child.status`, or feed the context engine; and which fixture profile demo mode replays.
**Default:** Demo screenings appear in history with a "Demo" label, never trigger the context engine or show on Progress, and can be deleted in one tap. Demo mode replays `elevated` by default, with a settings switch for `typical` / `noisy`. · B7, B11
*B7:* built as described for the screening side (SCREENING_SPEC §9): `elevated` by default with a per-device settings switch, and the "Demo" label on the home card, the result, both reports and the share page. A demo screening doesn't change `child.status`. Still open for B11/B13: keeping demo screenings out of the context engine and Progress. One-tap delete of a finalized screening has no UI yet (the API's delete works).

### 14. Data-model gaps (COMPANION §15 vs specs)
- `screenings` has no `informant` (who is answering) or the final free-text note, yet both appear in the doctor report.
- Calibration results have no home.
- Log edits are "versioned" (§5.1) but there's no versions table.
- `documents.visibility` values are undefined.
- `access_grants.can_add_logs` exists but §3.2 says all members can add logs.
**Default:** Add `screenings.informant` and `screenings.parent_note`. Store calibration as a `screening_tasks` row (`task = "calibration"`). Add `log_versions(log_id, version, snapshot_json, edited_at)`. `documents.visibility` = `care_team | clinical | private`, gated additionally by `share_documents`. `can_add_logs` defaults to true, and the parent can make a member read-only. Update §15 when built. · B3, B4, B9, B10
*B4:* `screenings.informant`, `screenings.parent_note` (plus `questionnaire_completed_at`) and `screening_answers.ai_mapping_json` added; COMPANION_SPEC §15 updated.
*B7:* the calibration is a `screening_tasks` row (`task = "calibration"`), and `screening_tasks.demo` marks replayed uploads; COMPANION_SPEC §15 updated.
*B3:* `can_add_logs` exists and the permission table checks it, but it is always true: the design's Care team (Companion B6) shows logs as "always on for every member", so there's no read-only toggle. Recorded in COMPANION_SPEC §3.2. The other items stay open for their phases.
*B9:* `log_versions` built (one row per edit, with the content before it); COMPANION_SPEC §15 updated. `documents.visibility` stays open for B10.

### 15. ~~Sign-up by phone, verification, password reset~~ Resolved in B2
Email or phone login, no OTP, admin-issued temporary passwords. Now in COMPANION_SPEC §3.1 ("Accounts and passwords").

### 16. Do non-prescribing specialists always see medications?
COMPANION_SPEC §3.2 gives clinical scope medications unconditionally, so B3 shows "Medicines · Always" for every specialist. The design's Care team frame (Companion B6) instead shows a "share medicines" switch on a speech therapist's request, which suggests parents expect to choose for therapists who don't prescribe.
**Default:** Follow the spec (always shared for clinical scope) until the clinical advisor decides. If changed, it's one row in `PERMISSIONS` plus showing the switch for specialists too. · B3, B10

### 17. ~~No limit on "Other" mapping calls~~ Resolved in B4
No cap: the POC's users are competition judges, so cost abuse isn't a concern. Text is capped at 1000 characters and each call has a 20 s timeout. Revisit before any public pilot (e.g. 40 calls per screening, then `unavailable`).


### 18. How a specialist reaches a screening report
An approved specialist may read a child's screening reports (COMPANION_SPEC §3.2), and `/screenings/[id]/clinician` lets them in, but nothing in the specialist's UI links there yet: their home lists children without screenings, and the child dashboard is B13.
**Default:** B13's child dashboard (Overview / Progress "screening history") lists finalized screenings with links to the doctor report for clinical members. Until then a parent shares a link. · B13

### 19. Characteristics sections: design vs spec
The design's profile wizard (Companion W3) lists 10 different sections (communication & language, social, play, senses, routine & change, emotions & calming, sleep, food, movement & hands, strengths) with different questions (e.g. "how many words", "responds to name") than COMPANION_SPEC §4.
**Default:** Follow the spec's 10 sections and questions (spec wins), laid out as the design shows them (list W3a, one section per screen W3b/W3c). If the design's version is preferred, change §4 first; only `seed/characteristics.yaml` changes. · B9, B14

### 20. Which words in a chat message count as urgent?
The companion chat shows the "talk to a doctor now / call 999" card when the user's message matches a keyword list (`URGENT_PATTERNS` in `apps/api/app/ai/companion_chat.py`, bn + en: seizure/খিঁচুনি, breathing/শ্বাস, injury/আঘাত, self-injury, unconscious/অজ্ঞান, not drinking/পানি খাচ্ছে না, sudden loss of skills/হঠাৎ…ভুলে যাচ্ছে, abuse/নির্যাতন), or when the reply mentions 999. The list errs towards false alarms ("শ্বাস" also matches calming breathing exercises), and descriptions without a keyword ("hands and legs shook, eyes rolled back") rely on the model writing 999.
**Default:** keep the cautious list; a clinician reviews it, plus real Bangla phrasings parents use, before the pilot. · B11
---

**Decided without asking** (noted for the record, not open):
- Auth cookies stay first-party via a Next.js rewrite of `/api/v1/*` → FastAPI (verify SSE isn't buffered).
- The >3-entries daily digest is grouped when the notification list is read (no scheduler).
- Request expiry (14 days) is evaluated lazily.
- The access-request limit is a rolling 24 hours rather than a calendar day.
- No access to a child → 404 (not 403), so child ids can't be probed.
- Audit log: one row per request per child touched.
- Logo comes from `design/assets/` (`logo_shoho.png` itself isn't in the repo). Copied in B1 to `apps/web/public/brand/logo_shoho.png` (bn) and `logo_shoho_en.png` (en).
- B4: questionnaire items load from `seed/questionnaire.yaml` at runtime; there is no questionnaire table.
- B4: one unfinished screening per child; "start over" deletes the old one.
- B4: the informant choices follow SCREENING_SPEC §2 (mother / father / other caregiver); the design's fourth chip (grandmother) is folded into "other caregiver".
- B4: frequency items show the spec's four cards (§3.1: "Rarely or never" is one card). The design's question frame (04a) splits it into "খুব কম" and "কখনো না"; the spec wins.
