import { auth } from "@/auth";

/** The signed-in user, or null. Database session strategy, so user has an id. */
export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}
