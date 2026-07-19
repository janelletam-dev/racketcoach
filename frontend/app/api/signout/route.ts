import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { APP_URL } from "@/lib/config";

export async function POST() {
  const res = NextResponse.redirect(new URL("/", APP_URL), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
