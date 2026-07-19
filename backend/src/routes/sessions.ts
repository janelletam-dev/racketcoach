import { Hono } from "hono";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db";
import { sessions } from "../db/schema";
import { userIdFromAuthHeader } from "../auth";

export const sessionsRoute = new Hono();

// All of the signed-in user's sessions, newest first.
sessionsRoute.get("/", async (c) => {
  const uid = userIdFromAuthHeader(c.req.header("Authorization"));
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, uid))
    .orderBy(desc(sessions.playedAt));
  return c.json(rows);
});

// One session, scoped to its owner so a user cannot read another's.
sessionsRoute.get("/:id", async (c) => {
  const uid = userIdFromAuthHeader(c.req.header("Authorization"));
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, c.req.param("id")), eq(sessions.userId, uid)))
    .limit(1);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});
