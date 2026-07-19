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

Physical paddles (motion sensors) detect a player's swings and grade their form. A coach station finishes each practice session and POSTs a summary to the backend. RacketCoach stores the sessions, shows progress over time, and lets players see improvement and resume where they left off.

## Architecture

This is a monorepo with a clean frontend / backend split.

```
  Coach station (paddle)
        |
        |  POST /api/session   (keyed by 6-char pairing code)
        v
  +-----------------------------+          +-----------------------------+
  |  backend/  (Hono API)       |          |  frontend/  (Next.js UI)    |
  |  runs on MODAL              | <------- |  server-side calls only     |
  |   - SQLite on a Volume      |  HTTP    |   - dashboard, charts       |
  |   - /api/session (board)    |  Bearer  |   - /pair QR                |
  |   - token auth (magic link) |  token   |   - session detail          |
  |   - sessions + pairings     |          |   - holds token in a cookie |
  +-----------------------------+          +-----------------------------+
```

- **`backend/`** is a standalone **Hono (TypeScript) API service** deployed on **Modal**. It owns the database, the board `/api/session` endpoint, auth, and all data access. SQLite lives on a Modal Volume, so there is no separate database account.
- **`frontend/`** is the **Next.js** UI. It never touches the database directly. It calls the backend over HTTP from server code, carrying the user's session token (kept in an httpOnly cookie). The browser never talks to the backend directly.
- **Auth is token-based.** The backend issues a signed session token on magic-link verify (or via the dev demo login). The frontend stores it in an httpOnly cookie and sends it as a Bearer token on server-side calls.

```
racketcoach/
├── backend/        # Hono API, deployed on Modal (owns the data)
│   ├── src/        # index, routes/, db/, auth, mailer, code
│   ├── scripts/    # migrate, seed
│   ├── drizzle/    # SQL migrations
│   └── modal_app.py
├── frontend/       # Next.js UI (calls the backend)
│   ├── app/        # pages + components
│   └── lib/        # api client, session, insights, format
└── README.md
```

## Local setup

Prereqs: Node 18+ and npm. Run the backend first, then the frontend.

### 1. Backend (terminal 1)

```bash
cd backend
npm install
npm run db:migrate      # create the SQLite schema
npm run db:seed         # demo user + 5 rising sessions + pairing code ACE123
npm run dev             # API on http://localhost:3001
```

### 2. Frontend (terminal 2)

```bash
cd frontend
npm install
cp .env.example .env.local     # defaults point at the local backend
npm run dev                    # UI on http://localhost:3000
```

Open http://localhost:3000. Use **Sign in as demo user** on the sign-in page (dev only) to land on the seeded dashboard. Real magic-link sign-in is wired too: enter an email, and in development the backend prints the sign-in link to its console (no email service needed). In production the link is sent through Resend.

## Environment variables

### backend/.env is read from the shell or Modal secrets

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | libSQL/SQLite URL. Local: `file:./racketcoach.db`. Modal: `file:/data/racketcoach.db`. |
| `AUTH_SECRET` | yes | Secret used to sign session + magic-link tokens. `openssl rand -base64 33`. |
| `PORT` | no | API port (default 3001). |
| `FRONTEND_URL` | yes | Frontend base URL, for magic-link redirects back to the UI. |
| `PUBLIC_BACKEND_URL` | yes | This backend's own public URL, used to build the magic-link verify URL. |
| `RESEND_API_KEY` | prod only | Resend API key. If unset, the sign-in link is logged to the backend console. |
| `EMAIL_FROM` | prod only | Magic-link sender, e.g. `RacketCoach <onboarding@resend.dev>`. |

### frontend/.env.local

| Variable | Required | What it is |
| --- | --- | --- |
| `BACKEND_URL` | yes | Backend API base URL (server-side only). Local: `http://localhost:3001`. Prod: your Modal URL. |
| `NEXT_PUBLIC_APP_URL` | yes | Public base URL of the frontend, used for the pairing QR code. Baked in at build. |

## Board API (on the backend)

The coach station calls this. No user login; the request is authorized by the pairing code. Keys come straight from the hardware and are not renamed.

`POST {BACKEND_URL}/api/session`

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

- Claimed code -> inserts a session for that user, returns `200`.
- Existing but unclaimed code -> returns `202`, stores nothing.
- Unknown code -> `404`. Invalid body -> `400`.

Sample call (after `npm run db:seed`, `ACE123` is claimed by the demo user):

```bash
curl -X POST http://localhost:3001/api/session \
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

- `/pair` shows a 6-character code and a QR encoding `NEXT_PUBLIC_APP_URL/pair?code=CODE`.
- Opening `/pair?code=CODE` while signed in claims that code for the current user (the frontend calls the backend to claim it).
- In a real session the coach station shows the QR, the player scans it on their phone, lands on `/pair?code=CODE` already signed in, and the paddle is linked.

## Deploy

### Backend -> Modal

```bash
cd backend
pip install modal
modal token new
modal secret create racketcoach-env \
  AUTH_SECRET=$(openssl rand -base64 33) \
  FRONTEND_URL=https://your-frontend-url \
  PUBLIC_BACKEND_URL=https://your-workspace--racketcoach-backend.modal.run
modal deploy modal_app.py
```

`backend/modal_app.py` runs the Hono API on Modal with the SQLite file on a Volume, pinned to a single container (`min_containers=1, max_containers=1`) because a Modal Volume does no file locking and SQLite must have one writer. Per-request concurrency comes from `@modal.concurrent`, not extra replicas. Migration and seed run on first boot.

> Note: the Modal deploy was not run from this repo (it needs `modal token new` on your account). The local run above is what has been verified. Treat the Modal deploy as yours to run.

### Frontend -> Vercel (or Railway / Render / Modal)

Deploy `frontend/` as a normal Next.js app. Set `BACKEND_URL` to your Modal backend URL and `NEXT_PUBLIC_APP_URL` to the frontend's own URL.

## Data model (backend SQLite)

- `user`: id, name, email, created_at
- `pairings`: code (pk), user_id (null until claimed), created_at
- `sessions`: id, user_id, played_at, good_reps, total_reps, best_streak, common_fault, avg_speed, created_at

Access is scoped in the API: a Bearer token identifies the user, and every read filters by that user. The board endpoint writes with a server-side connection keyed by pairing code.

## Design

Retro pixel-arcade theme: a halftone gradient background, a pixel display font for headings and the wordmark, a terminal font for stats, and clean white cards for readable data. Table tennis is the original arcade game, so the aesthetic fits.
