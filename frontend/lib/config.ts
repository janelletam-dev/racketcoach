// Shared config, resolved once. Client-exposed values use the NEXT_PUBLIC_ prefix.

/** Public origin of this frontend, for absolute redirect + QR URLs. */
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Backend (Hono on Modal) base URL. Server-side only. */
export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";

/** Session cookie lifetime, in seconds (30 days). */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
