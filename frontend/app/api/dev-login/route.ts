import { NextResponse } from "next/server";
import { demoLogin } from "@/lib/api";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { APP_URL } from "@/lib/config";

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
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
