import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { pairings, sessions } from "../db/schema";

/**
 * Board endpoint. The coach station (paddle hardware) POSTs here. No user
 * login; the request is authorized by the pairing code. Keys come straight
 * from the hardware and are not renamed.
 */
const BodySchema = z.object({
  pairingCode: z.string().min(1),
  date: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "date must be an ISO string"),
  goodReps: z.number().int().nonnegative(),
  totalReps: z.number().int().positive(),
  bestStreak: z.number().int().nonnegative(),
  commonFault: z.string(),
  avgSpeed: z.number(),
});

export const sessionRoute = new Hono();

sessionRoute.post("/", async (c) => {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json(
      { error: "invalid body", issues: parsed.error.flatten().fieldErrors },
      400,
    );
  }
  const body = parsed.data;

  const [pairing] = await db
    .select()
    .from(pairings)
    .where(eq(pairings.code, body.pairingCode))
    .limit(1);

  if (!pairing) {
    return c.json({ error: "unknown pairing code" }, 404);
  }
  if (!pairing.userId) {
    return c.json(
      { status: "pending", message: "pairing code not yet claimed" },
      202,
    );
  }

  const [inserted] = await db
    .insert(sessions)
    .values({
      userId: pairing.userId,
      playedAt: new Date(body.date),
      goodReps: body.goodReps,
      totalReps: body.totalReps,
      bestStreak: body.bestStreak,
      commonFault: body.commonFault,
      avgSpeed: body.avgSpeed,
    })
    .returning({ id: sessions.id });

  return c.json({ status: "ok", sessionId: inserted.id }, 200);
});
