# Rally — Coaching Knowledge Base (MVP)

> The middle layer between raw sensor data and the coaching LLM. It turns IMU
> swing metrics and upper-body camera metrics into grounded, honest coaching
> cues. **Core rule: the coach only speaks to what is measured.** It never
> fabricates feedback about anything the sensors did not capture.
>
> Scope for the MVP is the upper body. Lower-body mechanics, spin, ball
> placement, and grip are post-MVP and must not be coached until they are
> actually measured.
>
> **For Claude Code:** this file is the single source of truth for coaching
> content. The cue library (§4), the guardrail list (§5), and the prompts (§6)
> are implemented in `backend/src/coaching/` — see §8. Do not duplicate cue
> text or prompt text anywhere else (not in firmware, not in the frontend).

---

## 1. Grounded beginner faults (research-backed)

Sourced from r/tabletennis and coaching references (PingSunday, PingSkills,
Table Tennis Teacher). These are the real, most-repeated beginner problems,
not invented advice.

- **Over-hitting** — trying to hit too hard and losing control. The single
  most common beginner theme: balance speed with consistency.
- **Hitting too flat** — no brush, wrong paddle face, ball goes long or into
  the net.
- **Low or missing follow-through** — the stroke stops at contact.
- **Not recovering to the ready position** between shots.
- **Elbow tucked into the body** — kills arm rotation and power.
- **Contact point too late**, not in front of the body.
- **Arm-only swing** with no upper-body rotation.
- *(Post-MVP)* No weight transfer, poor stance, poor footwork, spin errors,
  ball placement, grip.

## 2. Signal sources

**IMU (paddle) — the swing**

- `swingSpeed` — peak acceleration magnitude during the swing.
- `consistency` — inverse of the variance in swing peaks across recent swings.
- `paddleFace` — paddle orientation at the swing peak (dropped vs up).
- `returnTime` — time for the paddle to settle to a ready orientation after a
  swing.

**Camera (upper body) — the arm and torso**

Landmarks used: shoulders (L/R), elbows (L/R), wrists (L/R), plus the
colour-tracked paddle marker. Hips are used only as a torso reference if
available. Reliable on deliberate practice reps; jittery on fast rally, so
treat camera cues as a slow "form check," not live fast play.

## 3. Parsing metrics (raw data → signals)

**IMU parsing**

- Compute magnitude `a = sqrt(ax² + ay² + az²)` per sample.
- Swing = `a` crosses above threshold; record the peak; end when `a` returns
  near 1g; debounce 350 ms.
- `consistency` = how close this peak is to the running average of recent peaks.
- `paddleFace` = gyro-derived pitch at the peak.
- `returnTime` = ms from swing end until orientation is stable again.

**Camera parsing (upper-body landmark math)**

For a right-handed player use the right arm. Normalise all distances by
shoulder width so it is camera-distance independent.

- `elbowGap` — horizontal distance from the playing elbow to the torso centre
  line (midpoint of the shoulders). Small = elbow tucked in.
- `contactInFront` — wrist position ahead of the shoulder line at the swing
  moment. Wrist ahead of the torso = contact in front (good).
- `shoulderRotation` — change in the shoulder-line angle from backswing to
  contact. Little change = arm-only swing.
- `followThrough` — length and direction of the wrist/paddle path after
  contact. Short or stalled = weak follow-through.
- `swingPath` — the 2D trajectory of the colour-tracked paddle tip through the
  stroke.

**Sync (the fusion)**

Use the IMU swing-peak timestamp to sample the camera at that exact instant
(the nearest frame). That gives "at contact, the elbow gap was X, the wrist
was/was not in front, the shoulders had rotated Y." Neither sensor gives this
alone.

## 4. Fault → signal → cue library (the only source of advice)

| Fault | Signal condition | Cue |
| --- | --- | --- |
| Over-hitting | `swingSpeed` high AND `consistency` low | "Ease off the power. Smooth and repeatable beats hard and wild." |
| Inconsistent | `consistency` low | "Match your last swing, same pace every time." |
| Flat / dropped paddle | `paddleFace` dropped at contact | "Keep your paddle up and brush up the back of the ball." |
| Slow return | `returnTime` high | "Reset to ready right after each shot." |
| Elbow tucked in | `elbowGap` small | "Give your elbow some room, keep a gap from your body." |
| Contact too late | `contactInFront` false | "Meet the ball out in front of you." |
| Weak follow-through | `followThrough` short | "Finish the stroke, follow through up and across." |
| Arm-only swing | `shoulderRotation` low | "Turn your upper body into the shot, do not just swing the arm." |
| Doing well | all in range | a specific bit of encouragement about what was good. |

## 5. Guardrail (what the coach must NOT say — MVP)

Not measured yet, so never claim to have seen them:

- Weight transfer, stance, footwork, lower-body rotation (need full-body pose).
- Spin, where the ball landed (need ball tracking).
- Grip (needs finger-level tracking).

The coach may still answer GENERAL questions about these in conversation mode
(§6). It just may never claim to have observed them in the player's swing.

## 6. The coaching LLM prompts

**Reactive cue (auto, after a swing or at end of a rep set)**

```
SYSTEM: You are a table tennis coach for a beginner. Base every OBSERVATION only
on the measured signals below (IMU swing metrics and upper-body camera metrics).
You may coach on power/consistency, paddle face, return to ready, elbow position,
contact point in front, follow-through, and upper-body rotation. You may NOT claim
to have seen weight transfer, stance, footwork, lower-body rotation, spin, ball
placement, or grip — those are not measured. Give ONE short, encouraging cue (one
sentence), drawn from the cue library.
MEASURED:
  swingSpeed: <g>    consistency: <0-100>    paddleFace: <up|dropped>
  returnTime: <ms>   elbowGap: <normalised>  contactInFront: <true|false>
  shoulderRotation: <deg>   followThrough: <short|full>
  goodReps: <n>   totalReps: <n>   bestStreak: <n>
CUE LIBRARY: [the table in §4]
OUTPUT: one cue only.
```

**Conversation (push-to-talk, the player asks a question)**

```
SYSTEM: You are a table tennis coach. Answer the player's question from general
table tennis coaching knowledge (grip, spin, technique, drills, anything). This is
a general question, not a claim about their swing, so answer freely. Do NOT invent
observations about the player's last swing beyond the measured signals. Keep it to
two sentences, spoken and encouraging.
```

## 7. Roadmap (post-MVP)

- Full-body pose → weight transfer, stance, footwork, full rotation.
- Ball tracking → spin and placement.
- Hand/finger tracking → grip.

Each new sensor lifts the guardrail for exactly those signals and adds its
faults to the cue library. The honest rule never changes: **coach only what
you measure.**

---

## 8. Implementation mapping (Claude Code: build to this)

Where each part of this document lives in the codebase:

**`backend/src/coaching/` — the one home for coaching content.**

- `cueLibrary.ts` — §4 as data: `{ fault, condition(signals), cue }[]`, plus
  the fault→Linkup-query mapping (e.g. `elbowTucked` →
  `"table tennis drills elbow position forehand"`). Consumed by the analyzer
  service and by `/api/voice`.
- `prompts.ts` — the two system prompts from §6, with the MEASURED block and
  guardrail list **generated from the signals actually present** (see
  enforcement below), never hardcoded per-call.
- `signals.ts` — the canonical signal schema (zod): the IMU fields and camera
  fields of §2 with their units and enums. This schema is the wire contract
  everywhere a signal travels.

**Guardrail enforcement is code, not vibes.** The prompt alone is not the
guardrail. Rules:

1. The MEASURED block includes only signals actually captured in that session
   or rep set. No camera running → no camera fields in the prompt, and the
   camera-dependent faults (elbow, contact point, follow-through, rotation)
   are removed from the allowed-coaching list for that call.
2. The allowed/forbidden topic lists in the system prompt are rendered from
   `signals.ts` — adding a sensor post-MVP lifts the guardrail by adding its
   signals there, exactly as §7 describes, with no prompt surgery.

**Three response tiers (latency decides who speaks):**

1. **Per-swing (instant, no LLM):** the cue library is deterministic — the
   coach station matches signal conditions locally and plays pre-recorded
   clips. The existing SD clips cover 3 faults; the remaining cues in §4 need
   clips too. Pre-generate ALL cue audio with the same ElevenLabs voice used
   by `/api/voice`, so the instant coach and the thinking coach are audibly
   the same person.
2. **End of rep set (LLM, seconds):** reactive-cue prompt with the aggregated
   MEASURED block → one spoken sentence via `/api/voice`.
3. **Post-session (LLM + Linkup, async):** the analyzer service
   (`analyzeSession.ts`) uses the same cue library + guardrails to produce the
   dashboard analysis, and maps diagnosed faults to Linkup drill searches via
   `cueLibrary.ts`.

**Wire contract:** the paddle/station JSON must carry the §2 signal fields
(numeric), not only a pre-classified fault string. The current firmware enum
(`paddleDropped | slowReturn | inconsistent`) predates this document — align
station firmware, board POST body, and `signals.ts` on the §2 names. The
backend classifies faults from signals via `cueLibrary.ts`; devices may still
classify locally for tier-1 cues, but the backend's classification is
authoritative for the dashboard.

**Fusion note:** IMU-peak↔camera-frame sync (§3) needs a shared clock. The
device fusing the two must stamp both streams with its own clock on arrival —
do not trust the paddle's `millis()` to align with camera frame times.
