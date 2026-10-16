# CLAUDE.md — Shohojatri (সহযাত্রী) POC

Read this file fully before any work. Detailed behaviour lives in:
- `docs/SCREENING_SPEC.md` — questionnaire, camera/audio tasks, scoring, risk report
- `docs/COMPANION_SPEC.md` — child profile, roles & access, logs, context engine, chatbot, reminders

If code and spec disagree, the spec wins; if the spec is ambiguous, ask instead of guessing. Update the spec in the same change when a decision changes it.

---

## 1. What we are building

Shohojatri ("companion" in Bangla) is a **Bangla-first, bilingual (বাংলা / English) web app** that follows a child from the first developmental concern to long-term autism support. One child, one continuous record.

Two modules:

1. **Screening** — a parent answers a questionnaire and guides the child through short camera/microphone activities. MediaPipe extracts behavioural features in the browser; the backend scores them and produces a **developmental risk report** (one version for parents, one for doctors). Parents can ask the AI about the result and find nearby specialists.
2. **Companion** — after a diagnosis, the same child record becomes a living profile. Parents, approved special-school teachers and approved specialists log observations and progress; an AI context engine keeps an up-to-date understanding of the child; a chatbot (OpenAI, lightweight model) guides parents through therapy, schedules, home activities and can produce a status report at any time.

This is a **proof of concept for a pitch and early pilot conversations**. Optimise for: a complete, working end-to-end demo; clean, honest UX; code that can grow. Do not optimise for scale.

## 2. Non-negotiable product rules

1. **Never diagnose.** The app screens and supports. Every result screen and report says it is not a diagnosis. Never output "autism probability", "has autism", "is autistic" as a conclusion of the screening.
2. The screening number is a **"developmental concern score" (0–100%)**, mapped to classes (Low / Moderate / Elevated / High). Copy must make clear it reflects how many early signs were observed today, not the chance of having autism. Thresholds live in one config file (see SCREENING_SPEC §6).
3. **Raw video and audio never leave the device.** Only extracted numeric features are sent to the API. The consent screen says this, and the code must make it true.
4. The chatbot **never changes, starts or stops medication**, never contradicts a clinician's plan, and sends any urgent/safety concern to a professional. It answers only from the child's record and the curated activity library — it says so when it doesn't know.
5. **The parent owns the child profile.** Teachers and specialists see a child only after the parent approves their request, and the parent can revoke at any time. Every read/write of child data by a non-parent is audit-logged.
6. Respectful language: "autistic child" / "child with autism" both acceptable; never "suffering from", "cure", "normal life", "abnormal". Strengths are shown alongside concerns.
7. Bangla is the default locale. Every user-facing string goes through i18n — no hard-coded English in components.

## 3. Roles

| Role | How they get an account | What they can do |
|---|---|---|
| **Parent** | Self sign-up | Run screenings, own child profiles, approve/revoke access, log, upload documents, chat, reminders |
| **Teacher** (special school) | Self sign-up as teacher | Request access by Child ID; once approved: view profile (education scope), add logs, chat within scope |
| **Specialist** (licensed doctor/therapist) | Created by Admin with credentials; forced password change on first login | Request access by Child ID; once approved: full clinical scope, clinical notes, view screening clinician report |
| **Admin** | Seeded | Onboard/deactivate specialists, view audit log |

Exact scopes: COMPANION_SPEC §3.

## 4. Architecture

```
shohojatri/
├── CLAUDE.md
├── docs/                      # specs (source of truth for behaviour)
├── design/                    # Claude Design exports / handoff (read-only reference)
├── apps/
│   ├── web/                   # Next.js (App Router, TypeScript)
│   │   ├── public/brand/      # logo_shoho.png lives here
│   │   ├── messages/          # bn.json, en.json
│   │   └── src/
│   │       ├── app/[locale]/  # routes: (auth) (parent) (teacher) (specialist) (admin) share/
│   │       ├── components/    # ui/ (primitives), feature folders
│   │       ├── lib/api/       # typed API client (generated from OpenAPI)
│   │       ├── lib/cv/        # MediaPipe capture + per-frame feature extraction
│   │       └── lib/i18n/
│   └── api/                   # FastAPI
│       ├── app/
│       │   ├── main.py
│       │   ├── core/          # config, security, deps, audit
│       │   ├── models/        # SQLAlchemy models
│       │   ├── schemas/       # Pydantic schemas
│       │   ├── routers/       # auth, children, access, screening, reports, logs, documents, chat, reminders, specialists, admin
│       │   ├── scoring/       # pure-Python scoring engine + config.yaml  (no I/O, fully unit-tested)
│       │   ├── ai/            # llm.py (only place that calls OpenAI), prompts/, context_engine.py, retrieval.py
│       │   └── seed/          # demo data, questionnaire, activity library, sample specialists
│       └── tests/
├── scripts/smoke_test.py      # deployment smoke test (docs/DEPLOY.md)
├── render.yaml                # Render Blueprint: API (Docker) + Postgres, Singapore
└── docker-compose.yml         # api + web (+ postgres optional)
```

### Data flow — screening
Browser camera/mic → MediaPipe Tasks (in browser) → per-frame features at ~15 Hz + trial markers → `POST /screenings/{id}/tasks/{task}` → `scoring/` detects events and scores → `POST /screenings/{id}/finalize` → risk result + parent report + clinician report.

**Event detection and scoring are done in Python only** (single source of truth, testable). The browser does capture, per-frame feature extraction, and the small amount of real-time logic needed to run a task (e.g. "wait until the child looks away, then show *Call now*").

### Data flow — companion
Log / upload / questionnaire change → stored append-only → background job runs the **context engine** (LLM) → new version of `child_context` (structured JSON with source references) → used by chat, dashboard summary, status report.

## 5. Tech stack & conventions

**Frontend** — latest stable Next.js (App Router) + TypeScript (strict) · Tailwind CSS (tokens from §7) · shadcn/ui-style primitives (Radix) restyled with our tokens · `next-intl` with `[locale]` segment (`bn` default, `en`) · TanStack Query · react-hook-form + zod · Recharts · Leaflet + OpenStreetMap for the specialist map · `@mediapipe/tasks-vision` (FaceLandmarker, PoseLandmarker, HandLandmarker) and `@mediapipe/tasks-audio` (AudioClassifier) loaded lazily only on screening routes.

**Backend** — Python 3.12 · FastAPI · SQLAlchemy 2 + Alembic · Pydantic v2 · SQLite by default, Postgres via `DATABASE_URL` · argon2 password hashing · JWT access + refresh tokens in httpOnly cookies · `openai` SDK · numpy/scipy for signal processing · pypdf for PDF text · pytest.

**API** — REST, JSON, `/api/v1`. Generate the TypeScript client from FastAPI's OpenAPI schema (`openapi-typescript`); never hand-write request types twice. Errors: `{ "error": { "code": "...", "message_key": "errors.x", "detail": {...} } }` — the frontend translates `message_key`.

**LLM** — all OpenAI calls go through `apps/api/app/ai/llm.py`. Model from env `OPENAI_MODEL` (default `gpt-6-luna`, OpenAI's current lightweight model, confirmed against developers.openai.com in B4; `OPENAI_REASONING_EFFORT` defaults to `low`). Embeddings from `OPENAI_EMBED_MODEL` (e.g. `text-embedding-3-small`). Prompts are files in `app/ai/prompts/` with a version header. If `OPENAI_API_KEY` is missing, the app still runs: chat returns a clear "AI not configured" message and context updates queue up (except with `ENV=production`, which requires it). Each user has a daily call cap (`LLM_DAILY_CAP`, enforced in `llm.py`); past it, callers get `LLMQuotaExceededError` and fall back.

**Env** — `apps/api/.env.example` and `apps/web/.env.example` must list every variable. Never commit secrets.

**Code style** — small modules, typed everywhere, no dead code. Python: ruff + mypy-friendly. TS: eslint + prettier. Comments explain *why*. Keep scoring functions pure.

**Testing** — `pytest` for scoring (fixtures for clear-response, no-response and noisy/low-quality sessions), access control (every role × every child endpoint), and context-engine merge rules (LLM mocked). One Playwright smoke test per main journey once UI exists.

**Commands** (keep these working; update here if they change)
```
# api
cd apps/api && uv sync && uv run alembic upgrade head && uv run python -m app.seed && uv run uvicorn app.main:app --reload
uv run pytest
uv run pytest tests/test_scoring_*.py --cov=app/scoring   # scoring engine + coverage
uv run python -m scripts.make_fixtures   # synthetic screening sessions → fixtures/screening/*.json
# web
cd apps/web && pnpm i && pnpm dev
pnpm gen:api     # regenerate API client from http://localhost:8000/openapi.json
pnpm lint && pnpm typecheck
pnpm test:cv     # browser feature maths (lib/cv), Node's test runner
# deployment (docs/DEPLOY.md: Render Blueprint render.yaml + Vercel root apps/web)
python scripts/smoke_test.py <base-url>   # health → login → demo screening → reports → share link
# both, in containers (web :3000, api :8000)
docker compose up --build
```

## 6. Internationalisation (Bangla-first)

- Routes: `/bn/...` (default, redirect `/` → `/bn`) and `/en/...`. Language toggle in the header everywhere, remembered per user (`users.preferred_locale`).
- All strings in `messages/bn.json` and `messages/en.json`, same keys. Add both when adding any string. Bangla copy must be natural and simple (spoken register a parent in Dhaka or a district town would use), not a literal translation. Mark any string you are unsure of with a `// TODO(bn-review)` entry in `messages/_review.md`.
- Numbers and dates: `Intl.NumberFormat('bn-BD')` / `Intl.DateTimeFormat('bn-BD')` in `bn` (Bangla digits ০-৯); Latin digits in `en`.
- Content stored in the DB that needs both languages (questionnaire items, activity library, task instructions) has `_bn` and `_en` fields. User-written content is stored as written; the chatbot answers in the user's current locale.
- Fonts: a Bengali-supporting family (e.g. Hind Siliguri or Noto Sans Bengali) via `next/font`; Bangla line-height ≥ 1.6. Test every screen in Bangla — it runs longer than English.

## 7. Theme (from the logo — `public/brand/logo_shoho.png`)

**Tokens come from the design handoff** (`design/design_handoff_shohojatri/tokens/`), used since B1:
- `apps/web/src/styles/tokens.css` — copy of `tokens.css` (`--sj-*` brand/neutral/risk colours, semantic aliases like `--text-1`, `--surface-page`, type scale, spacing, radius, shadow, motion). Only change: font families point at `next/font` variables.
- `apps/web/src/styles/theme.css` — copy of `tailwind.v4.css`: Tailwind utilities map onto the tokens (`bg-navy`, `text-text-2`, `text-h1`, `rounded-pill`, `shadow-sm`, `bg-risk-high-bg` …). Tailwind's default palette is removed on purpose.
- Fonts: Hind Siliguri (body) + Baloo Da 2 (display) via `next/font/google`.
When the design changes, re-copy those files rather than editing values in components.

The brand colours (sampled from the logo):

| Token | Hex | Source / use |
|---|---|---|
| `--sj-navy` | `#004E8B` | wordmark — headings, primary text on light, primary buttons |
| `--sj-navy-deep` | `#003C78` | pressed states, dark surfaces |
| `--sj-blue` | `#1586BC` | parent figure — focus rings, secondary accents (links use `--sj-blue-ink` `#1373A3`) |
| `--sj-sky` | `#249CC0` | gradients, info states |
| `--sj-teal` | `#03B4BA` | child figure — companion module accent |
| `--sj-mint` | `#3ABEB1` | child head — success highlights, chips |
| `--sj-leaf` | `#47AC8D` | path/hills — progress, "improving" |
| `--sj-sprout` | `#8CC88A` | light green — backgrounds of positive states |
| `--sj-teal-deep` | `#0A7788` | text on teal surfaces |
| `--sj-amber` | `#F8B442` | the star — highlights, rewards, "Moderate" |

Mid-tone colours are fills only; text uses the `-ink` variants (≥ 4.5:1 on white).

Risk-class colours (calm, not alarming): `--sj-risk-{low,moderate,elevated,high}` (fill `#47AC8D` / `#F8B442` / `#E8833A` / `#C8553D`, each with `-ink` and `-bg`). Always pair colour with a label and icon (`RiskBadge`).

Feel: warm, calm, hopeful; soft rounded shapes like the logo; generous whitespace; mobile-first (parents and teachers on phones, specialists also on desktop). Brand gradient `navy → blue → teal → leaf` used sparingly (hero, report header).

## 8. UI workflow with Claude Design

The visual UI is designed in Claude Design, and the handoff is already in `design/` (see its `README.md` for the component list and screen → route map). Build in this order:
1. Phases B1–B13 (see `PROMPTS.md`, Track B) build the working app on the handoff tokens, creating the `components/ui` primitives with the handoff's names and props as each phase needs them.
2. Phase B14 is a fidelity pass against the designs **without changing behaviour, routes, or API contracts**.
Keep presentation in components and logic in hooks/services so the restyle is cheap. Component names should match the screen and component names in the design handoff where possible.

## 9. Privacy, safety & ethics checklist (check before finishing any feature)

- [ ] Endpoint checks role **and** child-level grant (`require_child_access(child_id, scope)` dependency), not just login.
- [ ] Non-parent access is written to `audit_log`.
- [ ] No raw media uploaded from screening; documents uploaded only by user action.
- [ ] Screening/report copy says "not a diagnosis" and recommends professional assessment where the class requires it.
- [ ] Chat/AI output is grounded in the record, cites source entries, and follows `ai/prompts/safety.md`.
- [ ] AI-extracted data (prescriptions, "Other" answers) is shown to the user to confirm before it is saved as fact.
- [ ] Both `bn` and `en` strings exist.

## 10. Demo data

`python -m app.seed` creates (password `demo1234` for all, POC only):
- parent `parent@demo.bd` with child **Rafi** (now ≈ 38 months): one completed screening from 4 months ago at ≈ 34 months (Elevated), a diagnosis entered afterwards, characteristics questionnaire, 3 months of logs from parent/teacher/specialist, a prescription, therapy schedule, reminders, two monthly check-ins.
- parent's second child with only a Low-risk screening (shows the "no concern" path).
- teacher `teacher@demo.bd` (approved for Rafi) and `teacher2@demo.bd` (pending request).
- specialist `doctor@demo.bd` (approved for Rafi), admin `admin@demo.bd`.
- sample specialist directory entries — **fictional, labelled "Sample"**. Do not invent real hospitals, doctors or phone numbers.

A **demo screening mode** (`?demo=1` or toggle in settings, parent role only) replays recorded feature fixtures for each camera task so the full screening → report flow works without a camera during a pitch.

## 11. Working agreements for Claude Code

- Work phase by phase from `PROMPTS.md`; finish a phase with passing tests and a short note in `docs/CHANGELOG.md`.
- Before writing a new module, read the relevant spec section. Don't invent questionnaire items, thresholds, scopes or prompts that the spec already defines.
- Prefer boring, well-known libraries. Ask before adding a heavy dependency.
- Don't put real personal data in seeds, tests, or logs. Don't log request bodies containing child data.
- When unsure about clinical wording, use the cautious option and flag it in `docs/OPEN_QUESTIONS.md`.
