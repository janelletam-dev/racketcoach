import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import { pairings, sessions } from "../db/schema";
import { cameraMetricsSchema, storedSignalsSchema } from "../coaching/signals";

/**
 * Camera metrics endpoint (B9). The browser (Live Motion) submits fused upper-
 * body camera metrics at the end of a rep set. Authorized by pairing code, like
 * the board. Metrics are validated against the §2 camera schema and merged into
 * the user's latest session's `signals` (under `camera`). Absent metric fields
 * stay absent — not measured, never defaulted.
 */
const BodySchema = z.object({
  pairingCode: z.string().min(1),
  metrics: cameraMetricsSchema,
});

export const cameraRoute = new Hono();

cameraRoute.post("/", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json(
      { error: "invalid body", issues: parsed.error.flatten().fieldErrors },
      400,
    );
  }
  const { pairingCode, metrics } = parsed.data;

  const [pairing] = await db
    .select()
    .from(pairings)
    .where(eq(pairings.code, pairingCode))
    .limit(1);
  if (!pairing) return c.json({ error: "unknown pairing code" }, 404);
  if (!pairing.userId) {
    return c.json(
      { status: "pending", message: "pairing code not yet claimed" },
      202,
    );
  }

  const [latest] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, pairing.userId))
    .orderBy(desc(sessions.playedAt))
    .limit(1);
  if (!latest) {
    return c.json({ error: "no session to attach camera metrics to" }, 404);
  }

  // Merge camera metrics into the session's existing signals (keep imu if any).
  let stored: { imu?: unknown; camera?: unknown } = {};
  if (latest.signals) {
    try {
      const prev = storedSignalsSchema.safeParse(JSON.parse(latest.signals));
      if (prev.success) stored = prev.data;
    } catch {
      // malformed — start fresh
    }
  }
  stored.camera = metrics;

  await db
    .update(sessions)
    .set({ signals: JSON.stringify(stored) })
    .where(eq(sessions.id, latest.id));

  return c.json({ status: "ok", sessionId: latest.id }, 200);
});
