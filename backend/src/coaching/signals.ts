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

/**
 * Station-aggregated IMU signals sent in the board POST (B2-addendum), rolled
 * up from the per-swing §2 packets. All fields optional: an ABSENT field means
 * it was not measured and must never be defaulted.
 */
export const boardSignalsSchema = z
  .object({
    avgSwingSpeed: z.number().describe("mean peak accel over the session, g"),
    avgConsistency: z.number().min(0).max(100).describe("mean consistency, 0-100"),
    faceDroppedRate: z
      .number()
      .min(0)
      .max(1)
      .describe("fraction of swings with a dropped paddle face"),
    avgReturnMs: z.number().describe("mean return-to-ready time, ms"),
  })
  .partial();
export type BoardSignals = z.infer<typeof boardSignalsSchema>;

/** Camera metrics submitted by /api/camera (B9). Partial: absent = not measured. */
export const cameraMetricsSchema = cameraSignalsSchema.partial();
export type CameraMetrics = z.infer<typeof cameraMetricsSchema>;

/** What the session `signals` column stores: IMU aggregates + camera metrics. */
export const storedSignalsSchema = z.object({
  imu: boardSignalsSchema.optional(),
  camera: cameraMetricsSchema.optional(),
});
export type StoredSignals = z.infer<typeof storedSignalsSchema>;
