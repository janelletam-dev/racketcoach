import { z } from "zod";

/**
 * Canonical signal schema (coaching-knowledge.md §2). This is the wire contract
 * everywhere a signal travels: the board POST body, the analyzer, and /api/voice.
 * MVP scope is the upper body — IMU (paddle) + camera (upper body). Adding a
 * sensor post-MVP means adding its signals here; nothing else changes (§7).
 */

export const paddleFaceEnum = z.enum(["up", "dropped"]);
export const followThroughEnum = z.enum(["short", "full"]);

// IMU (paddle) — the swing (§2)
export const imuSignalsSchema = z.object({
  swingSpeed: z.number().describe("peak acceleration magnitude, in g"),
  consistency: z.number().min(0).max(100).describe("0-100, inverse of swing-peak variance"),
  paddleFace: paddleFaceEnum.describe("paddle orientation at the swing peak"),
  returnTime: z.number().describe("ms to settle back to a ready orientation"),
});

// Camera (upper body) — the arm and torso (§2). May be absent (camera not run).
export const cameraSignalsSchema = z.object({
  elbowGap: z.number().describe("normalised elbow-to-torso-centreline distance"),
  contactInFront: z.boolean().describe("wrist ahead of the shoulder line at contact"),
  shoulderRotation: z.number().describe("degrees of shoulder-line change, backswing to contact"),
  followThrough: followThroughEnum.describe("wrist/paddle path after contact"),
});

// Always present, aggregated over the rep set.
export const sessionAggregatesSchema = z.object({
  goodReps: z.number().int().nonnegative(),
  totalReps: z.number().int().positive(),
  bestStreak: z.number().int().nonnegative(),
});

/**
 * A signal payload: aggregates always; imu / camera present only when that
 * sensor ran. Fields inside each group are partial so the guardrail can key off
 * exactly what was captured.
 */
export const signalsSchema = sessionAggregatesSchema.extend({
  imu: imuSignalsSchema.partial().optional(),
  camera: cameraSignalsSchema.partial().optional(),
});
export type Signals = z.infer<typeof signalsSchema>;

export type SignalGroup = "imu" | "camera";

/**
 * Signal-group metadata used to render the MEASURED block and the allowed-topic
 * list from what is actually present (§8 enforcement rule 2). Post-MVP: add a
 * group here and the guardrail lifts for exactly those topics, no prompt surgery.
 */
export const SIGNAL_GROUPS: Record<
  SignalGroup,
  { label: string; signals: readonly string[]; coachTopics: readonly string[] }
> = {
  imu: {
    label: "IMU (paddle swing)",
    signals: ["swingSpeed", "consistency", "paddleFace", "returnTime"],
    coachTopics: ["power and consistency", "paddle face", "return to ready"],
  },
  camera: {
    label: "Camera (upper body)",
    signals: ["elbowGap", "contactInFront", "shoulderRotation", "followThrough"],
    coachTopics: [
      "elbow position",
      "contact point in front",
      "follow-through",
      "upper-body rotation",
    ],
  },
};

/** Never measured in the MVP — the coach may never claim to have seen these (§5). */
export const FORBIDDEN_TOPICS: readonly string[] = [
  "weight transfer",
  "stance",
  "footwork",
  "lower-body rotation",
  "spin",
  "ball placement",
  "grip",
];
