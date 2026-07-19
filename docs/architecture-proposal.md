# RacketCoach — Architecture Proposal & Cleanup Plan

> **For Claude Code:** this document is the source of truth for the cleanup and the
> session-analysis pipeline. Work through Part A in order (items are independent —
> land them one at a time), then Part B. Do not restructure beyond what is written
> here; the app is ~1,500 lines and the current architecture is sound. Some files
> are actively being written — prefer small, single-purpose commits over a big-bang
> refactor. Verify each item against its acceptance check before marking it done.
>
> *Written 18 Jul 2026, from a full review of the working tree (including
> uncommitted work) plus the hardware/pipeline decisions below.*

## Context

RacketCoach is a monorepo: `backend/` (Hono + Drizzle + SQLite on a Modal Volume,
single container because SQLite is single-writer) and `frontend/` (Next.js, pure
HTTP client, session token in an httpOnly cookie, browser never calls the backend).
This split is correct and stays.

**Hardware pipeline (decided):** paddles are WiFi + battery (not ESP-NOW). The
paddle streams sensor data to the motherboard (coach station). The motherboard
gives **live feedback locally** (reflex layer — heuristics, no cloud, latency
budget ~100–200ms). At session end the board produces a **raw sensor file + a
session JSON**. Those are uploaded to the backend, which runs the **analysis
layer**: Claude interprets the JSON, Linkup fetches sourced drills for the
diagnosed fault, and the enriched session is saved and shown on the web app.

```
paddle ──WiFi──► motherboard ──► live feedback (local heuristics, instant)
                     │
                     └─► session end: raw file + session JSON
                              │ POST /api/session (multipart, pairing code)
                              ▼
                        backend (Modal)
                          ├─ raw file → Volume /data/raw/{sessionId}
                          ├─ analyzer: Claude interprets JSON
                          ├─ analyzer: Linkup /search → sourced drills
                          └─ session row saved with analysis + drills
                              │
                              ▼
                        frontend dashboard / session page
```

**Key placement (decided):** ALL third-party keys (Anthropic, Linkup, Resend) live
server-side in the Modal secret `racketcoach-env`. The Anthropic key currently in
the device firmware's gitignored `secret.h` is a temporary hackathon measure — it
must be a dedicated, spend-capped key, and the target state is that the device
holds **no** third-party keys: the board only talks to our backend. Claude Code:
never introduce a third-party API call on the device side; route it through the
backend.

---

## DEPLOY GATE — cc2: do not deploy until all four pass (verified by cc1 review)

Ordering for the team: **A1 commit → this gate → deploy → Part B → remaining
Part A refactors.** The gate items, each confirmed against the code:

1. **A2 — demo-login auth bypass (must not ship).** `modal_app.py` sets no
   `NODE_ENV`, and `/api/auth/demo` (+ frontend `/api/dev-login`) only blocks
   when `NODE_ENV === "production"`. Deployed as-is, anyone can mint a valid
   session token. Fix per A2; verify deployed `/api/auth/demo` returns 403.
2. **A4 (partial) — AUTH_SECRET fail-fast, unconditional.** `auth.ts` falls
   back to a hardcoded public secret if `AUTH_SECRET` is unset (forgeable
   tokens, silently). Fix: **always** require `AUTH_SECRET` — throw on
   startup if missing, in every environment, no is-production detection
   (that's what keeps this gate independent of `NODE_ENV`). Dev sets it in
   `.env`; Modal sets it in the `racketcoach-env` secret — verify it's there
   and strong before deploy. (Full A4 config module can come later; this
   guard cannot.)
3. **Seed gate (new — A15).** `modal_app.py` runs `db:seed` on every container
   start, and `seed.ts` DELETES the demo user's sessions, re-inserts fake
   ones, and re-arms pairing code `ACE123` on every run. In production this
   repeatedly wipes/rewrites data and re-creates known credentials. Gate the
   seed behind an explicit `SEED_DEMO=1` env var that is absent from the
   Modal secret. **Accept:** a container restart against a non-empty DB
   changes nothing.
   *Demo-data consequence:* with the seed gated, the prod DB boots EMPTY —
   no demo user, no `ACE123`, blank dashboard. For demo day, load history
   through the front door instead: a small script
   (`backend/scripts/demo-data.sh`) that claims a pairing code and POSTs
   5 rising sessions via the public board API (`/api/session`). That uses
   the real contract (doubles as a board rehearsal), needs no prod-DB
   access, and is run once, deliberately, by a human.
4. **A9 — pairing hijack.** `pairings.ts` upserts `userId` unconditionally;
   any signed-in user can take over any claimed code. Apply the 409 fix
   before real users pair paddles.

A11 timing (agreed between reviewers): not a deploy blocker, but a **demo
blocker** — land it before demo day. Confirmed real in `lib/api.ts` (every
failure maps to `[]`/`null`), so a transient backend hiccup mid-demo renders
a lying "No sessions yet" on the dashboard money-shot. The fix is cheap:
401 → redirect to signin, other failures throw, plus `app/error.tsx`.
Order: deploy gate → deploy → A11 → Part B.

---

## Part A — Cleanup (do first, in this order)

### A1. Commit the in-flight restructure  🔴 do before anything else
The frontend/backend split is half-committed: ~40 renames staged, the entire new
`backend/` and `frontend/lib/api.ts`, `lib/session.ts`, new auth API routes are
untracked. Commit it all as **one commit** so rename history is preserved and the
WIP has a safety net.
**Accept:** `git status` clean except intentionally ignored files.

### A2. `NODE_ENV=production` in the Modal image  🔴 security
`/api/auth/demo` (backend) and `/api/dev-login` (frontend) are gated on
`NODE_ENV === "production"`, but `backend/modal_app.py` never sets `NODE_ENV` —
deployed as-is, anyone can mint a demo-user token.
**Canonical fix (agreed by both reviewers): decouple ALL gates from
`NODE_ENV`.** The backend runs on `tsx` (a devDependency), and
`NODE_ENV=production` before `npm ci` skips devDependencies — the container
never boots. Rather than sequencing around that, the gates use explicit env
flags that build tooling can't break:
- Backend `/api/auth/demo`: enabled ONLY when `ALLOW_DEMO_LOGIN=1` is set.
  The flag is present in local dev `.env`, ABSENT from the Modal secret.
- (Frontend `/api/dev-login` may keep its `NODE_ENV` check — Vercel sets
  `NODE_ENV=production` automatically and there is no npm-ci collision there.)
- If `NODE_ENV=production` is still wanted on the backend image for library
  hygiene, it must go in a SECOND `.env()` call AFTER `.run_commands("npm ci")`
  — never in the pre-install env. Optional either way; no gate depends on it.
**Accept:** deployed `/api/auth/demo` returns 403 AND the deployed service boots.

### A3. Delete stale files
- Root `.env.example` — still documents the old Auth.js monolith (`AUTH_URL`,
  `npx auth secret`). The real docs are `backend/.env.example` and
  `frontend/.env.example`.
- `frontend/public/{file,globe,next,vercel,window}.svg` — create-next-app
  boilerplate, referenced nowhere.
**Accept:** files gone; app builds.

### A4. Backend `src/config.ts` — one env module, fail-fast
`process.env` is read in six files. `AUTH_SECRET` silently falls back to
`"dev-insecure-secret-change-me"`; URL vars fall back to localhost. Create
`src/config.ts`: read every env var once, validate with zod (already a dep),
**throw on startup** if production is missing `AUTH_SECRET` (and, once Part B
lands, `ANTHROPIC_API_KEY` / `LINKUP_API_KEY`). Nothing else imports
`process.env`.
**Accept:** `grep -r "process.env" backend/src --include="*.ts"` only matches `config.ts`.

### A5. `requireAuth` middleware
The Bearer-token + 401 dance is copy-pasted 5× (`routes/sessions.ts` ×2,
`routes/pairings.ts` ×2, `routes/auth.ts` /me). Add
`src/middleware/requireAuth.ts` (Hono `createMiddleware`, sets `c.var.userId`);
routes read `c.get("userId")`.
**Accept:** `userIdFromAuthHeader` is called in exactly one place.

### A6. Split `src/auth.ts`
It mixes HMAC token crypto with user persistence. Split:
- `src/tokens.ts` — sign/verify + session/login token helpers. No `db/` imports.
- `src/db/users.ts` — `upsertUserByEmail`, `getUserById`.
**Accept:** `tokens.ts` imports nothing from `db/`; all callers updated; `auth.ts` deleted.

### A7. Central error handler
Add `app.onError` in `src/index.ts` returning the same envelope the routes use
(`{ error: ... }`), and log the cause. Today a Drizzle failure leaks Hono's
default 500 text. While here: standardize — `sessions` routes return bare rows,
others wrap; pick one shape.
**Accept:** a forced DB error returns the JSON envelope, not plain text.

### A8. Rename `routes/session.ts` → `routes/board.ts`
Three things are called "session": `routes/session.ts` (board write),
`routes/sessions.ts` (user reads), `frontend/lib/session.ts` (cookie). Rename the
board route file; **the mount path `/api/session` does not change** (hardware
contract).
**Accept:** file renamed, `index.ts` mounts `boardRoute` at `/api/session`, curl
example in README still works.

### A9. Pairing claim: block paddle hijack
`POST /api/pairings/claim` upserts `userId` unconditionally — any signed-in user
can silently take over a code already claimed by someone else. Change: claim
succeeds if the code is unclaimed or already yours; `409` if it belongs to
another user.
**Accept:** claiming another user's code returns 409; unclaimed and re-claiming
your own still succeed.

### A10. Frontend `requireUser()`
`dashboard`, `session/[id]`, and `pair` each repeat the 8-line token→redirect,
`getMe`→redirect guard. Add to `frontend/lib/session.ts`:
`export const requireUser = cache(async () => {...})` returning `{ token, user }`
or redirecting to `/signin`. `cache()` dedupes `/me` within a request.
**Accept:** no page calls `getSessionToken`/`getMe` directly for guarding.

### A11. Frontend: stop swallowing errors
`lib/api.ts` maps every failure to `[]`/`null` — a backend outage renders as
"No sessions yet" (a lying empty state). Change: on 401 redirect to `/signin`;
on other failures `throw`. Add `frontend/app/error.tsx` (+ `loading.tsx` for the
dashboard).
**Accept:** with the backend stopped, the dashboard shows an error state, not the
empty state.

### A12. Small backend items
- `npm uninstall resend` in `backend/` — `mailer.ts` uses raw `fetch`; the
  package is a phantom dependency. Keep the fetch implementation.
- Rename `src/code.ts` → `src/pairingCode.ts`, or inline into
  `routes/pairings.ts` (its only consumer).
- Zod v4: `z.string().email()` is deprecated → `z.email()`.

### A13. Small frontend items
- `frontend/lib/config.ts`: `APP_URL`, `BACKEND_URL`, cookie `MAX_AGE` are each
  duplicated across 2–3 files; define once. Cookie options object defined once
  next to `SESSION_COOKIE`.
- Note (accepted risk): `/pair?code=X` claims during GET render — required by the
  QR flow. A9 caps the damage. Optional hardening: confirm button + server action.

### A14. Tests (minimal, targeted)
Add `vitest` per package. Test only the pure logic: `frontend/lib/insights.ts`,
`backend/src/tokens.ts` (after A6), and the board endpoint's zod validation.
No placeholder test folders for anything else.
**Accept:** `npx vitest run` passes in both packages.

### Deferred (do NOT do now)
- No `services/` layer beyond `analyzeSession` (Part B). No npm workspaces /
  shared types package yet — keep the `// keep in sync with backend/src/db/schema.ts`
  comment on `ApiSession` in `frontend/lib/api.ts`. No splitting of `ui.tsx`.

---

## Part B — Session analysis pipeline (Claude + Linkup on Modal)

This is the hackathon-prize work: "best use of Modal" and the Linkup prize.
The pitch: *paddle senses, motherboard reacts, Modal thinks, Claude explains,
Linkup proves it.* Every piece below runs **server-side** — no keys on devices.

### B1. Schema: enrich `sessions`
Add nullable columns (Drizzle migration):
- `durationSeconds` integer — how long the session ran. The coach station is
  the source of truth: it stamps session start (first swing or round start)
  and end, and includes `durationSeconds` in its POST. Required for the UI
  (B5); if a legacy payload omits it, store null and the UI shows "—",
  never a fabricated value.
- `rawPath` text — Volume path of the raw sensor file (`/data/raw/{id}.bin`).
  Raw files go on the filesystem, **never** in SQLite.
- `analysis` text — Claude's interpretation (JSON string: summary, faultDetail,
  focusAdvice).
- `drills` text — Linkup results (JSON array: `{title, url, source, why}`).
- `analysisStatus` text — `pending | done | failed`.
Existing columns unchanged; old board payloads must still insert.

### B2. Ingest: extend the board endpoint
`POST /api/session` (in `routes/board.ts`) accepts, in addition to the current
JSON body, a **multipart** form: `meta` (the same JSON) + `raw` (binary file).
Behavior: validate pairing code exactly as today → insert session with
`analysisStatus: "pending"` → write raw file to the Volume → trigger the analyzer
(fire-and-forget) → return `202 { sessionId }`. Plain-JSON requests (no raw file)
keep working and may skip analysis or run it on the JSON alone.
**Accept:** README curl still returns as documented; multipart upload creates a
pending session and a file under `/data/raw/`.

### B3. Analyzer service — `backend/src/services/analyzeSession.ts`
The first real member of `services/` (this is what finally justifies the folder).
**Coaching content (cues, prompts, guardrails, signal schema) comes from
`backend/src/coaching/` per `docs/coaching-knowledge.md` §8 — never inline.**
1. Load the session row + parse the raw file for simple derived features
   (swing count consistency, speed distribution — keep it cheap).
2. **Claude** (Anthropic API, key from `config.ts`): interpret the session
   signals (+ recent history for trend context) using the reactive prompt from
   `coaching/prompts.ts`, with the guardrail enforced in code: only signals
   actually measured appear in the MEASURED block → structured coaching analysis.
3. **Linkup** `POST https://api.linkup.so/v1/search`: query from the
   fault→query mapping in `coaching/cueLibrary.ts` (e.g. `elbowTucked` →
   `table tennis drills elbow position forehand`), `depth: "standard"`, take
   top 2–3 results → `{title, url, source, why}`.
4. Write `analysis`, `drills`, `analysisStatus: "done"` (or `"failed"` — never
   leave `pending` on error; the session must still render without analysis).
Timeout + one retry on both external calls. All keys via `config.ts` /
Modal secret `racketcoach-env` (`ANTHROPIC_API_KEY`, `LINKUP_API_KEY`).

### B4. Modal topology
Strengthens the "best use of Modal" story from *hosted on Modal* to *built on
Modal primitives* — web server + async work + shared Volume + cron:
- **Phase 1 (ship this):** analyzer runs in-process in the Hono container,
  fire-and-forget after the 202. Same Volume, same single writer — safe, simple,
  demoable.
- **Phase 2 (if time):** separate Modal function for analysis, triggered by the
  API. ⚠️ It must **not** write SQLite directly (single-writer rule — only the
  API container touches the DB). It POSTs results back to an internal endpoint
  (`POST /api/internal/analysis/{sessionId}`, shared-secret header).
- **Cron:** a Modal scheduled function for a weekly progress digest through the
  existing mailer (`sendMagicLink` pattern → a `sendDigest` sibling).

### B5. Frontend: show the analysis (and the session facts, nicely)
- `ApiSession` gains the new nullable fields (sync comment per Part A).
- **Required session facts, presented clearly on both dashboard and session
  detail:** date of session, time of day, duration, and the summary. Concretely:
  `formatDate` currently renders date only — add a time formatter
  (`18:30`-style, en-GB) and a duration formatter (`23 min`, `1 h 05`).
  Session detail header shows "Fri 18 Jul · 18:30 · 23 min"; the dashboard
  sessions table gains a duration column. Null duration renders "—".
  The summary shown is the stored `analysis` (Claude's read) once B3 lands;
  until then the computed `improvementLine` stands in. Everything shown must
  come from captured data — no invented values (same honesty rule as the
  coaching layer).
- Session page: "Coach's read" card (`analysis`) + "Recommended drills" list —
  each drill links out with its source cited (this is the Linkup demo moment).
- `analysisStatus: "pending"` → show "Coach is reviewing this session…" and
  render the stats as today. Never block the page on analysis.
- Dashboard: latest session's one-line analysis summary can replace/augment the
  computed `improvementLine`.

### B6. Board/firmware contract (for the hardware side; not in this repo)
Session POST contract addition: the station tracks session start/end
wall-clock and sends `durationSeconds` (see B1). The paddle needs no change
for this — duration is a station concern.
Hardware platform: both coach devices are Genesis boards (ESP32-S3, modular
AX22 ports) — the station on the 8-port Genesis, the mini coach on the 4-port
Genesis Mini. Same chip → same constraint everywhere: **PDM mic on I2S0, amp
on I2S1.** Voice logic is shared via the `firmware/libraries/VoiceCoach`
library (config struct per device: AX22 port pins, I2S ports, Audio*,
backend URL). The 4-port Mini has no SD module — its tier-1 cue clips go in
flash (a LittleFS partition holding the pre-generated ElevenLabs MP3s from B7)
instead of SD.
- Board uploads multipart to `POST {BACKEND_URL}/api/session`; authorized by
  pairing code, exactly as today. Fire-and-forget; results appear on the web app.
- Paddle→board WiFi: buffer locally, transmit in bursts (~1–2s cadence or per
  rally), radio off between bursts — battery.
- Target state: no third-party keys in firmware. The interim device-side
  Anthropic key (gitignored `secret.h`) must be dedicated + spend-capped and
  rotated immediately after the hackathon.

### Definition of done (Part B demo path)
Scan QR → play → board uploads raw+JSON → 202 → dashboard shows session with
"Coach is reviewing…" → refresh → Claude analysis + 2–3 cited Linkup drills
render on the session page. Backend `.env.example` documents the two new keys.

### B7. Voice endpoint — `POST /api/voice` (serves BOTH devices)
The coach station and the Genesis mini coach are two clients of the same
endpoint — one brain, zero third-party keys on devices:
1. Accepts recorded audio (WAV/PCM) + the player's current signal snapshot,
   authorized by pairing code or a device token.
2. STT (ElevenLabs) → conversation prompt from `coaching/prompts.ts`
   (guardrail: general answers allowed, invented observations forbidden) →
   Claude → ElevenLabs TTS.
3. Returns a URL the device streams with `audio.connecttohost()` (or the MP3
   bytes directly). Keys (`ELEVENLABS_API_KEY`) live in Modal secrets via
   `config.ts`, alongside the others.
Also: pre-generate the §4 cue-library clips with the same ElevenLabs voice
(one-off script, `backend/scripts/generate-cues.ts`) so devices play instant
tier-1 cues in the same voice the LLM speaks with.

### B8. Coaching knowledge layer — `backend/src/coaching/`
`docs/coaching-knowledge.md` is the source of truth (cue library, guardrails,
prompts, signal schema). Implement its §8 mapping: `cueLibrary.ts`,
`prompts.ts`, `signals.ts` (zod — this schema is the wire contract for the
board POST body and the frontend types). Guardrails are enforced in code:
the MEASURED block and allowed-topic list are generated from the signals
actually present. Align the firmware fault enum with the §2 signal names.

---

## Part C — Prize submissions (covering both readings of the Linkup prize)

We prepare for **both** interpretations: the integration above is the
"best use of Linkup / Modal" case, and a short demo asset covers a UGC-style
prize. Not Claude Code work except where noted.

- **Modal story (from Part B):** web server + async analyzer + shared Volume +
  weekly cron — four primitives, one diagram. The SQLite-single-writer
  constraint and how the analyzer respects it (posting back instead of writing
  the DB) is a good technical talking point.
- **Linkup story:** the coaching is *grounded* — Claude diagnoses the fault,
  Linkup fetches what real coaches prescribe, and the session page cites its
  sources. Linkup is load-bearing, not decorative.
- **UGC / demo asset:** one 30–60s clip of the full loop — scan QR, rally with
  live feedback on the station, session lands on the dashboard, refresh, coach
  analysis + cited drills appear. The drills-appearing moment is the money shot
  for Linkup; the Modal dashboard showing the analyzer fire is the money shot
  for Modal. Claude Code: keeping the pending→done transition visibly smooth
  (B5) is what makes this clip filmable in one take.
- One-liner for both: *paddle senses, motherboard reacts, Modal thinks, Claude
  explains, Linkup proves it.*
