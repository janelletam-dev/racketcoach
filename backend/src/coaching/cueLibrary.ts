import type { Signals, SignalGroup } from "./signals";

/**
 * The fault -> signal -> cue library (coaching-knowledge.md §4). This is the
 * ONLY source of coaching advice; do not duplicate cue text anywhere else.
 * Each entry also carries the Linkup query used to fetch sourced drills (§8).
 */

export type Fault =
  | "overHitting"
  | "inconsistent"
  | "flatPaddle"
  | "slowReturn"
  | "elbowTucked"
  | "contactLate"
  | "weakFollowThrough"
  | "armOnly";

export type CueEntry = {
  fault: Fault;
  requires: SignalGroup[]; // signal groups that must be present to evaluate this
  condition: (s: Signals) => boolean;
  cue: string;
  linkupQuery: string;
};

// Tunable thresholds. Kept here so tuning never touches cue text or prompts.
export const THRESHOLDS = {
  swingSpeedHigh: 3.0, // g
  consistencyLow: 50, // 0-100
  returnTimeHigh: 800, // ms
  elbowGapSmall: 0.35, // normalised to shoulder width
  shoulderRotationLow: 10, // deg
};

export const CUE_LIBRARY: CueEntry[] = [
  {
    fault: "overHitting",
    requires: ["imu"],
    condition: (s) =>
      (s.imu?.swingSpeed ?? 0) >= THRESHOLDS.swingSpeedHigh &&
      (s.imu?.consistency ?? 100) < THRESHOLDS.consistencyLow,
    cue: "Ease off the power. Smooth and repeatable beats hard and wild.",
    linkupQuery: "table tennis drills control over power consistency beginner",
  },
  {
    fault: "inconsistent",
    requires: ["imu"],
    condition: (s) => (s.imu?.consistency ?? 100) < THRESHOLDS.consistencyLow,
    cue: "Match your last swing, same pace every time.",
    linkupQuery: "table tennis drills consistent forehand stroke beginner",
  },
  {
    fault: "flatPaddle",
    requires: ["imu"],
    condition: (s) => s.imu?.paddleFace === "dropped",
    cue: "Keep your paddle up and brush up the back of the ball.",
    linkupQuery: "table tennis paddle angle brush topspin drills beginner",
  },
  {
    fault: "slowReturn",
    requires: ["imu"],
    condition: (s) => (s.imu?.returnTime ?? 0) >= THRESHOLDS.returnTimeHigh,
    cue: "Reset to ready right after each shot.",
    linkupQuery: "table tennis ready position recovery drills",
  },
  {
    fault: "elbowTucked",
    requires: ["camera"],
    condition: (s) => (s.camera?.elbowGap ?? 1) < THRESHOLDS.elbowGapSmall,
    cue: "Give your elbow some room, keep a gap from your body.",
    linkupQuery: "table tennis drills elbow position forehand",
  },
  {
    fault: "contactLate",
    requires: ["camera"],
    condition: (s) => s.camera?.contactInFront === false,
    cue: "Meet the ball out in front of you.",
    linkupQuery: "table tennis contact point in front forehand drills",
  },
  {
    fault: "weakFollowThrough",
    requires: ["camera"],
    condition: (s) => s.camera?.followThrough === "short",
    cue: "Finish the stroke, follow through up and across.",
    linkupQuery: "table tennis follow through forehand stroke drills",
  },
  {
    fault: "armOnly",
    requires: ["camera"],
    condition: (s) =>
      (s.camera?.shoulderRotation ?? 90) < THRESHOLDS.shoulderRotationLow,
    cue: "Turn your upper body into the shot, do not just swing the arm.",
    linkupQuery: "table tennis body rotation forehand power drills",
  },
];

/** Which signal groups are actually present (and non-empty) in a payload. */
export function presentGroups(s: Signals): SignalGroup[] {
  const groups: SignalGroup[] = [];
  if (s.imu && Object.values(s.imu).some((v) => v != null)) groups.push("imu");
  if (s.camera && Object.values(s.camera).some((v) => v != null))
    groups.push("camera");
  return groups;
}

/**
 * Classify faults from signals. Guardrail: a cue is only evaluated if all of its
 * required signal groups are present — so camera faults are never diagnosed when
 * no camera ran. Returned in library (priority) order.
 */
export function classifyFaults(s: Signals): CueEntry[] {
  const present = presentGroups(s);
  return CUE_LIBRARY.filter(
    (c) => c.requires.every((r) => present.includes(r)) && c.condition(s),
  );
}

export type PrimaryResult =
  | { kind: "fault"; entry: CueEntry }
  | { kind: "doingWell"; cue: string };

/** The single most salient result: the top-priority fault, or encouragement. */
export function primaryResult(s: Signals): PrimaryResult {
  const faults = classifyFaults(s);
  if (faults.length === 0) {
    return {
      kind: "doingWell",
      cue: "Great control — keep that rhythm and shape.",
    };
  }
  return { kind: "fault", entry: faults[0] };
}
