```
==================================================
  R A C K E T C O A C H
  the AI coach that lives on your paddle

   ()__
   |  o|>   . . . . . . . . . . . . . .   ( o )
   |__|
==================================================
```

# RacketCoach

RacketCoach is an AI table-tennis coach that lives on your paddle and tracks your form over time.

Physical paddles (motion sensors) detect a player's swings and grade their form. A coach station finishes each practice session and POSTs a summary to this web app. RacketCoach stores the sessions, shows progress over time, and lets players see improvement and resume where they left off.

## The flow

1. The coach station shows a QR code for a 6-character pairing code.
2. The player scans it on their phone, lands here already signed in, and the paddle is linked to their account.
3. After each practice, the coach station POSTs a session summary to `/api/session` using that pairing code.
4. The player opens their dashboard and sees form score, best streak, common faults, and a plain-language read on how they are improving.

## Stack

- **Next.js 16** (App Router, TypeScript) for the whole app, frontend and API routes in one codebase
- **SQLite** via **libSQL** (`@libsql/client`) with **Drizzle ORM**, a plain file, no separate database service
- **Auth.js v5** email magic-link sign-in
- **Recharts** for the progress charts
- **Tailwind CSS v4** with a retro, pixel-arcade look (fitting, since table tennis is basically Pong)
- **Modal** (modal.com) for hosting: the built Next.js server runs on Modal, with the SQLite file on a Modal Volume

### Why this shape

Everything lives in one place. The app is one Next.js deploy and the data is one SQLite file that sits on a Modal Volume, so there is no separate database account to manage. Local development uses a local SQLite file and needs zero external setup.

```
  Coach station (paddle)
        |
        |  POST /api/session   (keyed by 6-char pairing code)
        v
  +-------------------------------------------+
  |  Next.js app  (runs on Modal in prod)     |
  |    /            landing                   |
  |    /pair        QR pairing                |
  |    /dashboard   sessions + charts         |
  |    /session/:id one session breakdown     |
  |    /api/session board write endpoint      |
  +-------------------------------------------+
        |
        v
  SQLite file  ->  local: ./racketcoach.db
                   Modal:  /data/racketcoach.db  (on a Volume)
```

## Local setup

Prereqs: Node 18+ and npm.

```bash
# 1. install
npm install

# 2. create your env file (see the table below)
cp .env.example .env.local

# 3. create the database schema
npm run db:migrate

# 4. seed a demo user with 5 rising sessions so the charts look real
npm run db:seed

# 5. run it
npm run dev
```

Open http://localhost:3000.

For a fast look at the product, use the **Sign in as demo user** button on the sign-in page (dev only). It signs you into the seeded account so the dashboard and charts render immediately. Real magic-link sign-in is also wired: enter an email, and in development the sign-in link is printed to your terminal (no email service required). In production the link is sent through Resend.

## Environment variables

Put these in `.env.local`. An `.env.example` is included.

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | libSQL/SQLite URL. Local: `file:./racketcoach.db`. On Modal: `file:/data/racketcoach.db`. |
| `AUTH_SECRET` | yes | Auth.js session secret. Generate with `npx auth secret` or `openssl rand -base64 33`. |
| `AUTH_URL` | dev | Base URL Auth.js runs at, e.g. `http://localhost:3000`. |
| `NEXT_PUBLIC_APP_URL` | yes | Public base URL used to build the pairing QR code, e.g. `http://localhost:3000`. Baked in at build time. |
| `RESEND_API_KEY` | prod only | Resend API key for sending magic-link emails in production. If unset, the link is logged to the server console instead. |
| `EMAIL_FROM` | prod only | Sender for magic-link emails, e.g. `RacketCoach <onboarding@resend.dev>`. |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server. |
| `npm run build` | Production build. |
| `npm run start` | Start the production server. |
| `npm run db:migrate` | Apply the schema to `DATABASE_URL`. |
| `npm run db:seed` | Insert the demo user, a claimed pairing code (`ACE123`), and 5 rising sessions. |

## Board API

The coach station calls this. No user login is involved. The request is authorized by the pairing code.

`POST /api/session`

Body (these keys come from the hardware and are not renamed):

```json
{
  "pairingCode": "ACE123",
  "date": "2026-07-18T18:30:00.000Z",
  "goodReps": 71,
  "totalReps": 100,
  "bestStreak": 18,
  "commonFault": "late paddle",
  "avgSpeed": 12.4
}
```

Behavior:

- If `pairingCode` maps to a claimed user, a session row is inserted for that user and the endpoint returns `200`.
- If the code exists but is not yet claimed, nothing is stored and the endpoint returns `202` (the board can keep sending; sessions start landing once a player claims the code).
- Invalid bodies return `400`.

Sample call (after `npm run db:seed`, the code `ACE123` is claimed by the demo user):

```bash
curl -X POST http://localhost:3000/api/session \
  -H "Content-Type: application/json" \
  -d '{
    "pairingCode": "ACE123",
    "date": "2026-07-18T18:30:00.000Z",
    "goodReps": 82,
    "totalReps": 100,
    "bestStreak": 21,
    "commonFault": "late paddle",
    "avgSpeed": 13.1
  }'
```

Refresh `/dashboard` and the new session appears.

## Pairing flow

- `/pair` shows a 6-character code and a QR code that encodes `NEXT_PUBLIC_APP_URL/pair?code=CODE`.
- Opening `/pair?code=CODE` while signed in claims that code for the current user.
- In a real session the coach station shows the QR, the player scans it on their phone, lands on `/pair?code=CODE` already signed in, and the paddle is linked.

## Deploy to Modal

The whole app runs on Modal as a single web server, with the SQLite file persisted on a Modal Volume. The Modal wrapper lives in `modal_app.py`.

> Note: these steps run against your own Modal account and were not executed from this repo. Run them yourself. Everything above (local run, seed, board POST, pairing) is what has been verified locally.

```bash
# 1. install the Modal CLI and sign in (opens a browser)
pip install modal
modal token new

# 2. store the runtime secrets Modal will inject (AUTH_SECRET, etc.)
modal secret create racketcoach-env \
  AUTH_SECRET=your-secret \
  DATABASE_URL=file:/data/racketcoach.db

# 3. hot-reload dev against Modal (optional)
modal serve modal_app.py

# 4. deploy
modal deploy modal_app.py
```

How the Modal wrapper is set up (see `modal_app.py`):

- Base image `node:20-slim` with Python added, app files copied in with `copy=True`, then `npm ci` and `npm run build` run at image build time.
- `NEXT_PUBLIC_APP_URL` is set at build time (it is baked into the client bundle), so it is passed into the build step, not just runtime.
- A Volume is mounted at `/data`, and `DATABASE_URL` points at `file:/data/racketcoach.db`. Migration and seed run on first boot.
- The container runs `next start -H 0.0.0.0 -p 3000` and is exposed with `@modal.web_server(3000, startup_timeout=120)`.
- The function is pinned to a single container (`min_containers=1, max_containers=1`). This matters: a Modal Volume does no file locking and is last-write-wins, so SQLite must have exactly one writer. Per-request concurrency comes from `@modal.concurrent`, not from extra replicas.

If you later outgrow single-container SQLite, swap `DATABASE_URL` to a hosted libSQL/Postgres. The app code does not change.

## Data model

SQLite tables via Drizzle:

- Auth.js tables (`user`, `account`, `session`, `verificationToken`). The `user` table is the player profile.
- `pairings`: `code` (pk), `user_id` (null until claimed), `created_at`.
- `sessions`: `id`, `user_id`, `played_at`, `good_reps`, `total_reps`, `best_streak`, `common_fault`, `avg_speed`, `created_at`.

Access is scoped in the query layer: a signed-in user only ever reads their own sessions, and the board endpoint writes with a server-side database connection keyed by pairing code.

## Design

The look is a retro, pixel-arcade theme: a halftone gradient background, a pixel display font for headings and the wordmark, a terminal font for stats and labels, and clean white cards for the readable data. Table tennis is the original arcade game, so the aesthetic fits the product.
