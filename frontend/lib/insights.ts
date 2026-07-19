import type { ApiSession as SessionRow } from "@/lib/api";

export function goodRepRate(s: Pick<SessionRow, "goodReps" | "totalReps">) {
  if (!s.totalReps) return 0;
  return s.goodReps / s.totalReps;
}

export function pct(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Plain-language read on progress, e.g.
 * "Your good-rep rate went from 42% to 71% over your last 5 sessions."
 * `sessions` is newest-first.
 */
export function improvementLine(sessions: SessionRow[]): string {
  if (sessions.length < 2) {
    return "Play a couple more sessions and RacketCoach will start tracking your progress.";
  }
  const chrono = [...sessions].reverse(); // oldest -> newest
  const window = chrono.slice(-5);
  const first = window[0];
  const last = window[window.length - 1];
  const firstRate = pct(goodRepRate(first));
  const lastRate = pct(goodRepRate(last));
  const n = window.length;

  if (goodRepRate(last) > goodRepRate(first)) {
    return `Your good-rep rate went from ${firstRate} to ${lastRate} over your last ${n} sessions.`;
  }
  if (goodRepRate(last) < goodRepRate(first)) {
    return `Your good-rep rate moved from ${firstRate} to ${lastRate} over your last ${n} sessions. Time to reset the basics.`;
  }
  return `Your good-rep rate is holding steady at ${lastRate} over your last ${n} sessions.`;
}

/** A simple next goal derived from the latest session (newest-first list). */
export function currentGoal(sessions: SessionRow[]): string {
  if (sessions.length === 0) return "Log your first session to set a goal.";
  const latest = sessions[0];
  const rate = goodRepRate(latest);
  if (rate < 0.8) {
    return `Reach an 80% good-rep rate. You are at ${pct(rate)}.`;
  }
  return `Beat your best streak of ${latest.bestStreak}.`;
}

/** Count how often each fault shows up, most common first. */
export function faultBreakdown(
  sessions: SessionRow[],
): { fault: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const f = s.commonFault?.trim() || "none";
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([fault, count]) => ({ fault, count }))
    .sort((a, b) => b.count - a.count);
}
