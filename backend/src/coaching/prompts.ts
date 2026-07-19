import type { Signals } from "./signals";
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
