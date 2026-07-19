import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../db";
import { pairings, sessions } from "../db/schema";
import { boardSignalsSchema } from "../coaching/signals";
import { analyzeSession } from "../services/analyzeSession";

/**
 * Board endpoint. The coach station POSTs here. No user login; authorized by
 * the pairing code. Accepts EITHER the plain JSON body (unchanged) OR a
 * multipart form: `meta` (the same JSON) + `raw` (binary sensor file).
 */

// Raw sensor files live on the filesystem, never in SQLite. On Modal this is
// the mounted Volume; locally a project-relative dir.
const RAW_DIR = process.env.RAW_DIR ?? "./data/raw";

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
  // Optional §2 aggregates (B2-addendum). Absent = not measured.
  signals: boardSignalsSchema.optional(),
});

export const sessionRoute = new Hono();

sessionRoute.post("/", async (c) => {
  const isMultipart = (c.req.header("content-type") ?? "").includes(
    "multipart/form-data",
  );

  // Pull `meta` (JSON) and optional `raw` file from either request shape.
  let metaRaw: unknown;
  let rawFile: File | null = null;

  if (isMultipart) {
    let form;
    try {
      form = await c.req.parseBody();
    } catch {
      return c.json({ error: "invalid multipart body" }, 400);
    }
    const metaField = form["meta"];
    if (typeof metaField !== "string") {
      return c.json({ error: "multipart requires a `meta` JSON field" }, 400);
    }
    try {
      metaRaw = JSON.parse(metaField);
    } catch {
      return c.json({ error: "`meta` is not valid JSON" }, 400);
    }
    if (form["raw"] instanceof File) rawFile = form["raw"];
  } else {
    try {
      metaRaw = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
  }

  const parsed = BodySchema.safeParse(metaRaw);
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

  const hasRaw = rawFile != null;
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
      signals: body.signals ? JSON.stringify({ imu: body.signals }) : null,
      analysisStatus: hasRaw ? "pending" : null,
    })
    .returning({ id: sessions.id });
  const sessionId = inserted.id;

  // With a raw sensor file: persist it, then run analysis fire-and-forget and
  // 202 (the board never waits on analysis).
  if (hasRaw && rawFile) {
    try {
      await mkdir(RAW_DIR, { recursive: true });
      const rawPath = join(RAW_DIR, `${sessionId}.bin`);
      await writeFile(rawPath, Buffer.from(await rawFile.arrayBuffer()));
      await db
        .update(sessions)
        .set({ rawPath })
        .where(eq(sessions.id, sessionId));
    } catch (err) {
      console.error(`[board] raw write failed for ${sessionId}:`, err);
      await db
        .update(sessions)
        .set({ analysisStatus: "failed" })
        .where(eq(sessions.id, sessionId));
      return c.json({ status: "ok", sessionId, analysis: "failed" }, 202);
    }
    void analyzeSession(sessionId).catch((err) => {
      console.error(`[analyzer] ${sessionId} failed:`, err);
    });
    return c.json({ status: "pending", sessionId }, 202);
  }

  // Plain JSON payload (no raw file): stored as before, no analysis.
  return c.json({ status: "ok", sessionId }, 200);
});
