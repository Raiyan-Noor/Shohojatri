# Deploying the pitch demo

Two hosts:

- **Render** (Singapore) runs the API (Docker) and Postgres. Its Blueprint is `render.yaml`.
- **Vercel** (function region `sin1`) runs the web app from `apps/web`.

The browser only ever talks to the Vercel domain. Next.js rewrites `/api/v1/*` to the API, so the auth cookies stay first-party.

```
browser ──https──▶ Vercel (Next.js, sin1) ──/api/v1/* rewrite──▶ Render API (Singapore) ──▶ Render Postgres
```

Both deployments are public. The demo banner asks visitors not to enter real children's data. Pages carry `noindex`. Login, sign-up and AI calls are rate-limited (see "Abuse protection" below).

## Before you start

You need:

- Accounts on GitHub, Render and Vercel. `render.yaml` uses Render's **free** plans; see "Free plan limits" below.
- This repository pushed to GitHub, with `render.yaml` at the root.
- An OpenAI API key. Production refuses to start without one.

### Pick your two addresses first

Each service needs the other's address:

- the API needs the web address for share links;
- the web app needs the API address for its rewrite.

So decide both names up front:

| | Name to choose | Address it gives |
|---|---|---|
| Vercel project | e.g. `shohojatri` | `https://shohojatri.vercel.app` |
| Render service | `shohojatri-api` (from `render.yaml`) | `https://shohojatri-api.onrender.com` |

If a name is taken, the host adds a suffix. Step 3 fixes that.

## 1. Render: API + Postgres from the Blueprint

1. Sign in at <https://dashboard.render.com>.
2. Click **New +** → **Blueprint**.
3. Connect GitHub if asked. Pick this repository and branch `main`.
4. Give the Blueprint a name (e.g. `shohojatri`). Render reads `render.yaml` and lists two resources:
   - web service `shohojatri-api` (Docker, Singapore);
   - database `shohojatri-db` (Postgres 17, Singapore).
5. Render asks for the two variables marked `sync: false`:
   - `OPENAI_API_KEY`: your OpenAI key.
   - `PUBLIC_WEB_URL`: the Vercel address you picked, e.g. `https://shohojatri.vercel.app` (https, no trailing slash).

   Everything else comes from `render.yaml`. `JWT_SECRET` is generated once, and `DATABASE_URL` is wired to the database.
6. Click **Apply** / **Deploy Blueprint**. The database comes up first, then the API image builds (about 3–5 min).
7. On every start the API container (`apps/api/scripts/start.sh`):
   - runs `alembic upgrade head`;
   - seeds the demo data, because `SEED_DEMO=true` (see "Seeding" below);
   - starts uvicorn with 2 workers and proxy headers on `$PORT`.
8. Open the `shohojatri-api` service:
   - **Events** shows the deploy as live once the health check passes.
   - Copy its address from the top of the page, e.g. `https://shohojatri-api.onrender.com`.
   - Open `<that address>/api/v1/health`. It should show `{"status":"ok","database":"ok"}`.

If the deploy fails straight away, open **Logs**. A missing or invalid production variable stops the API at startup with a message such as:

```
ConfigurationError: ENV=production but: OPENAI_API_KEY is required; PUBLIC_WEB_URL must be …
```

Fix it under **Environment**, then save. Saving redeploys.

## 2. Vercel: the web app

1. Sign in at <https://vercel.com>. Click **Add New…** → **Project**.
2. Import the same GitHub repository.
3. On the configure screen:
   - **Project Name**: the name you picked (e.g. `shohojatri`).
   - **Framework Preset**: Next.js (detected).
   - **Root Directory**: click **Edit**, choose `apps/web`, then **Continue**.
   - **Build and Output Settings**: leave the defaults. `pnpm build` downloads and checks the MediaPipe models and copies the WASM into `public/models`.
   - **Environment Variables**: add both of these for Production *and* Preview.

     | Name | Value |
     |---|---|
     | `API_ORIGIN` | the Render address from step 1.8, e.g. `https://shohojatri-api.onrender.com` (no trailing slash) |
     | `ENABLE_EXPERIMENTAL_COREPACK` | `1` (makes Vercel use the exact pnpm version in `package.json`) |
4. Click **Deploy** (about 2–4 min). `vercel.json` puts the functions in `sin1` (Singapore), next to the API.
5. Open the deployment's address. It should redirect to `/bn` and show the demo banner.

`API_ORIGIN` is compiled into the rewrites at build time. After changing it, redeploy (step 5 below).

## 3. Line the two addresses up

1. In Vercel, open **Settings** → **Domains** and note the production address.
2. If it differs from what you gave Render:
   - In Render, open `shohojatri-api` → **Environment**.
   - Set `PUBLIC_WEB_URL` to the real address and click **Save Changes**. The API redeploys.
3. If the Render address differs from what you gave Vercel:
   - Update `API_ORIGIN` in Vercel under **Settings** → **Environment Variables**.
   - Then redeploy (step 5).

## 4. Check it

From a checkout of this repository (Python 3.10+, no packages needed):

```
python scripts/smoke_test.py https://shohojatri.vercel.app
```

It runs the same flow through the web app, its rewrite and the API, against the real database:

1. `/health`;
2. logs in as `parent@demo.bd`;
3. runs a demo screening (questionnaire + replayed camera tasks) and finalizes it;
4. fetches the parent and doctor reports;
5. creates a share link and opens it without a login;
6. deletes the screening again (`--keep` leaves it).

Then by hand, on a phone:

1. Open the site in Chrome on Android and log in as `parent@demo.bd` / `demo1234`.
2. Check that the home shows **Install app**, and that installing it puts the সহযাত্রী icon on the home screen.
3. Start a screening and answer a few questions; the models download in the background meanwhile.
4. Open the games: the camera must only start after you tap the button.
5. In the name game, "Call now" vibrates on Android and flashes the screen on iPhone.
6. On iPhone (Safari), the home shows the Share → Add to Home Screen steps instead of an install button.

## 5. Redeploying

- **Code changes:** push to `main`.
  - Render redeploys the API only when something under `apps/api/` or `render.yaml` changed (`buildFilter`).
  - Vercel redeploys the web app on every push.
  - Migrations run automatically on each API start.
- **Render, by hand:** `shohojatri-api` → **Manual Deploy** → **Deploy latest commit**. After changing `render.yaml`, Render applies it when the Blueprint syncs; you can also sync from **Blueprints** → your Blueprint → **Manual Sync**.
- **Vercel, by hand:** **Deployments** → the latest one → **⋯** → **Redeploy**. Do this after changing any environment variable, since `API_ORIGIN` is read at build time.
- **API environment variables:** change them in Render under **Environment**. Saving redeploys the service.
- **Rotating `JWT_SECRET`** logs everyone out. Change it in Render (any random string of 32+ characters), then save.

## Seeding

- `SEED_DEMO=true` (the default in `render.yaml`) runs `python -m app.seed` on every API start. It is idempotent: it only creates what is missing, so nothing is duplicated or reset.
- To stop seeding, set `SEED_DEMO=false` in Render. Existing demo data stays.
- There is no Shell on the free plan. To re-seed, restart the service (**Manual Deploy** → **Restart service**) while `SEED_DEMO=true`.
- The seeded accounts all use the password `demo1234`. That is fine for a pitch demo only.

## Free plan limits

- **The API sleeps** after 15 minutes without requests, and the next request takes about a minute.
  - Before a pitch, open the site (or `<api address>/api/v1/health`) 2–3 minutes early, and keep it open.
  - An uptime pinger hitting `/api/v1/health` every 10 minutes keeps it awake. One always-on free service uses about 744 of Render's 750 free instance hours a month.
- **The free database is deleted 30 days after it is created.**
  - Render emails before it expires.
  - To keep the data, upgrade it in the dashboard (`shohojatri-db` → **Upgrade**, e.g. to `0.1c-256mb`) and change `plan:` in `render.yaml` to match.
  - Or let it go: create a new free database and redeploy. The API migrates and re-seeds an empty database on start.
- **One free database per workspace;** 512 MB RAM and a fraction of a CPU for the API.
  - Two uvicorn workers fit, but the first request after a deploy is slow.
  - If Render reports out-of-memory restarts, set `WEB_CONCURRENCY=1`.
- **Moving to paid** later: change both `plan:` values in `render.yaml` (web `0.5c-512mb`, database `0.1c-256mb`), push, and sync the Blueprint.

## Abuse protection

The deployment is public, so these are on by default. Each is a Render environment variable; `0` turns a limit off.

| Variable | Default | Effect |
|---|---|---|
| `LOGIN_ATTEMPTS_PER_IP` | 30 / 15 min | All logins from one address. |
| `LOGIN_FAILURES_PER_ACCOUNT` | 10 / 15 min | Wrong passwords for one account. Successful logins don't count, so a room full of people can share `parent@demo.bd`. |
| `SIGNUPS_PER_IP` | 10 / hour | New accounts from one address. |
| `LLM_DAILY_CAP` | 50 / user / day | OpenAI calls (Bangladesh day). Past it, AI features fall back as if unconfigured. |

- Counts live in Postgres, so they hold across both workers.
- Addresses and identifiers are stored only as SHA-256 hashes.
- Screening task uploads are capped at 5 MB.
- **Shared-IP caveat:** a whole room on one Wi-Fi shares one public address. If an audience of more than ~30 people logs in within 15 minutes, raise `LOGIN_ATTEMPTS_PER_IP` for the event.

## Where things are

| What | Where |
|---|---|
| Blueprint | `render.yaml` |
| API image and start | `apps/api/Dockerfile`, `apps/api/scripts/start.sh` |
| API settings and production checks | `apps/api/app/core/config.py`, `apps/api/.env.example` |
| Web rewrites, cache headers | `apps/web/next.config.ts` |
| Vercel region | `apps/web/vercel.json` |
| Service worker | `apps/web/src/sw/sw.ts` (built by `src/app/serwist/[path]/route.ts`) |
| MediaPipe files | `apps/web/scripts/mediapipe-assets.mjs`, `scripts/prepare-models.mjs` → `public/models/<version>/` |
| Smoke test | `scripts/smoke_test.py` |
