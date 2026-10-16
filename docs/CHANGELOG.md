# Changelog

## B8 — Results chat (2026-10-17)

"Ask about my results" (SCREENING_SPEC §8). **Scope change:** "Find specialists near me" (directory seed, `/specialists/nearby`, map) was dropped from this phase by decision; the result screen still shows it as "coming soon", and SCREENING_SPEC §8 says so.

### API
- `ai/llm.py`: `stream_text()` streams a reply through the Responses API (`store=False`, the same reasoning effort, quota and timeout as `structured()`). Configuration, the daily cap and the request itself are checked before it returns, so the router can still answer with a JSON error; failures mid-stream become `LLMError`. `with_safety()` appends `prompts/safety.md` (COMPANION_SPEC §13.4) and names both versions (`results_explainer-1+safety-1`).
- `prompts/results_explainer.md`: how the screening and score work, the four classes and what to recommend, plain-text replies in the requested language, "your child" (the model is never given the name).
- `ai/results_chat.py` builds the prompt data from this one screening (SCREENING_SPEC §8 lists what's in it) and the last 12 messages.
- `GET /screenings/{id}/chat` (history + `ai_available`) and `POST /screenings/{id}/chat` (SSE: `delta` / `done` / `error`). Parent only, finalized screenings only. Question and reply are saved together once the reply completes; errors before the stream are 503 `ai_not_configured`, 429 `ai_quota_exceeded`, 502 `ai_unavailable`. SSE responses send `Cache-Control: no-cache, no-transform` so the Next rewrite doesn't buffer them.
- New tables `conversations` and `messages` (COMPANION_SPEC §15), migration `3032782ac0b9`. Deleting a screening deletes its chats (ORM cascade, as SQLite has no FK pragma).
- Tests (`test_results_chat.py`, LLM mocked): the prompt holds this screening's data and none of another family's screening, another chat, an older screening of the same child or the child's name; result, answers and class bands are in it; safety rules close the prompt; streaming, saving and history; history cap; broken and empty streams save nothing; not configured / quota / failed request; access (409 not finalized, 403 specialist, 404 stranger); length limits; delete cascade; `_deltas` event handling.

### Web
- `/screening/[id]/chat` (design Results C1): header with the report's date, a "not a diagnosis" banner, history, live streamed reply with a "looking at the report…" state, the four suggestion chips from the spec, and a composer. On failure the question goes back in the box with "Try again"; "AI not available" has its own state. Leaving the page aborts the stream.
- `apiFetch()` in `lib/api/client.ts`: raw fetch with the same 401 refresh-and-retry, for the stream. `lib/screening/chat.ts` parses the SSE.
- The result screen's "Ask about my results" is now a link; "Find specialists" stays "coming soon".
- Strings in bn + en; Bangla entries added to `messages/_review.md`.

### Verified
- API: `ruff check`, `ruff format --check`, `pytest` (736 passed), migration upgrade → downgrade → upgrade on a fresh SQLite DB, `alembic check` clean.
- Web: `pnpm typecheck`, `pnpm lint`, prettier.
- Against a scratch API on :8011 with `llm.stream_text` replaced by a fake streaming generator (there is no OpenAI key locally) and `next dev` on :3011: the stream arrives through the Next rewrite in pieces (41 chunks over 1.6 s, not buffered); in Chrome, a chip and the composer ask questions, the reply streams and stays after reload, a failing stream shows the Bangla error with the question restored, and the newest reply scrolls clear of the sticky composer.
- **Not verified:** a real OpenAI reply (no key here), so the Bangla quality of `results_explainer.md` is untested; the English page and a 390 px viewport in the browser.

## Deploy — first public deployment (pitch demo) (2026-10-17)

Readies the app for Render (API + Postgres, Singapore) and Vercel (web, `sin1`) before the companion module. No feature changes. Steps: `docs/DEPLOY.md`.

### API
- **Production settings:**
  - `ENV=production` refuses to start unless `DATABASE_URL` is Postgres, `JWT_SECRET` has ≥ 32 characters, `OPENAI_API_KEY` and `OPENAI_MODEL` are set, and `PUBLIC_WEB_URL` is https. The error names every missing variable.
  - In production, cookies are always `Secure` (plus `HttpOnly`, `SameSite=Lax`, no `Domain`), and `CORS_ORIGINS` defaults to `PUBLIC_WEB_URL`.
  - `postgres://` / `postgresql://` URLs are switched to the psycopg 3 driver (`psycopg[binary]`, new dependency).
- **Docker:**
  - `scripts/start.sh` runs `alembic upgrade head`, seeds only when `SEED_DEMO=true` (the seed was already idempotent), then starts uvicorn on `$PORT` with 2 workers and `--proxy-headers --forwarded-allow-ips "*"`.
  - `.gitattributes` keeps `*.sh` LF in Windows checkouts.
  - docker-compose sets `SEED_DEMO=true`.
- **Postgres:**
  - All 5 migrations upgrade, downgrade to base and re-upgrade on Postgres 17, and `alembic check` reports no drift.
  - No SQLite-only types or defaults were found: enums are non-native, JSON is portable, and there are no server defaults.
- **`GET /api/v1/client-config`** (public) returns `PUBLIC_WEB_URL`. The web app builds share links and the Child ID QR from it, falling back to its own origin in development.
- **Abuse protection** (new tables `rate_limit_hits`, `llm_usage`; migration `ad5926811e52`). Counts live in the database, so they hold across workers.
  - **Login:** 30 attempts per IP per 15 min, and 10 wrong passwords per account per 15 min. Successful logins don't count against the account, so a room can share `parent@demo.bd`.
  - **Sign-up:** 10 per IP per hour. Over the limit: 429 `rate_limited` with `retry_after`.
  - **Storage:** keys are SHA-256 hashes, never raw IPs or identifiers.
  - **LLM cap:** `LLM_DAILY_CAP` (default 50) calls per user per Bangladesh day, enforced in `ai/llm.py` with an atomic increment. Past it, `LLMQuotaExceededError` (an `LLMError`) makes callers fall back, and the "Other" answer asks the parent to pick a card.
  - **Uploads:** the task upload limit stays at 5 MB.
- **`render.yaml`:**
  - Docker web service in Singapore, health check `/api/v1/health`, a build filter on `apps/api/**`;
  - Postgres 17 with no public access;
  - both on Render's free plans (sleep after 15 idle minutes; the free database expires after 30 days; see DEPLOY.md);
  - `JWT_SECRET` generated, `OPENAI_API_KEY` / `PUBLIC_WEB_URL` as `sync: false`.
- **Tests:** 719 pass.
  - `test_production.py`: fail-fast for each variable, URL normalisation, Secure cookie attributes, client-config.
  - `test_rate_limits.py`: per-account failures, per-IP, window expiry, sign-up, hashed keys.
  - `test_llm_quota.py`: cap, per user, next day, 0 = off.
  - The conftest turns the auth limits off for the rest of the suite.

### Web
- **API proxy:** `API_ORIGIN` (renamed from `API_INTERNAL_URL` in next.config, Dockerfile, compose and `.env.example`) is the `/api/v1/*` rewrite target. The client already used relative URLs.
- **MediaPipe self-hosted:**
  - `scripts/prepare-models.mjs` (replaces `copy-mediapipe.mjs`) copies the used WASM pairs and downloads the 3 models, checked by SHA-256, into `public/models/mp-v<vision>-a<audio>/`. The versioned path is served `max-age=31536000, immutable`.
  - `NEXT_PUBLIC_MEDIAPIPE_MODEL_BASE` is gone.
- **Search engines and demo notice:**
  - `noindex, nofollow` in a meta tag and an `X-Robots-Tag` header.
  - A dismissible bn/en demo banner on every page, remembered in localStorage and guarded for blocked storage.
- **`vercel.json`:** `regions: ["sin1"]`.
- **PWA:**
  - `manifest.webmanifest`: name "সহযাত্রী (Shohojatri)", start `/bn`, standalone, theme `#004E8B`.
  - Icons: 192/512/maskable-512 and the apple-touch-icon. `scripts/make_icons.py` generates them from `logo_shoho.png`'s figure; the wordmark is unreadable at icon size, so it is cropped out.
  - iOS tags: `apple-mobile-web-app-capable` and the touch icon.
- **Service worker:** Serwist 9.5 with `@serwist/turbopack` (Next 16 builds with Turbopack). Dev dependencies: `@serwist/turbopack`, `serwist`, `esbuild`; esbuild added to pnpm's `allowBuilds`.
  - Source `src/sw/sw.ts` with its own webworker tsconfig (`pnpm typecheck` checks both), served at `/serwist/sw.js`.
  - **Precache:** the app shell (Next static JS/CSS/fonts, brand images, icons) and `/bn|en/offline`.
  - **Models:** `/models/*` is cache-first; old versions are dropped on activate.
  - **`/api/*`:** network-only, ahead of Serwist's defaults, which would otherwise cache API GETs.
  - **Offline:** document requests fall back to the offline page in the URL's language.
  - **Disabled in `next dev`.** It never reloads on reconnect, which would cut a game short.
- **Install prompt** on the parent home:
  - Chrome's `beforeinstallprompt` is caught app-wide and offered as "Install app".
  - iPhone shows the Share → Add to Home Screen steps.
  - Hidden when installed or dismissed.
- **Phones:**
  - **Prefetch:** the models download in the background on the questionnaire (one at a time, low priority; skipped for demo screenings and Save-Data).
  - **"Call now":** flashes the screen once where `navigator.vibrate` isn't available (iPhone).
  - **Already in place since B6 (no change):** the wake lock during the games, and camera/mic starting only from a tap.
- **Strings:** bn + en for `demoBanner`, `offline`, `pwa.install`, `meta.pages.offline`. Uncertain Bangla is in `_review.md`.

### Docs and tools
- `docs/DEPLOY.md` (Render Blueprint, Vercel, address fix-up, seeding, redeploy, limits).
- `scripts/smoke_test.py <base-url>`, standard library only:
  1. health and login;
  2. a demo screening (questionnaire + 6 replayed tasks), then finalize;
  3. both reports;
  4. a share link opened without cookies;
  5. cleanup.
- Updated: CLAUDE.md (tree, commands, LLM cap), SCREENING_SPEC §4.1 (model downloads), `lib/cv/README.md`.

### Verified
- **API:** `ruff check`, `ruff format --check`, `pytest` (719 passed).
- **Web:** `pnpm lint`, `pnpm typecheck` (app + service worker), prettier, `pnpm test:cv` (8 passed), `pnpm build`.
- **Docker image on Postgres 17** (scratch containers, removed afterwards):
  - With `ENV=production` and missing variables, the container exits and names them.
  - With a full production config:
    - migrations, then the seed (5 accounts, 2 children; 0 on a second start);
    - 2 workers on `$PORT`, `/health` ok, `client-config` returns `PUBLIC_WEB_URL`;
    - login cookies `HttpOnly; SameSite=lax; Secure` with no `Domain`.
  - The per-IP limit returned 429 on the 31st login from one forwarded address, and 200 for a different one.
- **Smoke test passed twice on Postgres:**
  - directly against the API;
  - through `next start` and its `/api/v1` rewrite.
- **In Chrome against the production build:**
  - the service worker is active and controlling, with 82 precached entries;
  - all 7 MediaPipe files landed in the model cache while question 1 was open;
  - no `/api` response appeared in any cache;
  - banner and install card render on the parent home;
  - with the server stopped, an unvisited `/en/...` page showed the styled English offline page.

  The service worker and caches were unregistered afterwards, so `:3011` is clean for dev.
- **Not verified:**
  - an actual Render or Vercel deploy (no accounts from here);
  - Android install and vibration, iPhone Add to Home Screen and the flash;
  - the wake lock on a real phone;
  - `docker compose up --build` of the web image.
  - **Whether Vercel forwards the client IP in `X-Forwarded-For` on external rewrites.** If it doesn't, every visitor shares Vercel's address for the per-IP limit. Watch for unexpected 429s after deploying.

## B6 — Browser capture, setup check, calibration, activities (2026-10-17)

SCREENING_SPEC §4.1–§4.8 in the browser. The camera games now run end to end on top of B7's upload, skip and finalize endpoints. No API changes.

The spec gained "Browser details" notes in §4.1–§4.8 for what it left open:
- routes and the camera session
- the `noise_db` / `mean_luma` definitions
- device type
- face confirmation
- trial timings between calls
- replacement trials after "Something went wrong"
- the live-pointing tap
- the retry rule
- "Finish early"

OPEN_QUESTIONS #7 and #8 are noted.

### lib/cv (`apps/web/src/lib/cv/`, README there)
- **`features.ts`**, pure:
  - `yaw` / `pitch` from the facial transformation matrix
  - `nose_dx`, `iris_x/y`, `eye_open`, `iod`
  - the pose record with y scaled by height / width
  - child-face pick: tapped face tracked, else the smallest, else the lower
  - child-body pick, luma, RMS, percentile
- **`realtime.ts`**: the name game's look-away gate (no face or |yaw| > 30° for 1.5 s) and the Copy me retry rule. These only steer the games; scoring stays in Python.
- **`models.ts`**:
  - Lazy `@mediapipe/tasks-vision` 1.1.1: FaceLandmarker (2 faces, blendshapes, matrices) and PoseLandmarker lite (2 poses).
  - Lazy `@mediapipe/tasks-audio` 1.1.1: YAMNet.
  - GPU delegate with a CPU fallback.
  - WASM served from `public/mediapipe/`, copied by `scripts/copy-mediapipe.mjs` before `dev` / `build`. Models come from Google's storage or `NEXT_PUBLIC_MEDIAPIPE_MODEL_BASE`.
  - MediaPipe's `INFO:` stderr lines go to `console.info`.
- **`audio.ts`**: an AudioWorklet tap gives contiguous 50-ms blocks (RMS in dBFS) and 1-s YAMNet windows (top 3 classes).
- **`capture.ts`**:
  - `CaptureSession`: camera + raw mic, a ~15 fps loop, luma every 0.5 s, camera switching.
  - `TaskRecorder`: in memory only; builds the `TaskUpload` with `quality` and `device`.
  - Nothing is recorded or uploaded except numbers.
- **Tests:** `pnpm test:cv` (new; Node's test runner with type stripping, no new dependency): 8 tests for the matrix signs, mesh features, face/body pick, pose scaling, luma/RMS, the gate and the four retry rules.

### Web
- **Routes:** `/screening/[id]/activities/[task]` for `setup`, `calibration`, `name-call`, `point`, `copy`, `look`, `free-play` and `analysing` (the design's route map).
- **Camera session:** a `CaptureProvider` layout keeps one session across the games, holds a screen wake lock, and turns the camera off on leaving or at "analysing".
- **The Part 2 intro's camera button is live**; it says "Continue the games" once some are done. The "games are still being built" note became the privacy note.
- **Camera states** (design States K1–K3):
  - K1 explainer before the browser asks
  - K2 denied, with steps
  - K3 busy / not found / failed / models couldn't download
  - unsupported browser (with a separate "needs https" message)

  Each offers "See the result without the games" (questionnaire-only finalize, "less certain" note).
- **Setup check** (Screening Flow 06): live preview with face boxes, live checks (§4.2 thresholds), tap-to-confirm when two faces are in view, and a phone vs laptop/tablet choice. `?cvdebug=1` shows the raw numbers.
- **`TaskFrame`**, one small state machine per game: intro → running → uploading → done | error.
  - Start, Skip (the B7 skip endpoint) and Play again.
  - Stop (✕) returns to the intro.
  - "Send again" after a failed upload.
  - A per-game outcome card (done / less clear / not measured with the reason / skipped) and a list of every game with its status.
  - Calibration retries once by itself on `fallback`.
- **The games**, with child-facing stages full-screen (`Stage`, `Character` SVG with the handoff's poses, `Ball`, `Boat`):
  - **Calibration:** the star, left/centre/right/centre at 1.5 s, with a chime.
  - **Name game:** dark camera view with scrims; waiting → amber "Call now" with vibration → watching.
  - **Look where I point:** on-screen (6 balanced trials, engage/cue/window/reward per §4.5) or live (4 trials, tap the toy's side, "Say Look!").
  - **Copy me:** on-screen demonstration or live with a spoken 3-2-1; move strip, "your turn" ring, intro body check.
  - **Look & watch:** split screen, swaps at 20 s, with a tune.
  - **Free play:** 2-min ring timer, "in the picture" pill, Finish early.
- **Voice lines** use Web Speech when there's a voice for the page's language, else a chime (OPEN_QUESTIONS #8).
- **Copy:** all strings in bn and en under `activities.*`. Uncertain Bangla is in `messages/_review.md`.

### Verified
- **Checks:** `pnpm test:cv` (8 passed), `pnpm lint`, `pnpm typecheck`, prettier, `pnpm build`.
- **The sign check** (lib/cv/README.md):
  - Headless Chrome ran the real MediaPipe models on a fake-camera clip of MediaPipe's public test portrait: original, mirrored, and two synthetic turns.
  - `yaw` and `nose_dx` had opposite signs in all four views (e.g. 8.0° / −0.378 and −9.5° / +0.401), as §4.1 requires.
  - The GPU delegate loaded.
- **Full flows** in headless desktop Chrome (390 × 844, fake camera and mic) against a scratch database, as `parent@demo.bd`:
  - **Bangla, every game on screen:** setup → calibration (`ok`, went straight on) → name game → pointing → copy → look → free play (finished early) → analysing → result.
    - Uploads stored `calibration ok`, `gaze_preference ok`, `rtn inconclusive not_enough_valid_trials` (the still face never looked away, so every gate timed out and the calls were `facing`), and `imitation` / `free_play inconclusive body_not_visible` (no hands in the portrait).
    - The result showed a finalized screening.
  - **English:** skip from the intro (calibration, look), "Something went wrong" (toast, extra try), skip from the running stage, live pointing (4 taps → `joint_attention live ok`), live Copy me (countdown shown, `imitation live`). No horizontal overflow at 390 px on any page checked.
  - **Bangla, camera denied** (`--deny-permission-prompts`): the K2 page, then "See the result without the games" finalized a questionnaire-only screening and opened the result.
- **Fixed along the way:**
  - The camera picture was missing behind the dark stages (a positioning class clash).
  - The trial label wrapped.
  - MediaPipe's `INFO:` lines tripped Next's error overlay.
- **Not verified:**
  - A real person on a real webcam in desktop Chrome. The fake camera is a still photo, so the gate, real looks, real movements and the microphone's voice onset were never exercised by a moving child or a real voice.
  - **Android Chrome.** No device was available here. Phones need https for the camera: use `pnpm dev --experimental-https`, or a tunnel, and open the LAN address.
  - Web Speech in Bangla: headless Chrome has no voices, so the chime fallback was what ran.
  - Vibration, the wake lock, iOS Safari.
  - `docker compose up --build`.
- **Environment:**
  - The dev server left on :3011 by an earlier session couldn't compile the new route segment (every new page 500), so it was stopped and restarted on :3011 against a scratch API on :8011.
  - `uv` wasn't on PATH; the API venv was used directly.

## B7 — Finalize, reports, sharing, demo mode (2026-10-16)

SCREENING_SPEC §5–§7 and §9. B6 (browser capture) isn't built yet, so this phase also adds the §10 task-upload and skip endpoints that the camera and demo mode share. The demo parent can now:
- answer the questions
- play the demo games without a camera
- get a result
- print the parent report and the doctor report in Bangla
- share the doctor report by link or QR

Spec updated: SCREENING_SPEC §5 (web strings, where scoring runs), §7 (result screen, labels, report number, audiences, sharing details), §9 (demo mode), §10 (endpoint list, upload rules, errors); COMPANION_SPEC §15 (`screening_tasks.demo`, `report_shares.created_at`). OPEN_QUESTIONS #13 mostly resolved; #3, #10 and #14 noted; #18 added.

### API
- **Tables** (one migration): `screening_tasks` (one row per task, the calibration included, unique per screening; features only, never media) and `report_shares` (token stored as SHA-256). Deleting a screening removes both.
- **Uploads**:
  - `POST /screenings/{id}/tasks/{task}` takes frames, markers, audio events, `variant`, `device`, `quality` (`mean_luma`, `noise_db`) and `demo`.
  - It sorts the streams by time, scores the upload at once and returns the status. A calibration returns `ok` / `fallback`, so the browser can retry.
  - Uploading again replaces the task. `variant` is accepted only for joint attention and imitation (422 `invalid_variant`).
  - `POST …/tasks/{task}/skip`.
  - Uploads over 5 MB are refused from the Content-Length header before the body is read (413 `payload_too_large`, 411 `length_required`; `core/limits.py`).
- **Finalize** (`POST /screenings/{id}/finalize`):
  - It needs Part 1 complete, with no "Other" answer waiting for confirmation (409 `questionnaire_incomplete`).
  - It scores every stored task again from its features, with the final calibration (`core/screening_results.py`). A gaze task uploaded before a calibration retry is scored right.
  - Tasks never uploaded count as skipped, so a questionnaire-only screening gets a Low-confidence result.
  - It stores the `RiskResult` and `scoring_version`. The screening is then read-only.
- **Screening data**:
  - `GET /screenings/{id}` now includes the tasks and the result.
  - The home summaries carry `score` and `risk_class`.
  - The screening access dependencies moved to `core/screenings.py`, so the new reports router shares them.
- **Reports**:
  - `GET /screenings/{id}/report?audience=parent|clinician` returns the child, age at screening, informant, answers with their scores and verbatim "Other" text, capture quality, the class bands and weights from the config, the result, and a report number `SJ-{yymm}-{id}`.
  - Only the clinician audience gets the parent's note and the device.
  - It needs `read:screenings`, so approved specialists can read (audited) and teachers can't.
- **Shares**:
  - `POST /screenings/{id}/shares {expires_in_days: 1|7|30}` returns the token once.
  - `GET …/shares` lists them with status and views.
  - `DELETE /shares/{id}` revokes. It is by id because the parent's page can't show a token again.
  - The public `GET /share/{token}` counts each view. Errors: 404 `share_not_found`, 410 `share_revoked` / `share_expired`; a deleted child's link is gone too.
- **Demo**: `GET /demo/screening-tasks/{task}?profile=` (parents only) builds the B5 fixture as a ready-to-post upload, with plausible light and noise. Any `demo: true` upload marks the screening `is_demo`.
- **Tests**: 693 total (was 661; the forced-password-change test now also checks the 8 new routes, and the public share route is listed as public). 32 new tests cover:
  - questionnaire-only finalize
  - full demo screenings per profile through the endpoints (typical → Low/High confidence, elevated → High with the hearing-test recommendation, noisy → Low confidence)
  - calibration ok / fallback / skip and re-scoring at finalize
  - live joint attention
  - variant rules, time ordering, unknown fields, the 5 MB limit
  - read-only after finalize
  - permissions (an approved specialist reads but can't share or finalize; teachers and other parents can't read)
  - both report audiences and verbatim "Other" text
  - share hashing, expiry choices, view counts, revoke / expiry / unknown, deleted child
  - cascade delete

  Scoring coverage stays at 99%.

### Web
- **Result** (`/screening/[id]/result`, design Results R1–R4):
  - Demo banner.
  - Gauge (`ScoreGauge`) with the config's bands, `RiskBadge`, the class headline, "the score reflects early signs, not the chance of having autism", and the high-class support line.
  - "What this means" with "not a diagnosis".
  - What we noticed (top concerns with icon and source), what went well, next steps (the recommendation keys plus an everyday step), and a confidence note (level, low coverage, harder-to-measure and not-counted games with reasons, "not enough light" when `mean_luma` < 60).
  - Share is the primary action from Moderate up. Specialists and chat are shown as "coming soon" (B8).
  - Links to both reports, and the report number.
  - A finalized screening resumes here, and the home card shows its last result with the badge (and "Demo").
- **Share sheet** (S1–S3):
  - Expiry chips (24 h / 7 days / 30 days, default 30).
  - The link with Copy, WhatsApp and QR, and a note that it is shown only now.
  - The links made, with status and views, and "Close this link now".
  - The link made in this session is cached, so the reports' QR codes can reuse it.
- **Parent report** (`/screenings/[id]/report`, design Parent Report) and **doctor report** (`/screenings/[id]/clinician`, design Doctor Report):
  - A4 sheets with print CSS (`@page` A4, app chrome hidden, colours kept). "Download PDF" opens the print dialog.
  - The doctor report has its own language: English by default with a বাংলা toggle (`?lang=`), rendered through a nested intl provider fed that language's messages (`lib/i18n/report-messages.ts`).
  - Doctor report contents:
    - identifiers
    - score with a labelled band bar
    - confidence, floors and score components
    - main concerns and strengths (sourced Q07 / activity)
    - red flags and recommendations
    - the questionnaire table (critical tag, verbatim "Other" text with how it was mapped, concern, flag; flagged rows tinted)
    - the parent's note
    - activity cards (status, metrics, quality)
    - trial-level table, method and limits
    - QR to the online report
  - Parents can "Add a QR code" (makes a 30-day link); specialists don't get it.
  - The `(reports)` route group admits parents and specialists.
- **Public share page** (`/share/[token]`, not designed): no login, the doctor report with its QR (the link itself), "valid until", its own closed / revoked / not-found states, `noindex`.
- **Demo mode**:
  - `lib/screening/demo.ts`: a per-device switch with the profile, read safely from localStorage. `?demo=1` / `?demo=0` work on any parent page.
  - `/settings`: a gear in the header for parents. It holds the switch and profile cards.
  - On the Part 2 intro the camera step becomes "Play the demo games".
  - `/screening/[id]/activities/demo`: replays each task through the upload endpoint, then finalizes, with an "analysing" checklist. It resumes after an error.
- **Part 2 intro** also offers "See the result from my answers" (finalize, questionnaire only), with a note that it is less certain. Finalized screenings leave the intro for the result.
- **Copy and components**:
  - All copy in bn and en: `results`, `findings` (task sentences and a concern/strength sentence per item), `recommendations`, `share`, `report`, `demo`, `settings`, and the new error codes. Uncertain Bangla is listed in `messages/_review.md`.
  - New primitives named after the handoff: `RiskBadge`, `ScoreGauge`.
  - Domain and task icons moved to `components/screening/screening-icons.tsx`; `screeningIdFrom` moved to `lib/screening/`.
  - API types regenerated.

### Not done here / for later phases
- Browser capture, setup check and the camera task runners (B6). The camera button on the Part 2 intro stays disabled outside demo mode.
- Results chat and the specialist finder (B8); in-app sharing with a Shohojatri specialist (OPEN_QUESTIONS #10).
- A way for specialists to reach screening reports from their own UI (OPEN_QUESTIONS #18, B13). Seeding Rafi's past screening (CLAUDE.md §10) is left to B13's seed work.
- The printed QR code only exists for a link made in the same browser session: the API keeps a hash, by design.

### Verified
- **API checks**: `ruff check`, `ruff format --check`, `pytest` (693 passed). Scoring coverage is 99%. On a fresh DB: `alembic upgrade` → `downgrade -1` → `upgrade` → `check` (no drift), then `python -m app.seed`.
- **Web checks**: `pnpm lint`, `pnpm typecheck`, prettier, and `pnpm build` (production build passes; the parent pages that prerender work with the Suspense-wrapped `?demo=` reader).
- **Chrome walkthrough**: against a dev API (:8011) and web (:3011) on a scratch database with the seed and no OpenAI key, as `parent@demo.bd`. Part 1 for Rafi was filled through the API with worried answers; everything after it went through the UI, in Bangla:
  - `?demo=1` switched demo mode on.
  - "Play the demo games" ran the analysing view through all six uploads and finalize.
  - The result showed 86 / উচ্চ with the Demo banner and Bangla-digit findings.
  - The share sheet made a link (copy, WhatsApp, QR, list).
  - Both reports rendered. The doctor report also rendered in English, and in Bangla with `?lang=bn`.
  - Revoking the link turned the public page into "The parent closed this link".
  - Nuha took the questionnaire-only path in English (with `?demo=0`): Low, confidence "Limited" with the spec's copy.
  - As `doctor@demo.bd`, the doctor report opened without the QR button; shares and finalize returned 403, and the parent-only result route sent them to `/specialist`.
  - Nine new pages, in both languages, have no horizontal overflow at 390 px (measured in a 390 px iframe), and there were no console errors.
- **Printing**: headless Chrome's print-to-PDF (the print CSS, A4) produced:
  - the Bangla parent report: 2 pages
  - the Bangla doctor report: 4 pages
  - the English share page: 4 pages, with the QR code, link and expiry date

  Bangla shaping, colours and the Demo stamp all came out correctly. This led to two print fixes: headings no longer end a page, and there are no forced page breaks (the doctor report had a half-empty page).
- Fixed along the way:
  - The doctor report reused the parent's "your answers" wording for its confidence line and finding sources.
  - The Low "what this means" text mentioned games on a questionnaire-only result.
- **Not verified**:
  - The browser's own print dialog (opening it would have blocked the browser automation, so print output was checked with headless Chrome instead).
  - A real phone, and scanning the QR code with one.
  - The WhatsApp hand-off.
  - `docker compose up --build`.
- The Chrome extension's coordinate clicks didn't register on this page, so some buttons were pressed from page JavaScript instead; React handled those clicks normally.
- A broken `next dev` (every page 500) was left running on :3002 by an earlier session and stopped Next 16 from starting a second dev server in `apps/web`, so it was stopped.

## B5 — Scoring engine + fixtures (2026-10-16)

SCREENING_SPEC §4.3–§4.9, §5 and §6 as pure Python in `apps/api/app/scoring/`, plus synthetic sessions for every task. No endpoint calls the engine yet: B6 uploads tasks and B7's finalize runs it. Spec updated where it left choices open: §4.1 (sign conventions, pose `y` scaled by frame width, ears in the pose record, the marker vocabulary), "Scoring details" notes in §4.3–§4.8, §4.9 (when a task is `low`, inconclusive reasons), §5 (signatures, finding and recommendation keys), §6.1 (rounding), §6.4 (confidence), §6.5 (points, which findings can be strengths) and §9 (fixtures). OPEN_QUESTIONS #6 resolved; #7 noted.

### Engine
- **Config**: `config.yaml` now holds every activity and combine number from the spec: voice onset, calibration, each task's thresholds and windows, latency and episode bands, weights, classes, floors, the hearing-test rule, confidence and findings limits. It also holds the few values the spec leaves open: a 250 ms frame hold, 0.5 keypoint visibility, 3-frame smoothing, the 80% "low quality" presence, 5-s rocking windows. `config.py` validates it (every weight present, classes ascending to 100, bands ordered).
- **Inputs** (`inputs.py`): `Frame`, `Pose`, `Marker`, `AudioEvent` match §4.1, so B6/B7 can validate uploads with the same models.
- **Signals** (`signals.py`): all durations are time-based (a frame holds until the next, at most 250 ms, so dropped frames count as unseen). Also voice onset with a sliding 2-s baseline, and keypoint tracks.
- **Calibration** (`calibration.py`): `fit_calibration` fits gaze_x = a·yaw + b·iris_x + c by least squares, with the face-share and direction checks. It falls back to yaw / 25 (clamped) and gives the reason. The browser will upload the calibration recording as a task and retry on fallback.
- **Detectors**:
  - `detect_rtn`: gating by `pre_state`, t0 from onset or the +800 ms fallback, facing runs, latency bands, eye contact capped.
  - `detect_joint_attention(…, variant="on_screen"|"live")`: on-screen first look on calibrated gaze, with centre attention during engage; live head turn from a pre-cue baseline, direction from `nose_dx`.
  - `detect_imitation`: the four pose rules plus "attempt". The automatic retry keeps the best window.
  - `detect_gaze_preference`.
  - `detect_free_play`: FFT on resampled wrist and shoulder signals. Episode length is measured from the band-passed amplitude, because window edges overstated short bursts by about 1.5 s and let a 2.5-s sway pass the 4-s rocking rule.
  - Each detector returns trials typed by `kind`, quality (ok / low / inconclusive with a reason) and findings as i18n keys + params. "Something went wrong" excludes a trial or action. `skipped(task)` covers skipped tasks.
- **`combine()`**:
  - Weights renormalised over the questionnaire and the valid tasks; score rounded half-up.
  - Classes and both floors, each recorded as from → to.
  - The regression red flag; recommendation keys (class, regression, hearing test).
  - Confidence (OPEN_QUESTIONS #6).
  - Top 3 concerns ranked by points in the score.
  - Up to 3 strengths, critical domains first. Questionnaire "C" items, q19 and free play are never strengths.
  - The result is Pydantic and round-trips through JSON for storage.
- `ItemScore` gains `can_be_strength` (P items and q13).

### Fixtures
- `app/seed/screening_fixtures.py` simulates the browser's feature stream at ~15 Hz:
  - frame-time jitter and dropped frames
  - bursty face and pose loss
  - landmark noise
  - background noise and the parent's voice
  - a child whose head/eye split drifts over time, so the calibration fit is well-posed
  - smooth head turns with realistic latencies
  - pose trajectories for each action
  - free play with slow, irregular hand movement, reaches, oscillating wrists (flapping) and rocking shoulders
- Sessions are built from per-trial plans, so tests make their own edge cases. `fixture(profile, task)` gives the deterministic `typical`, `elevated` and `noisy` sessions for calibration, rtn, joint attention (both variants), imitation, gaze preference and free play.
- `scripts/make_fixtures.py` (`uv run python -m scripts.make_fixtures`) writes them as JSON task payloads to `apps/api/fixtures/screening/` (git-ignored, ~4 MB; the largest payload is 0.8 MB, under the 5 MB limit).
- New dependencies: `numpy` (FFT, least squares) and the dev dependency `pytest-cov`. scipy wasn't needed.

### Not done here / for later phases
- Report strings for the finding and recommendation keys (B7), and storing `mean_luma` / `noise_db` from the upload (B6/B7).
- Browser-only real-time values (setup-check thresholds, the rtn look-away gate, stimulus timings) aren't in `config.yaml`, because the scorer doesn't use them. B6 decides whether the API serves them.
- The thresholds are still heuristic (§11). The fixtures show the engine behaves as specified, not that the thresholds are right.

### Verified
- `ruff check`, `ruff format --check`, `pytest`: 653 passed (was 480; 173 new: every detector on every profile; the calibration fit and its three fallbacks; no valid trials → inconclusive for each task; t0 fallback; pre_state facing excluded; something-went-wrong exclusions; latency bands; each imitation rule × detected/attempt/none; retry keeps the best window; the follow-rate and geometric-share linear maps; episode counting, the 15-s rule and the 4-s rocking minimum; combine with missing/skipped tasks, renormalised weights, class boundaries 20/21, 45/46, 70/71 and half-up rounding, each floor rule alone and together, the hearing-test matrix, the confidence table, findings ranking and strengths; full screenings per profile; config validation).
- Coverage of `app/scoring`: **99%** (1224 statements, 8 missed, all defensive branches).

## B4 — Screening: child setup, consent, questionnaire (2026-10-16)

SCREENING_SPEC §1–§3 and the matching §10 endpoints. A parent picks or adds a child, accepts consent, and answers the questionnaire one question per screen. "Other" answers are read by AI and confirmed by the parent. Then they add a note and land on the Part 2 intro. Everything saves as they go and resumes after a reload. Spec updated: SCREENING_SPEC §2 (age, informant, one open screening, consent versioning), §3.2–§3.3 (storage, mapper options, fallback), §10 (endpoints, permissions); COMPANION_SPEC §3.2 (new "run a screening" row) and §15 (new columns). OPEN_QUESTIONS #4 and #14 partly resolved, #5 resolved, #17 added. CLAUDE.md §5 now names the confirmed default model.

### API
- **Items**: the 20 items from §3.2 are in `app/seed/questionnaire.yaml` (bn + en, domain, type, direction, critical, weight, min_age). `core/questionnaire.py` loads and validates them at runtime. There is no questionnaire table, so the API, the scoring and the tests always read the same version. A test checks the file against a hand transcription of the spec table.
- **Scoring** (`app/scoring/`, pure): `config.yaml` holds `scoring_version`, the age limits and every questionnaire number (frequency concern for P/C items, q19, the q13 age bands, the 80% coverage threshold). `score_questionnaire(answers, age_months, items, cfg)` returns Q, eligible and scorable counts, `low_coverage`, failed critical items, the regression red flag, the hearing answer and per-item rows. No endpoint calls it yet: B7's finalize will.
- **Tables** (one migration): `screenings` (COMPANION_SPEC §15 plus `informant`, `parent_note`, `questionnaire_completed_at`) and `screening_answers` (one row per item, plus `ai_mapping_json`). Deleting a screening removes its answers.
- **Endpoints**: `POST /screenings`, `GET /screenings/{id}`, `GET /children/{id}/screenings`, `DELETE /screenings/{id}`, `POST /screenings/{id}/consent`, `PUT /screenings/{id}/answers/{item}`, `POST …/answers/{item}/map-other`, `POST /screenings/{id}/questionnaire`.
- **Error codes**:
  - `screening_age_out_of_range`: outside 12–72 months.
  - `screening_in_progress`: includes the open screening's id.
  - `consent_required`, `consent_outdated`.
  - `invalid_option`, `other_needs_mapping`, `other_text_required`, `other_not_mapped`.
  - `questionnaire_incomplete`: includes the first item still open.
  - `screening_finalized`.
  - Items above the child's age return 404.
- **Permissions**: new `write:screenings` (parent only) in the permission table. Reads use `read:screenings`, so approved specialists can read (audited) and teachers get 403. The permission matrix test has the new row.
- **Consent**: the API stores the version of the text the web showed and accepts only versions in `CONSENT_VERSIONS`. The time of the first acceptance is kept.
- **"Other" answers**: `map-other` stores the words as a pending answer and returns `suggested`, `unclear` or `unavailable`. Confirming saves the card with the same words. The server sets `mapped_by_ai` (true when both the suggestion and the words are unchanged); the client can't set it. Without AI, or when the AI can't tell, the parent picks the closest card or "I can't choose" (`not_sure`, excluded from scoring).
- **`ai/llm.py`** (minimal, OPEN_QUESTIONS #4) is the only OpenAI caller:
  - It loads prompt files that start with a `version` header.
  - It makes one Structured Outputs call through the Responses API with `store=False`, a 20 s timeout and one retry.
  - It never logs the parent's text.
- **Answer mapper** (`ai/prompts/answer_mapper.md` + `ai/answer_mapper.py`): the JSON schema allows only the item's own option keys plus `unclear`, so the model can't return another item's card. The prompt treats the parent's text as data, not instructions.
- **New settings**:
  - `OPENAI_API_KEY`: empty → the fallback above.
  - `OPENAI_MODEL=gpt-6-luna`: OpenAI's current lightweight model, checked on developers.openai.com.
  - `OPENAI_REASONING_EFFORT=low`.
  - `OPENAI_TIMEOUT_SECONDS`.
  - docker-compose passes the key through.
- New dependencies: `openai`, `pyyaml` (`uv.lock` updated).
- **Tests**: 480 total (was 367). `conftest` clears `OPENAI_API_KEY`, so no test can reach OpenAI.
  - Scoring: age eligibility per band; not_sure and unconfirmed "Other" kept out of the denominator; every q13 age-band boundary; critical failures; concern-direction ("C") items; q19; q20 never scored; the 80% coverage boundary; config validation; YAML yes/no keys.
  - The item file against the spec table.
  - The mapper with the LLM mocked: the schema enum, `unclear`, failures, confidence clamping, how the input is wrapped.
  - API flows: age limits and notices; one open screening; delete; roles and auditing; consent; every invalid answer; map → confirm or change; the no-AI fallback; completion and the note; finalized screenings are read-only.

### Web
- Routes (design map): `/screening/new` (`?child=` preselects), `/screening/[id]` (resume), `/screening/[id]/consent`, `/screening/[id]/questions/[n]`, `/screening/[id]/note`, `/screening/[id]/activities` (Part 2 intro).
- **Details** (Screening Flow 02):
  - Pick a child, or add one inline (name, date of birth, sex), and choose who is answering.
  - Age notices update as the date changes. The screening is designed for 16–48 months. For 12–15 or 49–72 months a note says the result is less certain. Below 12 or above 72, a kind message shows and the button is disabled.
  - If the child has an unfinished screening, the page offers "Continue" or "Start over" (with a delete confirmation sheet).
- **Consent** (03): the four points, with a checkbox card and "Agree and continue". The sharing point is worded so it stays true when the care team includes a specialist.
- **Questions** (04a–c), one per screen:
  - Header: back, "Question n of 20", domain, progress bar, pause.
  - Answer cards from §3.1, with hints on the q13 cards. A card is saved as soon as it is picked.
  - "Other" opens a text box. Then either the AI card ("We understood this as **Sometimes** — is that right?", with the reason and Confirm / Choose another) or, without AI, "Which answer is closest?".
  - Revisiting a question shows the parent's words and the saved card, with "Change answer".
  - Domain icon tiles stand in for the illustrations until those arrive.
- **Note** and **Part 2 intro** (05): the games list, what you'll need, and "every game can be skipped". The camera step stays disabled, with a note that the games are still being built and the answers are saved, until B6.
- **Home**: "Start a screening" hero (01a). Each child card shows "Continue the screening · 8 of 20 answered" or "Questions done · games are next", or else "Start a screening" for that child.
- New primitives, named after the handoff: `Stepper` (segments), `ChoiceGroup` (with "Other (write)"), `ChipOption`. `ChoiceCard` gains `multi`. The B3 child form now uses `ChipOption` and the shared `lib/dates.ts`.
- All strings are in bn and en. The Bangla items and new labels are listed in `messages/_review.md`. Numbers use Bangla digits in bn.

### Verified
- API: `ruff check`, `ruff format --check`, `pytest` (480 passed). On a fresh DB: `alembic upgrade` → `downgrade -1` → `upgrade` → `check`, then `python -m app.seed`.
- Web: `pnpm lint`, `pnpm typecheck`, prettier. The API client types were regenerated from the app's OpenAPI.
- **UI walkthrough**. The Chrome extension wasn't connected, so the UI was driven through headless Chrome over the DevTools protocol at 390×844. It ran against a dev API (:8001) and web (:3002) on a scratch database with the seed and no OpenAI key.
  - **Bangla**, as the demo parent:
    - Home hero. Details with the "younger" notice (14 months), the blocked state (10 months, button disabled) and the informant error. Consent, with the button disabled until ticked.
    - Q1: a card. Q2: "Other" led to the no-AI "closest answer" screen, which survived a reload.
    - Q3 was picked without pressing Next; after a reload the flow resumed at Q4 with Q3's answer kept. Revisiting Q2 showed the words with the saved card.
    - All 20 answered, then the note and the Part 2 intro. Opening the screening again went to Part 2, and home showed "Questions done".
    - The API confirmed 20/20 answered, the note, and q02 stored verbatim with `sometimes`.
  - **English**, for Rafi: home, details, consent, Q1.
    - An AI suggestion was written into the dev DB in the shape `map-other` stores (there is no key here). After a reload the page showed the confirm card, and confirming saved `mapped_by_ai: true`.
    - Switching language on a question kept the place.
  - "Start over" deleted a screening through the proxy, and a new one could then be started.
  - No horizontal overflow on any page at 390 px, and no console errors.
  - Fixed along the way: the sticky footer let scrolled text show through behind the Part 2 note, and an empty footer covered the AI card's buttons.
- **`docker compose up --build`**: both images build. The API image's `uv sync --locked` passes, so the new lock is consistent. The API migrated an existing B2-era volume through B3 and B4 and seeded the demo children, and the web serves the screening routes.
- **Live OpenAI** (`gpt-6-luna`, through the running stack on :3000, as the demo parent), about 2.5 s per call:
  - A Bangla "Other" answer for q01 → `suggested: sometimes` (confidence 0.98), with a Bangla reason.
  - The same answer in English → `sometimes`, the reason still in Bangla (the parent's saved language).
  - An off-topic sentence → `unclear`, with a reason.
  - The test screening was deleted afterwards, so the demo data is clean.
- **Not verified:**
  - A real phone.
  - `uv sync` on this machine: uv isn't on PATH. Dependencies were installed into the existing `.venv`, and the lock was made with a venv-local uv (the Docker build's `uv sync --locked` covers the lock itself).
- A `next dev` left running on :3001 from an earlier session had crashed ("Jest worker … exceeding retry limit") and couldn't compile the new routes, so it was stopped.

## B3 — Children, Child ID, access requests, audit (2026-10-16)

COMPANION_SPEC §2 and §3: children with Child IDs, the request → approve/decline → revoke flow, one permission table behind `require_child_access`, an audit trail, and in-app notifications. Spec updated: §2 (code normalisation), §3.1 (enumeration-safe storage, withdraw), §3.2 (404 vs 403, parent actions audited, `can_add_logs`), §15 (`access_requests.child_code`, nullable `child_id`), §16 (new endpoints). OPEN_QUESTIONS #10 and #14 partly resolved; #16 added.

### API
- Tables (one migration): `children`, `access_requests`, `access_grants`, `notifications`, `audit_log`.
- **Child ID** (`core/child_codes.py`): `SJ-` + 5 Crockford base32 characters, random. Input is normalised (case, spaces, Bangla digits, with or without `SJ`, O→0 and I/L→1). No code body starts with `SJ`, so a mistyped `SJ-123` can't match a code. `POST /children/{id}/regenerate-code`: the old ID stops working for new requests, members keep access, and open requests stay open.
- `POST /children` (parent), `GET /children` (own children, or the children a member has a grant for), `GET /children/{id}`. Only the parent sees the code and the pending-request count.
- **Requests**: `POST /access-requests` always answers 202 `{"status":"sent"}`. Every request is stored, including those for codes that match no child (`child_id` NULL), so the requester's own list (`GET /access-requests`) doesn't reveal which IDs exist. Unmatched requests just expire. The limit is 10 per rolling 24 h and counts unmatched codes too; the 11th gets 429 `access_request_limit`. Repeating an open request is a no-op. A malformed code gets 422 `invalid_child_code` on the field. Requests expire after 14 days, evaluated lazily. The requester can withdraw a request (`/cancel`).
- **Deciding**: `GET /children/{id}/access-requests`, `POST /access-requests/{id}/approve {share_medications?, share_documents?}` and `/decline`. Defaults: teachers get neither; specialists get both, and for them medications can't be turned off (§3.2). Approving also closes any other open requests from the same person. A declined requester is told only the code they used. `PATCH /grants/{id}` changes the options; `DELETE /grants/{id}` revokes, and the next request is already refused.
- **Permissions** (`core/permissions.py`): `Need` enum (`read:profile`, `read:medications`, `write:clinical_notes`, `manage:access` …) × holder (parent / education / clinical), with grant flags for medications, documents and logs. `require_child_access(need)` for `{child_id}` routes; `authorize()` for routes keyed by a request or grant. No relationship → 404; missing permission → 403.
- **Audit**: every non-parent access the dependency allows is written to `audit_log` (verb → action, object → resource), including card reads in `GET /children`. Parent care-team actions are logged too. `GET /children/{id}/activity` (parent) folds same-person/same-thing/same-day repeats, covering 180 days.
- **Notifications**: request received (parent), approved and declined (requester). The payload holds parameters only, so the text is translated in the reader's language. `GET /notifications` returns items + unread count; `POST /notifications/{id}/read` and `/read-all`.
- `UtcDateTime` column type: SQLite returned naive datetimes, which were serialised without an offset (browsers read them as local time). All models use it now, and it converts aware values to UTC on write. `alembic/env.py` writes it into migrations as plain `sa.DateTime`. `alembic check` reports no drift.
- `core/dates.py`: `today_bd()` (Bangladesh date, regardless of server timezone) and `age_in_months()` (completed months, for B4's age gating too).
- Seed: Rafi (≈ 38 months, `SJ-7K3QX`, companion) and Nuha (≈ 20 months, `SJ-4M8TD`). For Rafi: doctor approved (clinical) and teacher approved (education, documents shared), with backdated history; a pending request from teacher2 with a Bangla message; an unread notification for the parent.
- Tests: 367 total (was 113). A 196-case matrix covers 13 viewer states × 15 permissions (parent owner, other parent, admin, and teacher/specialist with none, pending, revoked or approved grants, including non-default sharing), checked against a separate transcription of §3.2. The audit row is asserted on each case. Also covered: enumeration-safe responses and lists, the rate limit (rolling window, same answer for real and unknown codes), expiry, decide/withdraw/revoke/update flows, the activity feed, notifications, code normalisation, ages, and the seed. Tests use a cheap argon2 hasher; production parameters are unchanged.

### Web
- `/home` (parent): child cards with age, status, Child ID and "Care team" (with a pending badge). `/children/new`: name, date of birth, optional sex. Screening (B4) and the profile wizard (B9) build on this record.
- `/children/[id]/care-team` (parent, design Companion B6): Child ID panel (copy; share via the Web Share API or WhatsApp; QR sheet with save-as-PNG; get a new ID with confirmation); pending requests with scope switches and Approve/Decline; team list with permission tags, change-permissions and remove sheets; activity feed. Two columns on desktop, one on phones.
- `/teacher` and `/specialist`: request box (the confirmation reads the same whatever the code), approved child cards with scope, and their own requests with Withdraw. Not designed yet (handoff §1), so built from the primitives.
- `/request-access?code=` is what the QR code opens. Teachers and specialists land on their request box with the code filled in (after logging in, if needed). Others see a short explanation.
- Notification bell in the header (not for admins). Polls every 60 s; a new notification also refreshes children and requests, so an approval appears without a reload. On phones the logout label is screen-reader-only to make room.
- New primitives named after the handoff: `Sheet` (native `<dialog>`: bottom sheet on phones, centred on desktop), `Switch`, `Avatar`, `IconButton`, `ChildCard`, `TextAreaField` (the handoff's `TextField multiline`). Also `QueryView` (loading/error/empty for a query) and `ChildCode`.
- New dependency: `qrcode.react` 4.2.0 (small, no dependencies; B7's share sheet will reuse it).
- The placeholder `RoleHome` is removed. The parent layout uses the wide shell; single-column pages narrow themselves.
- All strings in `bn` and `en`; uncertain Bangla added to `messages/_review.md`.

### Verified
- API: `ruff check`, `ruff format --check`, `pytest` (367 passed), `alembic upgrade` → `downgrade -1` → `upgrade` → `check` on a fresh DB, and `python -m app.seed` twice (2 children, then 0).
- Web: `pnpm lint`, `pnpm typecheck`, prettier. In Chrome, against a dev API and web on :8001/:3001 with the seed:
  - parent home in Bangla (cards, Child IDs, pending badge, unread bell);
  - Rafi's care team: approved teacher2 with documents shared; the request moved into the team and the activity feed;
  - QR sheet;
  - removed a member, and the feed updated;
  - teacher2 opened the QR link and landed on `/teacher` with the code filled in; sending showed the neutral confirmation and a "Waiting" entry; Rafi appeared on her home; the approval notification showed in the bell;
  - English versions of the teacher and care-team pages;
  - no console errors.
  - The window couldn't be resized, so 390 px was checked by loading pages in a 390 px iframe and measuring horizontal overflow. The care team page overflowed by 31 px (fixed: `grid-cols-1`); all pages now fit.
- **Not verified:** Web Share / WhatsApp hand-off and QR save on a real phone; scanning the QR with a phone camera; `docker compose up --build`; `uv sync` (uv isn't on this machine's PATH, so commands ran through the existing `.venv`).

## B2 — Auth, roles, admin (2026-10-16)

Accounts for all four roles, forced first-login password change, and basic admin pages. Spec updated: COMPANION_SPEC §3.1 ("Accounts and passwords"), §15 (`refresh_tokens`), §16 (`PATCH /me`, admin temporary password). OPEN_QUESTIONS #15 resolved.

### API
- `users` per COMPANION_SPEC §15, plus `refresh_tokens` (first Alembic migration). Email is stored lower-cased and phone as `+8801XXXXXXXXX`. Login takes either one in a single field, and Bangla digits work.
- argon2 hashing. Passwords need ≥ 8 characters including a digit, the same rule the design's set-password checklist shows. When no account matches, login still runs a dummy hash check, so response time doesn't reveal which accounts exist. A deactivated account is only reported after the right password.
- **Sessions**: an access JWT (15 min, cookie path `/`) and a refresh JWT (30 days, cookie path `/api/v1/auth`), both `httpOnly` + `SameSite=Lax`. `Secure` is on via `COOKIE_SECURE`. Each refresh token's `jti` is stored, so logout, password change, temporary-password reset and deactivation revoke sessions. The refresh token isn't rotated: rotation would make two tabs refreshing at the same moment log each other out. Every request reloads the user, so deactivation takes effect immediately.
- `JWT_SECRET` (new in `.env.example`). If it's empty, the API uses a random key per process and logs a warning, so a fresh checkout still runs but sessions end on restart. docker-compose passes it through.
- **Forced password change**: the default `get_current_user` dependency refuses `must_change_password` users with 403 `password_change_required`. Only `GET /me` and `POST /auth/change-password` use the permissive variant, so every future endpoint is gated automatically. A test walks the OpenAPI schema and checks every non-public endpoint, so it also covers routes added in later phases. No current password is needed while replacing a temporary one, and the new password must differ from it.
- Role guard: `require_roles(...)` (`AdminUser` alias). It runs after the password-change gate.
- Admin: create specialist (verified, returns a one-time 12-character temporary password with no ambiguous characters), list, `PATCH {is_active}`, and `POST /admin/users/{id}/temporary-password` for manual resets of any non-admin (OPEN_QUESTIONS #15). Chamber location waits for the specialist directory (B8).
- `PATCH /me {preferred_locale}` remembers the language choice.
- Errors carry `detail.field` where a form field is at fault: `email_taken`, `phone_taken`, `invalid_email`, `invalid_phone`, `weak_password`, `identifier_required`, `organisation_required`, `wrong_password`, `password_unchanged`. Others: `invalid_credentials`, `account_inactive`, `not_authenticated`.
- Seed (idempotent): admin, parent, teacher, teacher2, doctor @demo.bd / `demo1234`. All names are fictional and the schools/clinic are labelled "Sample". The demo doctor is verified and has already changed their password. To show the forced change in a demo, create a specialist from the admin page.
- Tests: 96 total, covering sign-up/login/refresh/logout/change-password flows, cookie attributes, invalid tokens (expired, bad signature, refresh-as-access), role guards for every admin endpoint × role, the forced-change gate on every endpoint, deactivation, resets, identifier normalisation and the seed. The test DB is a fresh in-memory SQLite per test (StaticPool).

### Web
- Routes: `/login`, `/signup` (role choice) → `/signup?role=parent|teacher`, `/set-password`, `/home` (parent), `/teacher`, `/specialist`, `/admin`, `/admin/specialists/new`. The route groups `(auth) (parent) (teacher) (specialist) (admin)` each wrap their pages in a guard.
- Guards are client-side (`components/auth/gates.tsx`: `RequireRole`, `GuestOnly`, `PendingPasswordOnly`) and only decide what to show; the API enforces access. Logged-out users go to `/login?next=…`, and only same-app paths are accepted for `next`. A user who must change their password always lands on `/set-password`, and a wrong role goes to its own home. If the API is unreachable, the guards show an error with a retry.
- API client: on a 401 it refreshes the access cookie once (concurrent requests share one refresh) and retries. `useMe()` returns `null` when logged out instead of throwing. Logout does a full reload so no child data stays in memory.
- Language: sign-up stores the current locale. Logging in, or using the toggle while logged in, saves the choice. Opening `/` while logged in goes to your home in your saved language.
- Forms use react-hook-form + zod (both in the CLAUDE.md stack, added now). Client checks mirror the API's (password rule, BD phone). Server field errors appear on the matching input; other errors appear in an alert above the submit button.
- New `components/ui` primitives, named after the handoff: `Button` (+ `buttonClasses` for links), `TextField`, `ChoiceCard` (native radio), `Tabs` (pill, arrow keys), `Card`, `RoleBadge`, `StateView`. Screens follow Onboarding 02–04 copy and layout. Teacher/specialist/admin homes aren't designed (handoff §1), so they're plain placeholders.
- The landing page is now the splash with "Get started" / "Log in". The B1 API-status placeholder is removed. Page titles use `%s · সহযাত্রী`.
- `pnpm gen:api` now passes `--default-non-nullable false`, so request fields that have server defaults stay optional.
- Wordmarks copied from `design/assets/` to `public/brand/wordmark_{bn,en}.png`.

### Verified
- API: `alembic upgrade head`, `python -m app.seed` (twice: 5 created, then 0), `ruff check`, `ruff format --check`, `pytest` (96 passed).
- Web: `pnpm lint`, `pnpm typecheck`, prettier. In Chrome (desktop width), against a dev API and web on :8001/:3001:
  - wrong password shows a translated error;
  - admin creates a specialist (field validation, Bangla-digit phone) and the one-time password appears;
  - the specialist logs in with phone + temporary password, is forced to `/set-password`, can't reach `/specialist` until done, and the live rule checklist works;
  - after the change, the specialist home shows the verified badge, and the role guard bounces them off `/admin`;
  - the toggle saves `en`, and `/` reopens `/en/specialist`;
  - logged out, `/en/home` → `/en/login?next=%2Fhome`;
  - teacher sign-up in English: a duplicate email error shows on the email field, then success lands on `/en/teacher`;
  - refresh works through the Next rewrite with the path-scoped cookie;
  - admin re-issues a temporary password and deactivates/reactivates.
  - No console errors.
- **Not verified:** layout at 390 px (the Chrome window couldn't be resized again), `docker compose up --build` with this phase, and the 401 → refresh → retry path in the browser (the refresh endpoint and the API side are tested; the client retry was not exercised).

## B1 — Scaffold (2026-10-16)

Monorepo per CLAUDE.md §4. No product features yet: a Bangla placeholder landing page that checks the API.

### API (`apps/api`)
- FastAPI on Python 3.12 managed by uv. Settings via pydantic-settings (`DATABASE_URL`, `CORS_ORIGINS`); `.env.example` lists both.
- SQLAlchemy 2 engine/session (`app/core/db.py`) and declarative `Base` with a constraint naming convention (`app/models/base.py`). Alembic reads the URL from settings and uses batch mode so migrations work on SQLite. No migrations yet: the first arrives with the users table in B2.
- One error format for everything (`app/core/errors.py`): `ApiError` plus handlers for HTTP errors, validation errors and unhandled exceptions, all returning `{"error": {"code", "message_key", "detail"}}`. Validation errors list field locations and error types only, never the submitted values (they may be child data). `ErrorResponse` is documented as the `default` response on every `/api/v1` route, so the generated TS client types errors too.
- `GET /api/v1/health` runs `SELECT 1` and returns `{"status": "ok", "database": "ok"}`, or 503 `database_unavailable`. All API routes live under `/api/v1`, so "/health" in PROMPTS.md is `/api/v1/health`.
- CORS for `CORS_ORIGINS` with credentials (needed for the B2 cookies).
- `python -m app.seed` exists so the CLAUDE.md command chain runs; it seeds nothing until B2.
- ruff (lint + format) and pytest: 9 tests covering health, the DB-down error, CORS allow/deny, and every error handler.

### Web (`apps/web`)
- Next.js 16.4 (App Router, Turbopack, TypeScript strict), created with `create-next-app`. Its `cacheComponents` / `partialPrefetching` defaults are switched off: most pages will be per-user and cookie-driven, and plain dynamic rendering is simpler to reason about for the POC.
- Tailwind v4 with the **design handoff tokens** (OPEN_QUESTIONS #1): `src/styles/tokens.css` and `src/styles/theme.css` are copies of the handoff's `tokens.css` and `tailwind.v4.css`. Tokens are imported into the base layer so utilities always win. CLAUDE.md §7/§8 updated.
- Fonts: Hind Siliguri (body) and Baloo Da 2 (display), Bengali + Latin subsets, via `next/font/google` (self-hosted at build time; the first build needs internet).
- next-intl 4 with `[locale]` routing in `src/lib/i18n/`: `bn` default, `/` → `/bn`, Accept-Language detection off (Bangla-first). `src/proxy.ts` is Next 16's renamed middleware. Messages live in `messages/bn.json` and `messages/en.json`; message keys are type-checked, and `src/lib/i18n/messages-parity.ts` fails `pnpm typecheck` if the two files' keys differ. Uncertain Bangla strings are listed in `messages/_review.md`.
- `LanguageToggle` (`components/ui`, named as in the handoff) swaps the locale segment and keeps the path.
- TanStack Query provider. Typed API client: `pnpm gen:api` → `src/lib/api/schema.d.ts` (openapi-typescript, committed), `openapi-fetch` client, `unwrap()` that throws `ApiRequestError`, and `useErrorMessage()` that translates the API's `message_key` (unknown keys fall back to a generic message).
- The browser calls `/api/v1/*` on the web origin; `next.config.ts` rewrites it to FastAPI (`API_INTERNAL_URL`, default `http://localhost:8000`) so auth cookies stay first-party.
- Placeholder landing page based on the splash design (Onboarding 01): logo, promise line, "being built" note, live API status with a translated error and retry.
- ESLint (Next flat config + Prettier compat), Prettier, `pnpm typecheck` (`next typegen && tsc --noEmit`).
- Logo: `logo_shoho.png` isn't in the repo, so `design/assets/shohojatri-logo.png` was **copied** (not moved, since `design/` is read-only reference) to `public/brand/logo_shoho.png`, plus the English lockup as `logo_shoho_en.png`. The brand mark is the favicon (`src/app/icon.png`).
- `next dev` writes `apps/web/AGENTS.md`, which points coding agents at the Next docs bundled in `node_modules`. It's committed so the tree stays clean.

### Docker
- `docker-compose.yml`: `api` (migrates + seeds on start; SQLite on a named volume) and `web` (production build; the API address is a build arg because rewrites are compiled in). Postgres isn't wired up yet: set `DATABASE_URL` and add a driver when needed.

### Verified
- API: `uv sync && uv run alembic upgrade head && uv run python -m app.seed && uv run uvicorn app.main:app` starts; `ruff check`, `ruff format --check` and `pytest` pass.
- Web: `pnpm lint`, `pnpm typecheck`, `pnpm build` pass. With `pnpm dev` + API: `/` → 307 `/bn`; `/bn` and `/en` render with the right `<html lang>` and title; `/api/v1/health` is proxied to FastAPI. In Chrome, both locales render with the logo and Bangla fonts, the toggle switches locale, and stopping the API shows the translated "can't reach the server" message with a retry button.
- **Not verified:** `docker compose up --build`. The Docker daemon wasn't running, so only `docker compose config` was checked. Layout wasn't checked at a 390 px viewport (the browser window couldn't be resized).
