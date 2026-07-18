import { db } from "../lib/db";
import { users, pairings, sessions } from "../lib/db/schema";
import { eq } from "drizzle-orm";

const DEMO_USER_ID = "demo-user";
const DEMO_EMAIL = "demo@racketcoach.app";
const CLAIMED_CODE = "ACE123";
const UNCLAIMED_CODE = "NEW777";

// Five sessions with a rising good-rep rate, oldest first.
// good/total gives 42% -> 71%, matching the dashboard's example line.
const RISING = [
  { goodReps: 42, totalReps: 100, bestStreak: 6, commonFault: "late paddle", avgSpeed: 9.4 },
  { goodReps: 52, totalReps: 110, bestStreak: 9, commonFault: "open face", avgSpeed: 10.1 },
  { goodReps: 61, totalReps: 105, bestStreak: 12, commonFault: "late paddle", avgSpeed: 11.0 },
  { goodReps: 66, totalReps: 118, bestStreak: 15, commonFault: "wrist snap", avgSpeed: 11.8 },
  { goodReps: 71, totalReps: 100, bestStreak: 18, commonFault: "late paddle", avgSpeed: 12.6 },
];

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  // Demo user (also serves as the profile row).
  await db
    .insert(users)
    .values({
      id: DEMO_USER_ID,
      name: "Demo Player",
      email: DEMO_EMAIL,
      emailVerified: new Date(),
    })
    .onConflictDoNothing();

  // Fresh sessions every run so the demo stays deterministic.
  await db.delete(sessions).where(eq(sessions.userId, DEMO_USER_ID));

  const now = Date.now();
  const rows = RISING.map((r, i) => ({
    userId: DEMO_USER_ID,
    // spread over the last five weeks, oldest first
    playedAt: new Date(now - (RISING.length - 1 - i) * 7 * DAY),
    ...r,
  }));
  await db.insert(sessions).values(rows);

  // A claimed code (used by the sample curl) and an unclaimed one (shows 202).
  await db
    .insert(pairings)
    .values({ code: CLAIMED_CODE, userId: DEMO_USER_ID })
    .onConflictDoUpdate({
      target: pairings.code,
      set: { userId: DEMO_USER_ID },
    });
  await db
    .insert(pairings)
    .values({ code: UNCLAIMED_CODE, userId: null })
    .onConflictDoNothing();

  console.log("[seed] demo user + 5 rising sessions ready");
  console.log(`[seed]   claimed pairing code:   ${CLAIMED_CODE}`);
  console.log(`[seed]   unclaimed pairing code: ${UNCLAIMED_CODE}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
