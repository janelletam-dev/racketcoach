import { and, eq, desc, ne } from "drizzle-orm";
import { db } from "../db";
import { sessions, type SessionRow } from "../db/schema";

/**
 * Shared session history / trend assembly. Used by the analyzer (B3) and the
 * web coach (B11) so the trend/fault logic lives in exactly one place.
 */

export function goodRepRate(s: Pick<SessionRow, "goodReps" | "totalReps">): number {
  return s.totalReps ? s.goodReps / s.totalReps : 0;
}

/** A user's recent sessions, newest first. */
export function loadRecentSessions(
  userId: string,
  limit = 10,
): Promise<SessionRow[]> {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.playedAt))
    .limit(limit);
}

/** A user's recent sessions excluding one (B3's per-session history window). */
export function loadHistoryExcluding(
  userId: string,
  excludeId: string,
  limit = 5,
): Promise<SessionRow[]> {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, excludeId)))
    .orderBy(desc(sessions.playedAt))
    .limit(limit);
}

/**
 * "good-rep rate X% -> Y% over the last N sessions" from a newest-first list
 * (the latest is index 0). Null when flat or fewer than two sessions.
 */
export function trendLine(newestFirst: SessionRow[]): string | null {
  if (newestFirst.length < 2) return null;
  const from = Math.round(goodRepRate(newestFirst[newestFirst.length - 1]) * 100);
  const to = Math.round(goodRepRate(newestFirst[0]) * 100);
  if (from === to) return null;
  return `good-rep rate ${from}% -> ${to}% over the last ${newestFirst.length} sessions`;
}

/** Fault counts across sessions, most common first. */
export function faultSummary(
  list: SessionRow[],
): { fault: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of list) {
    const f = s.commonFault?.trim();
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([fault, count]) => ({ fault, count }))
    .sort((a, b) => b.count - a.count);
}
