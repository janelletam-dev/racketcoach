import type { Signals, StoredSignals } from "./signals";
import { SIGNAL_GROUPS, FORBIDDEN_TOPICS } from "./signals";
import { presentGroups, CUE_LIBRARY } from "./cueLibrary";

/**
 * The two coaching prompts (coaching-knowledge.md §6). The MEASURED block and
 * the allowed / forbidden topic lists are GENERATED from the signals actually
 * present (§8 enforcement) — never hardcoded per call. The guardrail is code.
 */

/** Render the MEASURED block from ONLY the signals actually captured (§8 rule 1). */
export function renderMeasuredBlock(s: Signals): string {
  const lines: string[] = [
    `goodReps: ${s.goodReps}   totalReps: ${s.totalReps}   bestStreak: ${s.bestStreak}`,
  ];

  if (presentGroups(s).includes("imu")) {
    const i = s.imu!;
    const parts: string[] = [];
    if (i.swingSpeed != null) parts.push(`swingSpeed: ${i.swingSpeed}g`);
    if (i.consistency != null) parts.push(`consistency: ${i.consistency}`);
    if (i.paddleFace != null) parts.push(`paddleFace: ${i.paddleFace}`);
    if (i.returnTime != null) parts.push(`returnTime: ${i.returnTime}ms`);
    if (parts.length) lines.push(parts.join("   "));
  }

  if (presentGroups(s).includes("camera")) {
    const c = s.camera!;
    const parts: string[] = [];
    if (c.elbowGap != null) parts.push(`elbowGap: ${c.elbowGap}`);
    if (c.contactInFront != null) parts.push(`contactInFront: ${c.contactInFront}`);
    if (c.shoulderRotation != null) parts.push(`shoulderRotation: ${c.shoulderRotation}deg`);
    if (c.followThrough != null) parts.push(`followThrough: ${c.followThrough}`);
    if (parts.length) lines.push(parts.join("   "));
  }

  return lines.join("\n  ");
}

/** Topics the coach MAY observe = those whose signal group is present. */
export function allowedTopics(s: Signals): string[] {
  return presentGroups(s).flatMap((g) => [...SIGNAL_GROUPS[g].coachTopics]);
}

/**
 * Topics the coach may NOT claim to have observed: the always-forbidden §5 list,
 * plus any signal group that did not run this session (e.g. camera off -> elbow,
 * contact point, follow-through, rotation move to forbidden).
 */
export function forbiddenTopics(s: Signals): string[] {
  const present = presentGroups(s);
  const missingGroupTopics = (["imu", "camera"] as const)
    .filter((g) => !present.includes(g))
    .flatMap((g) => [...SIGNAL_GROUPS[g].coachTopics]);
  return [...FORBIDDEN_TOPICS, ...missingGroupTopics];
}

/** Reactive cue prompt (§6): one spoken sentence drawn from the cue library. */
export function buildReactivePrompt(s: Signals): { system: string; user: string } {
  const allowed = allowedTopics(s);
  const forbidden = forbiddenTopics(s);
  const cueList = CUE_LIBRARY.map((c) => `- ${c.fault}: "${c.cue}"`).join("\n");

  const system = [
    "You are a table tennis coach for a beginner. Base every OBSERVATION only on the measured signals given by the user.",
    allowed.length
      ? `You may coach on: ${allowed.join(", ")}.`
      : "Coach only on the rep totals given.",
    `You may NOT claim to have seen: ${forbidden.join(", ")} — those are not measured in this session.`,
    "Give ONE short, encouraging cue (one sentence), drawn from the cue library.",
  ].join(" ");

  const user = `MEASURED:\n  ${renderMeasuredBlock(s)}\n\nCUE LIBRARY:\n${cueList}\n\nOUTPUT: one cue only.`;
  return { system, user };
}

/** Conversation prompt (§6): general Q&A, no invented observations. */
export const CONVERSATION_SYSTEM = [
  "You are a table tennis coach. Answer the player's question from general table tennis coaching knowledge (grip, spin, technique, drills, anything).",
  "This is a general question, not a claim about their swing, so answer freely.",
  "Do NOT invent observations about the player's last swing beyond the measured signals.",
  "Keep it to two sentences, spoken and encouraging.",
].join(" ");

/** Measured inputs available to the post-session analyzer (B3). */
export type AnalysisContext = {
  goodReps: number;
  totalReps: number;
  bestStreak: number;
  avgSpeed: number | null;
  durationSeconds: number | null;
  commonFault: string | null;
  trend: string | null; // e.g. "good-rep rate 52% -> 71% over the last 5 sessions"
  signals: StoredSignals | null; // §2 aggregates; only present fields are shown
};

/** Render the stored §2 signal aggregates into MEASURED lines. Present fields
 * only — an absent field is never shown or defaulted (guardrail). */
export function renderSignalsMeasured(s: StoredSignals | null): string[] {
  const lines: string[] = [];
  if (!s) return lines;
  if (s.imu) {
    const i = s.imu;
    const parts: string[] = [];
    if (i.avgSwingSpeed != null) parts.push(`avgSwingSpeed: ${i.avgSwingSpeed}g`);
    if (i.avgConsistency != null) parts.push(`avgConsistency: ${i.avgConsistency}`);
    if (i.faceDroppedRate != null)
      parts.push(`faceDroppedRate: ${Math.round(i.faceDroppedRate * 100)}%`);
    if (i.avgReturnMs != null) parts.push(`avgReturnMs: ${i.avgReturnMs}ms`);
    if (parts.length) lines.push(parts.join("   "));
  }
  if (s.camera) {
    const c = s.camera;
    const parts: string[] = [];
    if (c.elbowGap != null) parts.push(`elbowGap: ${c.elbowGap}`);
    if (c.contactInFront != null) parts.push(`contactInFront: ${c.contactInFront}`);
    if (c.shoulderRotation != null)
      parts.push(`shoulderRotation: ${c.shoulderRotation}deg`);
    if (c.followThrough != null) parts.push(`followThrough: ${c.followThrough}`);
    if (parts.length) lines.push(parts.join("   "));
  }
  return lines;
}

/**
 * Post-session analysis prompt. Grounded on the measured summary only (rep
 * totals, best streak, avg swing speed, the paddle's most-common fault, trend),
 * forbids unmeasured topics (§5), and asks for structured JSON so the dashboard
 * can render a "Coach's read" card. Same honest rule as the reactive cue.
 */
export function buildAnalysisPrompt(ctx: AnalysisContext): {
  system: string;
  user: string;
} {
  const rate = ctx.totalReps
    ? Math.round((ctx.goodReps / ctx.totalReps) * 100)
    : 0;
  const measured = [
    `goodReps: ${ctx.goodReps}   totalReps: ${ctx.totalReps}   goodRepRate: ${rate}%   bestStreak: ${ctx.bestStreak}`,
    ...renderSignalsMeasured(ctx.signals),
    ctx.avgSpeed != null ? `avgSpeed: ${ctx.avgSpeed}` : null,
    ctx.durationSeconds != null ? `durationSeconds: ${ctx.durationSeconds}` : null,
    ctx.commonFault ? `mostCommonFault: ${ctx.commonFault}` : null,
    ctx.trend ? `trend: ${ctx.trend}` : null,
  ]
    .filter(Boolean)
    .join("\n  ");

  const system = [
    "You are a table tennis coach reviewing a beginner's practice session.",
    "Base every observation ONLY on the measured summary given by the user (rep totals, best streak, average swing speed, the most common fault the paddle detected, and the trend).",
    `You may NOT claim to have seen ${FORBIDDEN_TOPICS.join(", ")} — those are not measured.`,
    'Respond with ONLY a JSON object: {"summary": one encouraging sentence on how the session went, "faultDetail": one sentence naming the most common fault and why it matters, "focusAdvice": one concrete thing to focus on next session}. No text outside the JSON.',
  ].join(" ");

  const user = `MEASURED:\n  ${measured}`;
  return { system, user };
}

/**
 * Conversation prompt with the station's aggregate snapshot (B7 /api/voice).
 * The reply is SPOKEN by the device — plain text only, no markdown/emoji.
 * The snapshot is the only session data the coach may reference (§5/§6).
 */
export function buildConversationPrompt(snapshot: {
  player?: number;
  goodReps?: number;
  streak?: number;
  bestStreak?: number;
  avgSpeed?: number;
}): string {
  const parts: string[] = [];
  if (snapshot.goodReps != null) parts.push(`good reps ${snapshot.goodReps}`);
  if (snapshot.streak != null) parts.push(`current streak ${snapshot.streak}`);
  if (snapshot.bestStreak != null)
    parts.push(`best streak ${snapshot.bestStreak}`);
  if (snapshot.avgSpeed != null)
    parts.push(`station-reported average swing speed ${snapshot.avgSpeed}`);
  return [
    CONVERSATION_SYSTEM,
    "Your answer is spoken aloud by a small speaker: plain conversational text only — no markdown, no lists, no emoji.",
    parts.length
      ? `Station snapshot for this player (the ONLY session data you may reference): ${parts.join(", ")}.`
      : "No session snapshot is available — do not reference any session numbers.",
  ].join(" ");
}
