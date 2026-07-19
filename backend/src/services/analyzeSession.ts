import { eq } from "drizzle-orm";
import { db } from "../db";
import { sessions } from "../db/schema";

/**
 * Post-session analyzer. B3 implements the real work here (parse the raw file
 * for derived features, Claude interprets the signals using the coaching
 * module, Linkup fetches sourced drills, then write analysis + drills + done).
 *
 * For now this is a stub so B2 (ingest) ships on its own: it resolves the
 * session OUT of "pending" to "failed" rather than leaving it stuck. The
 * session still renders without analysis. Never leave a session in "pending".
 */
export async function analyzeSession(sessionId: string): Promise<void> {
  console.log(
    `[analyzer] stub for session ${sessionId} — B3 (Claude + Linkup) not yet implemented`,
  );
  await db
    .update(sessions)
    .set({ analysisStatus: "failed" })
    .where(eq(sessions.id, sessionId));
}
