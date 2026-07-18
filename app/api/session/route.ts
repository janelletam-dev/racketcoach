import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pairings, sessions } from "@/lib/db/schema";

/**
 * The coach station (paddle hardware) POSTs here. There is no user login;
 * the request is authorized by the pairing code. Keys come straight from the
 * hardware and are not renamed.
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

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const [pairing] = await db
    .select()
    .from(pairings)
    .where(eq(pairings.code, body.pairingCode))
    .limit(1);

  if (!pairing) {
    return NextResponse.json(
      { error: "unknown pairing code" },
      { status: 404 },
    );
  }

  // Code exists but no player has claimed it yet: accept, store nothing.
  if (!pairing.userId) {
    return NextResponse.json(
      { status: "pending", message: "pairing code not yet claimed" },
      { status: 202 },
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

  return NextResponse.json(
    { status: "ok", sessionId: inserted.id },
    { status: 200 },
  );
}
