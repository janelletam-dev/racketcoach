import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { pairings } from "../db/schema";
import { userIdFromAuthHeader } from "../auth";
import { generateCode } from "../code";

export const pairingsRoute = new Hono();

// The signed-in user's pairing code, minting one if they have none.
pairingsRoute.get("/me", async (c) => {
  const uid = userIdFromAuthHeader(c.req.header("Authorization"));
  if (!uid) return c.json({ error: "unauthorized" }, 401);

  const [existing] = await db
    .select()
    .from(pairings)
    .where(eq(pairings.userId, uid))
    .limit(1);
  if (existing) return c.json({ code: existing.code });

  const code = generateCode();
  await db.insert(pairings).values({ code, userId: uid });
  return c.json({ code });
});

// Claim a code (create it if the board's row does not exist yet). Idempotent.
pairingsRoute.post("/claim", async (c) => {
  const uid = userIdFromAuthHeader(c.req.header("Authorization"));
  if (!uid) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ code: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return c.json({ error: "code required" }, 400);

  const code = parsed.data.code.toUpperCase();
  await db
    .insert(pairings)
    .values({ code, userId: uid })
    .onConflictDoUpdate({ target: pairings.code, set: { userId: uid } });
  return c.json({ code, linked: true });
});
