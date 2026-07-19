import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const MAX_AGE = 30 * 24 * 60 * 60;

// The backend redirects here after verifying a magic link, handing us a
// session token. We store it in an httpOnly cookie and send you to the app.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/signin?error=missing", APP_URL));
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
