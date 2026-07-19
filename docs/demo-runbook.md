# RacketCoach — Demo Runbook

> Everything the demo needs, in one place. Check items off as they close.
> Owners: 🙋 Janelle (hands/accounts) · 🤖 cc1/cc2 (repo) · 🔧 firmware Claude.
> Companion docs: `architecture.md` (what the system is),
> `architecture-proposal.md` (work items), `coaching-knowledge.md` (the coach's brain).

## 1. The demo story (what judges see, in order)

1. **Pair** — coach station shows the QR; scan with a phone; `/pair?code=…`
   claims the paddle. *"The paddle is now mine."*
2. **Play (live loop)** — start a round; rally; station scores each swing
   live: leaderboard on the TFT, NeoPixel flashes, voice cue clips on faults.
   *Latency story: local heuristics, no cloud in the loop.*
3. **Ask the coach (voice)** — speak to the station (or press P4): question →
   backend `/api/voice` → STT → Claude → ElevenLabs → spoken answer.
   *One brain, served from the cloud, same voice as the cue clips.*
4. **Session lands (web app)** — end of session → station POSTs to the
   backend → dashboard shows the session: date · time · duration · summary.
5. **The money shot** — refresh the session page: Claude's coaching read +
   2–3 real drills fetched by Linkup, each cited to its source. *"The coach
   only claims what the sensors measured, and its advice comes from real
   coaching sources."*
6. **(If ready) Live Motion** — laptop view showing skeleton + IMU charts
   during play. Great B-roll even if fusion isn't wired to the backend yet.

One-liner to say out loud: **"Paddle senses, motherboard reacts, Modal
thinks, Claude explains, Linkup proves it."**

## 2. Blockers before this demo exists

- [ ] **Money-test passes** (P1 GOOD + green NeoPixel on a real swing) — 🙋
      ← current status: idle green OK, swing packets not arriving; top
      suspect is paddle secrets.h on EE creds instead of AP creds. Fix:
      `racketcoach`/`paddle123`, STATION_IP default, reflash.
- [x] **Deploy gate merged** (A2 · A4 · A9 · A15 + riders; all acceptance
      checks passed locally; A15 runtime check pends the Modal deploy) — 🤖 cc2
      ✅ f634b00 — bonus: `.env.example` templates un-swallowed from gitignore;
      stale `firmware/sketch/` deleted, template moved to `firmware/paddle/`
- [ ] **Modal token + `racketcoach-env` secret created** (AUTH_SECRET,
      FRONTEND_URL, PUBLIC_BACKEND_URL; NO demo/seed flags) — 🙋
- [ ] **Backend deployed to Modal** + acceptance: boots, `/api/auth/demo`
      → 403, container restart changes nothing — 🤖 cc2
- [ ] **Frontend deployed to Vercel** (Root Directory = `frontend`,
      BACKEND_URL → Modal URL, NEXT_PUBLIC_APP_URL → Vercel URL; then update
      FRONTEND_URL in the Modal secret) — 🤖 cc2
- [ ] **A11 fixed** (error honesty — demo blocker: a backend hiccup must not
      render a lying "No sessions yet" on stage) — 🤖
- [ ] **Part B pipeline** (ingest + analyzer + Claude + Linkup + UI) — the
      money shot depends on it — 🤖
- [ ] **`/api/voice` live** + station voice handoff tested end-to-end — 🤖 + 🔧
      ← still blocked on `voice_coach.h` (never seen; mic driver unverified)
- [ ] **Mic works** (PDM on I2S0 after the port swap — D2 audio-out is
      already verified on I2S1) — 🔧 + 🙋

## 3. Demo-day prep (the night before)

- [ ] **Demo data**: run `backend/scripts/demo-data.sh` once against prod —
      claims a pairing code, POSTs 5 rising sessions via the public board
      API, so the dashboard opens on the 42%→71% story, not a blank page.
- [ ] **Cue clips on SD** (station) — all §4 cue-library lines, generated in
      the SAME ElevenLabs voice as `/api/voice` (`generate-cues.ts`), plus
      the existing game clips. Verify each plays (D2 method).
- [ ] **Vendor CDN files into `browser/`** (MediaPipe pose + camera_utils +
      drawing_utils + Chart.js) so Live Motion opens with zero internet.
- [ ] **Charge everything**: paddle battery full + one spare battery/power
      bank; station USB supply; label the two USB cables (station/paddle).
- [ ] **secrets.h double-check**: paddle = AP creds (`racketcoach`/`paddle123`,
      STATION_IP default). Station = phone-hotspot creds for the STA side
      (NOT venue WiFi — assume it's hostile).
- [ ] **Phone hotspot**: "Maximize Compatibility" ON (2.4GHz), tested with
      the station the night before. Laptop also joins the hotspot.
- [ ] **Rotate/verify keys**: Anthropic + Linkup + ElevenLabs keys are
      dedicated + spend-capped; the interim on-device key is scheduled to
      die after the event.
- [ ] **Dry-run the full story (§1) twice**, phone-in-hand, timed. Note
      where it drags; cut there.

## 4. Setup at the venue (30 min before slot)

- [ ] Power station → confirm boot: `AP up: "racketcoach"`, SD OK, idle screen.
- [ ] Power paddle → station scores a test swing (P1 GOOD + green flash).
- [ ] Station STA joins the phone hotspot → voice handoff test question.
- [ ] Laptop: open dashboard (deployed URL) — sessions visible; open Live
      Motion locally, camera on, USB to paddle if WiFi is crowded.
- [ ] One full end-to-end rehearsal at the table before judges arrive.
- [ ] Volume: set via rotary encoder for room noise; test a fault cue.

## 5. Failure fallbacks (decide NOW, not on stage)

| If this dies | Do this instead |
| --- | --- |
| Venue RF chaos / paddle won't link | Paddle link is on the station's own AP — unaffected by venue WiFi. If truly jammed: tether paddle by USB and narrate from Live Motion. |
| Hotspot/internet down | Live loop (steps 1–2) still fully works — it's cloud-free by design (D5). Show the deployed dashboard from cached/pre-loaded sessions; skip live voice, play SD cue clips as the voice story. |
| Backend down mid-demo | Dashboard shows the pre-seeded sessions (already persisted). A11 fix means it errors honestly rather than showing "No sessions yet" — say "cloud beat, local loop unaffected" and keep rallying. |
| Mic/VAD misbehaves | P4 button is the manual voice trigger — use it instead of VAD and don't mention the difference. |
| Voice chain down entirely | SD cue clips still narrate every fault/win — the coach still "speaks." |
| Swing detection flaky on the day | `SWING_START_G` lives at the top of paddle.ino — lower to 1.5 and reflash takes 90 seconds. |

## 6. UGC / demo clip (30–60s, one take)

Shot list — film vertical, phone on a stand:
1. Close-up: QR on station → phone scans → "Paddle linked" badge (2–3s).
2. Rally: paddle swings, NeoPixel flashing green/red, TFT leaderboard
   climbing, one audible cue line (8–10s).
3. Voice ask: "Coach, how do I fix my follow-through?" → spoken answer (8s).
4. Laptop: dashboard refresh → session appears → scroll to Coach's read +
   cited drills (the Linkup money shot — hold 4s on the citations) (10s).
5. End card: wordmark + one-liner (2s).
- [ ] Film after the pending→done dashboard transition is smooth (B5) —
      that's what makes shot 4 work in one take.
- [ ] Cut a 15s version for socials from the same take.

## 7. Prize talking points (30s each)

**Modal**: not just hosted — built on four primitives: web server (Hono API),
async analyzer, shared Volume (SQLite + raw files), weekly cron. Single-writer
SQLite respected by design (min=max=1; workers POST back, never touch the DB).

**Linkup**: the coach's advice is *grounded* — Claude diagnoses from measured
signals only, Linkup fetches what real coaches prescribe for that exact fault,
and every drill on screen is cited. Linkup is load-bearing, not decorative.

**The honesty angle (differentiator for any judge)**: "the coach only speaks
to what is measured" — guardrails enforced in code, not vibes
(`coaching-knowledge.md` §5/§8).

## 8. Open items feeding this runbook

- `voice_coach.h` → 🔧 (blocks §2 voice + mic items)
- Camera fusion + `/api/camera` (B9) → nice-to-have for demo, required for
  the "upper-body form" story; Live Motion works standalone either way
- Mini coach build-out → stretch goal; demo works without it
