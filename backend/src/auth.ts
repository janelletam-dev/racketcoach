import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./db/schema";

const SECRET = process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me";

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOGIN_TTL = 15 * 60 * 1000; // 15 minutes

function sign(payload: Record<string, unknown>, ttlMs: number): string {
  const body = JSON.stringify({ ...payload, exp: Date.now() + ttlMs });
  const p = Buffer.from(body).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(p).digest("base64url");
  return `${p}.${sig}`;
}

function verify<T = Record<string, unknown>>(token: string): T | null {
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(p)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(p, "base64url").toString());
    if (typeof data.exp === "number" && data.exp < Date.now()) return null;
    return data as T;
  } catch {
    return null;
  }
}

// --- session tokens (long-lived, identify a user) ---
export function createSessionToken(userId: string): string {
  return sign({ uid: userId, t: "session" }, SESSION_TTL);
}
export function readSessionToken(token: string): string | null {
  const data = verify<{ uid: string; t: string }>(token);
  return data && data.t === "session" ? data.uid : null;
}

// --- login tokens (short-lived, sent in the magic link) ---
export function createLoginToken(email: string): string {
  return sign({ email, t: "login" }, LOGIN_TTL);
}
export function readLoginToken(token: string): string | null {
  const data = verify<{ email: string; t: string }>(token);
  return data && data.t === "login" ? data.email : null;
}

// --- user helpers ---
export async function upsertUserByEmail(email: string) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(users).values({ email }).returning();
  return created;
}

export async function getUserById(id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return u ?? null;
}

/** Read the Bearer token from a request and return the user id, or null. */
export function userIdFromAuthHeader(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return readSessionToken(header.slice(7));
}
