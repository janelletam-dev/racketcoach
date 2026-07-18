import { and, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, pairings } from "@/lib/db/schema";

/** All of a user's sessions, newest first. */
export async function getUserSessions(userId: string) {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.playedAt));
}

/** One session, scoped to its owner so a user cannot read another's. */
export async function getSessionById(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Pairing codes claimed by a user. */
export async function getUserPairings(userId: string) {
  return db.select().from(pairings).where(eq(pairings.userId, userId));
}
