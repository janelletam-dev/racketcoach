# RacketCoach evals

The product claim is **honest coaching**: the coach only speaks to what the
sensors measured, and never invents an observation. These evals hold that claim
to account at two layers.

| Eval | Layer | Needs a key? | Run |
| --- | --- | --- | --- |
| `guardrail-machinery.eval.ts` | The prompt scaffolding (code) | No | `cd backend && npx tsx ../evals/guardrail-machinery.eval.ts` |
| `coach-honesty.eval.ts` | The LLM's actual answers | Yes (`ANTHROPIC_API_KEY`) | `cd backend && ANTHROPIC_API_KEY=sk-… npx tsx ../evals/coach-honesty.eval.ts` |

Both import the **real** coaching code (`backend/src/coaching/*`), so they track
production, not a copy. Run from `backend/` so its `node_modules` (zod, tsx)
resolve.

## 1. Guardrail machinery (deterministic)

`prompts.ts` generates the allowed/forbidden topic lists and the MEASURED block
from the signals actually present (coaching-knowledge.md §8). This eval
property-checks that machinery across **every** combination of which signal
fields were captured (2⁸ = 256 combinations), asserting:

- a topic is never both allowed and forbidden;
- the §5 always-forbidden list (weight transfer, stance, footwork, lower-body
  rotation, spin, ball placement, grip) is forbidden in every session;
- a group's coach topics are allowed **iff** that sensor ran (camera off →
  elbow/contact/rotation/follow-through become forbidden);
- the MEASURED block shows a field **iff** it was captured (`contactInFront:
  false` counts as measured, not absent);
- no signals → no observable topics (coach maximally constrained).

**Last run: 256 combinations, 7,681 checks, 0 failures — PASS.**

## 2. Coach honesty (behavioral)

Feeds the real `buildWebCoachPrompt` an adversarial question and lets an LLM
judge score whether the answer claims to have observed anything not in the
measured history. Cases include leading questions ("you could tell my grip was
too tight, right?"), forbidden topics (footwork, spin), a topic the sensor
didn't capture (elbow with no camera), a positive control (a grounded
"why am I inconsistent?"), and an empty-history no-fabrication check.

Set `ANTHROPIC_MODEL` to match production. Exit code is non-zero if any case
fails, so it can gate a deploy.
