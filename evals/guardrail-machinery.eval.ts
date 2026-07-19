/**
 * Guardrail-machinery eval (deterministic, no API key).
 *
 * The coach's honesty claim ("only speaks to what the sensors measured") is
 * enforced in CODE: prompts.ts generates the allowed / forbidden topic lists and
 * the MEASURED block from the signals actually present (coaching-knowledge.md §8).
 * This eval property-checks that machinery across EVERY combination of which
 * signal fields were captured, so the LLM can never be handed a prompt that lets
 * it claim an unmeasured observation.
 *
 * Run:  cd backend && npx tsx ../evals/guardrail-machinery.eval.ts
 */

import {
  allowedTopics,
  forbiddenTopics,
  renderMeasuredBlock,
} from "../backend/src/coaching/prompts";
import {
  SIGNAL_GROUPS,
  FORBIDDEN_TOPICS,
  type Signals,
} from "../backend/src/coaching/signals";
import { presentGroups } from "../backend/src/coaching/cueLibrary";

// Sample non-null value for every signal field. contactInFront:false is
// deliberate — a falsey-but-measured value must count as present, not absent.
const IMU_FIELDS = {
  swingSpeed: 2.4,
  consistency: 55,
  paddleFace: "dropped" as const,
  returnTime: 1300,
};
const CAM_FIELDS = {
  elbowGap: 0.3,
  contactInFront: false,
  shoulderRotation: 20,
  followThrough: "short" as const,
};

function subsets<T extends object>(obj: T): Partial<T>[] {
  const keys = Object.keys(obj) as (keyof T)[];
  const out: Partial<T>[] = [];
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    const o: Partial<T> = {};
    keys.forEach((k, i) => {
      if (mask & (1 << i)) o[k] = obj[k];
    });
    out.push(o);
  }
  return out;
}

type Failure = { combo: string; invariant: string; detail: string };
const failures: Failure[] = [];
let checks = 0;
let combos = 0;

function check(ok: boolean, combo: string, invariant: string, detail: string) {
  checks++;
  if (!ok) failures.push({ combo, invariant, detail });
}

const ALL_TOPICS = [
  ...SIGNAL_GROUPS.imu.coachTopics,
  ...SIGNAL_GROUPS.camera.coachTopics,
];

for (const imu of subsets(IMU_FIELDS)) {
  for (const cam of subsets(CAM_FIELDS)) {
    const s: Signals = {
      goodReps: 4,
      totalReps: 10,
      bestStreak: 2,
      imu,
      camera: cam,
    };
    const present = presentGroups(s);
    const allowed = allowedTopics(s);
    const forbidden = forbiddenTopics(s);
    const measured = renderMeasuredBlock(s);
    const label = `imu[${Object.keys(imu).join(",") || "-"}] cam[${Object.keys(cam).join(",") || "-"}]`;
    combos++;

    // INV-1 A topic is never simultaneously allowed and forbidden.
    const overlap = allowed.filter((t) => forbidden.includes(t));
    check(overlap.length === 0, label, "no allow/forbid overlap", `overlap: ${overlap.join(", ")}`);

    // INV-2 The §5 always-forbidden list is forbidden in every session.
    for (const t of FORBIDDEN_TOPICS) {
      check(forbidden.includes(t), label, "§5 always forbidden", `"${t}" not forbidden`);
    }

    // INV-3 A group's coach topics are allowed iff that sensor ran; forbidden
    //       (and not allowed) otherwise.
    for (const g of ["imu", "camera"] as const) {
      const on = present.includes(g);
      for (const t of SIGNAL_GROUPS[g].coachTopics) {
        if (on) {
          check(allowed.includes(t) && !forbidden.includes(t), label, "present -> allowed", `${g}:"${t}"`);
        } else {
          check(forbidden.includes(t) && !allowed.includes(t), label, "absent -> forbidden", `${g}:"${t}"`);
        }
      }
    }

    // INV-4 No signals -> the coach is maximally constrained (no observable topics).
    if (present.length === 0) {
      check(allowed.length === 0, label, "no signals -> no allowed topics", `allowed: ${allowed.join(", ")}`);
    }

    // INV-5 The MEASURED block shows a field name iff that field was captured.
    const captured = new Set<string>([
      ...Object.keys(imu),
      ...Object.keys(cam),
    ]);
    for (const field of [...Object.keys(IMU_FIELDS), ...Object.keys(CAM_FIELDS)]) {
      const shown = measured.includes(`${field}:`);
      check(shown === captured.has(field), label, "MEASURED = captured only", `${field} shown=${shown} captured=${captured.has(field)}`);
    }

    // INV-6 Every topic string is accounted for as allowed or forbidden (no
    //       topic silently drops out of the guardrail).
    for (const t of ALL_TOPICS) {
      check(allowed.includes(t) || forbidden.includes(t), label, "topic accounted for", `"${t}" neither allowed nor forbidden`);
    }
  }
}

const passed = checks - failures.length;
console.log("\n=== Guardrail-machinery eval (deterministic) ===");
console.log(`combinations: ${combos}   checks: ${checks}   passed: ${passed}   failed: ${failures.length}`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures.slice(0, 25)) {
    console.log(`  [${f.invariant}] ${f.combo} -> ${f.detail}`);
  }
  if (failures.length > 25) console.log(`  ...and ${failures.length - 25} more`);
  process.exit(1);
} else {
  console.log("PASS — the honesty guardrail holds for every signal combination.\n");
}
