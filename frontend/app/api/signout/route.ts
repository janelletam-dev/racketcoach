import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function POST() {
  const res = NextResponse.redirect(new URL("/", APP_URL), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
