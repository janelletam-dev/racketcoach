import { NextResponse } from "next/server";
import { demoLogin } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/session";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const MAX_AGE = 30 * 24 * 60 * 60;

// Dev-only shortcut: ask the backend for a demo-user session token and store it.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not available in production", { status: 403 });
  }
  const token = await demoLogin();
  if (!token) {
    return NextResponse.json(
      { error: "backend demo login failed (is the backend running?)" },
      { status: 502 },
    );
  }
  const res = NextResponse.redirect(new URL("/dashboard", APP_URL));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}
