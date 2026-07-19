import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import {
  createLoginToken,
  readLoginToken,
  createSessionToken,
  upsertUserByEmail,
  getUserById,
  userIdFromAuthHeader,
} from "../auth";
import { sendMagicLink } from "../mailer";

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";
const PUBLIC_BACKEND_URL =
  process.env.PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export const authRoute = new Hono();

// Request a magic sign-in link.
authRoute.post("/request-link", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ email: z.string().email() }).safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid email" }, 400);

  await upsertUserByEmail(parsed.data.email);
  const loginToken = createLoginToken(parsed.data.email);
  const url = `${PUBLIC_BACKEND_URL}/api/auth/verify?token=${encodeURIComponent(loginToken)}`;
  await sendMagicLink(parsed.data.email, url);
  return c.json({ ok: true });
});

// Follow the magic link: mint a session token and hand it to the frontend.
authRoute.get("/verify", async (c) => {
  const token = c.req.query("token") ?? "";
  const email = readLoginToken(token);
  if (!email) {
    return c.redirect(`${FRONTEND_URL}/signin?error=expired`);
  }
  const user = await upsertUserByEmail(email);
  const session = createSessionToken(user.id);
  return c.redirect(
    `${FRONTEND_URL}/api/auth/complete?token=${encodeURIComponent(session)}`,
  );
});

// Dev-only shortcut: return a session token for the seeded demo user.
authRoute.post("/demo", async (c) => {
  if (process.env.NODE_ENV === "production") {
    return c.json({ error: "not available in production" }, 403);
  }
  let [demo] = await db
    .select()
    .from(users)
    .where(eq(users.email, "demo@racketcoach.app"))
    .limit(1);
  if (!demo) {
    [demo] = await db
      .insert(users)
      .values({ email: "demo@racketcoach.app", name: "Demo Player" })
      .returning();
  }
  return c.json({ token: createSessionToken(demo.id) });
});

// Current user for a Bearer token.
authRoute.get("/me", async (c) => {
  const uid = userIdFromAuthHeader(c.req.header("Authorization"));
  if (!uid) return c.json({ error: "unauthorized" }, 401);
  const user = await getUserById(uid);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({ id: user.id, name: user.name, email: user.email });
});
