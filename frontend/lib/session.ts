import { cookies } from "next/headers";
import { getMe, type ApiUser } from "./api";

export const SESSION_COOKIE = "rc_session";

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
