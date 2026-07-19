# RacketCoach — System Architecture (nailed down)

> The canonical reference. If another doc or a chat message disagrees with
> this file, this file wins. Detailed work items live in
> `architecture-proposal.md`; coaching content in `coaching-knowledge.md`.
> Status: decisions below are FINAL for the hackathon build.

## The system in one picture

```
                         ┌─────────────────────────┐
                         │  PADDLE (Genesis Mini)  │  IMU @104Hz
                         │  swing detect (§3 KB)   │  battery + WiFi
                         └─────┬──────────────┬────┘
              per-swing UDP    │              │  raw CSV 30Hz
              JSON :4210       │              │  (SSE :80 / USB serial)
                               ▼              ▼
        ┌──────────────────────────┐   ┌──────────────────────────┐
        │ COACH STATION (Genesis)  │   │ BROWSER — Live Motion    │
        │ AP "racketcoach"         │   │ MediaPipe pose (camera)  │
        │ game logic · leaderboard │   │ IMU↔camera fusion        │
        │ tier-1 cues (SD clips)   │   │ camera metrics           │
        │ NeoPixel · TFT · voice   │   └────────────┬─────────────┘
        └───────┬──────────────────┘                │
                │ session POST (JSON,               │ POST /api/camera
                │ + durationSeconds)                │ {pairingCode, metrics}
                │ POST /api/voice (audio)           │
                ▼                                   ▼
        ┌───────────────────────────────────────────────────┐
        │  BACKEND — Hono on Modal (owns ALL data + AI)     │
        │  SQLite on Volume (single writer = this container)│
        │  coaching/ knowledge layer · analyzer service     │
        │  → Claude (interpret) → Linkup (drills)           │
        │  → ElevenLabs (STT/TTS via /api/voice)            │
        └───────────────────┬───────────────────────────────┘
                            │ REST (Bearer token, server-side only)
                            ▼
        ┌───────────────────────────────────────────────────┐
        │  FRONTEND — Next.js on Vercel                     │
        │  dashboard · session detail · pair QR             │
        │  date · time · duration · summary · drills        │
        └───────────────────────────────────────────────────┘

        GENESIS MINI COACH (voice satellite): mic + amp only →
        same POST /api/voice as the station. Cue clips in LittleFS flash.
```

## Final decisions (with the one-line reason)

**D1 — Network topology: the station owns the paddle network.** Station runs
`WIFI_AP_STA`: its own AP `racketcoach` (paddle → UDP to fixed `192.168.4.1:4210`)
plus a STA side to venue/hotspot/home for cloud calls. *Reason: immune to venue
captive portals and client isolation; zero IP discovery.* The paddle's
`secrets.h` always uses the AP config; only the station's changes per location.

**D2 — Swing signals are computed on the paddle.** The §3 knowledge-base
parsing (peak, consistency, paddleFace, returnTime) runs on-device at ~100Hz
raw; one small UDP packet per swing. *Reason: impact peaks are too short for a
smoothed 30Hz stream, and per-swing packets are battery-cheap.* The packet
carries numeric signals + legacy `result`/`faultType` so the current station
works unmodified.

**D3 — IMU↔camera fusion happens in the browser.** Live Motion is the only
node that receives both streams (paddle SSE/USB + MediaPipe pose). It computes
the camera metrics (elbowGap, contactInFront, shoulderRotation, followThrough)
sampled at IMU contact moments, stamping both streams with its own clock.
*Reason: no other node has both; ESP32s can't run pose.*

**D4 — All AI and all third-party keys are server-side.** Claude, Linkup,
ElevenLabs are called only by the backend (`analyzeSession`, `/api/voice`).
Devices hold zero third-party keys (the interim on-device key is capped and
dies after the hackathon). *Reason: rotation without reflashing, shared brain
across station + mini, prompts tweakable server-side.*

**D5 — Latency decides who speaks (three tiers).** Per-swing: deterministic
cue-library clips played locally (station SD / mini LittleFS) — no LLM. End of
rep set: one LLM cue via `/api/voice`. Post-session: full Claude analysis +
Linkup drills, async. *Reason: 100–200ms live budget vs seconds for LLMs.*

**D6 — Raw capture is the browser's job, and it's optional.** The station
POSTs JSON only. The browser, which already holds the full raw stream, may
upload a raw CSV via the multipart ingest for deep analysis. *Reason: the
station never sees raw data; don't invent a second raw path for MVP.*

**D7 — The station is the sole session-poster.** One end-of-session POST to
`/api/session` (pairing-code authorized) with aggregates + `durationSeconds`
(station stamps start/end; it is the source of truth for duration).
*Reason: one writer per session record; paddle and browser only contribute
streams/metrics.*

**D8 — SQLite has exactly one writer: the API container.** Modal pins
min=max=1; any future worker POSTs results back to an internal API endpoint
rather than touching the DB file. *Reason: Modal Volumes do no file locking.*

**D9 — The coaching knowledge layer lives in `backend/src/coaching/` only.**
Cue library, prompts, signal schema (zod = the wire contract), guardrails
enforced in code (MEASURED block built from signals actually present).
*Reason: one brain, honest by construction; sensors added post-MVP lift the
guardrail by editing one schema.*

**D10 — Security gates are explicit env flags, never `NODE_ENV`.**
`ALLOW_DEMO_LOGIN`, `SEED_DEMO` (both absent in prod), `AUTH_SECRET` required
unconditionally. *Reason: `NODE_ENV=production` breaks `npm ci`/tsx and
build tooling must never be able to disarm a security gate.*

## Wire contracts (all of them)

1. **Paddle → Station** — UDP `192.168.4.1:4210`, one datagram per swing:
   `{playerId, result, faultType, speed, swingSpeed, consistency, paddleFace,
   returnTime}` (numeric signals per knowledge-base §2; legacy fields for
   current station compat).
2. **Station → Backend** — `POST /api/session`, pairing-code authorized:
   current fields + `durationSeconds`; multipart with optional `raw` part
   (B2). Responses: 200 claimed / 202 unclaimed / 404 unknown / 400 invalid.
3. **Browser → Backend** — `POST /api/camera` `{pairingCode, metrics}` at end
   of a rep set; backend attaches the camera metrics to that user's current/
   latest session. (New endpoint — small, validated by `coaching/signals.ts`.)
4. **Station & Mini → Backend** — `POST /api/voice`: recorded audio + signal
   snapshot → STT → Claude (conversation prompt) → TTS → audio URL streamed
   back via `audio.connecttohost()`.
5. **Frontend → Backend** — existing REST with Bearer token, server-side
   only; session rows now include `durationSeconds`, `analysis`, `drills`,
   `analysisStatus`.

## Lanes (writer discipline — identity is the lane, not the chat window)

Exactly three writers, one territory each. Pull/rebase before every push;
never force-push. If you are a session not listed here, you are read-only.

| Writer | Territory | Also responsible for |
| --- | --- | --- |
| **cc1** | `frontend/` | committing docs/ + firmware/ WIP authored by the firmware Claude |
| **cc2** | `backend/` | Modal + Vercel deploys, Modal secret updates |
| **firmware Claude** (Cowork session) | `firmware/`, `docs/` authorship | writes to the working tree via the device bridge; never commits — cc1 commits its output |
| Teammate (human) | anything | via PR, not direct push to main |

## Who builds what (current status)

| Piece | Owner | Status |
| --- | --- | --- |
| Paddle firmware (detect + UDP + streams) | firmware Claude (done) → Janelle flashes | ✅ in repo, needs money-test |
| Station firmware (AP, game, cues, I2S1 audio) | firmware Claude (done) → Janelle flashes | ✅ in repo, D2 audio verified |
| Money-test (P1 GOOD + green flash) | Janelle (hands) | ⏳ next hardware action |
| Deploy gate (A2/A4/A15/A9 + riders) | cc2 | ⏳ in flight |
| Modal token/secret + deploy | Janelle then cc2 | blocked on gate |
| Part B (ingest, analyzer, /api/voice, /api/camera, coaching/, UI) | cc1/cc2 per proposal | after deploy |
| Station end-of-session POST (aggregates + durationSeconds → `/api/session`) | firmware Claude | to write; contract fixed (B1/B2), can precede deploy |
| VoiceCoach shared library extraction | firmware Claude | unblocked (`voice_coach.h` reviewed + patched); after mic verifies |
| Mini coach sketch (voice satellite, LittleFS cues) | firmware Claude | blocked on Janelle's module lineup for the 4 ports |
| Firmware tuning (SWING_START_G, pitch axis, VAD RMS) | firmware Claude ← Janelle's serial logs | after money-test |
| Live Motion fusion + /api/camera client | whoever takes browser work | after Part B contract lands |
| Demo assets (clip script, prize writeups) | firmware Claude + Janelle | near demo day |

## Still genuinely open (the only two)

1. `voice_coach.h` has never been seen — the mic driver and ElevenLabs call
   inside it are unverified, and the VoiceCoach library extraction waits on it.
2. Mini coach hardware finalization: which AX22 modules on its 4 ports
   (mic + amp + button + NeoPixel is the working assumption).
