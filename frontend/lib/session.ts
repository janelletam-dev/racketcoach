import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMe, type ApiUser } from "./api";
import { SESSION_MAX_AGE } from "./config";

export const SESSION_COOKIE = "rc_session";

/** Options for the session cookie, shared by every route that sets it. */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE,
};

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** The signed-in user (validated against the backend), or null. */
export async function getCurrentUser(): Promise<ApiUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  return getMe(token);
}

/**
 * Require an authenticated user in a Server Component. Redirects to /signin when
 * there is no valid session. Wrapped in cache() so several guards within one
 * request dedupe to a single backend /me check.
 */
export const requireUser = cache(
  async (): Promise<{ token: string; user: ApiUser }> => {
    const token = await getSessionToken();
    if (!token) redirect("/signin");
    const user = await getMe(token);
    if (!user) redirect("/signin");
    return { token, user };
  },
);
