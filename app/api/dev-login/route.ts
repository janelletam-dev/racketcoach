import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, authSessions } from "@/lib/db/schema";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/**
 * Dev-only shortcut: creates a real Auth.js database session for the seeded
 * demo user and sets the session cookie, then sends you to the dashboard.
 * Real magic-link sign-in is still the production path.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not available in production", { status: 403 });
  }

  const [demo] = await db
    .select()
    .from(users)
    .where(eq(users.email, "demo@racketcoach.app"))
    .limit(1);

  if (!demo) {
    return NextResponse.json(
      { error: "Demo user not found. Run `npm run db:seed` first." },
      { status: 404 },
    );
  }

  const sessionToken = crypto.randomUUID();
  const expires = new Date(Date.now() + THIRTY_DAYS);
  await db
    .insert(authSessions)
    .values({ sessionToken, userId: demo.id, expires });

  const res = NextResponse.redirect(new URL("/dashboard", APP_URL));
  res.cookies.set("authjs.session-token", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
  return res;
}
