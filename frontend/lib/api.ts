// Server-side client for the RacketCoach backend (Hono API on Modal).
// The browser never calls the backend directly; Next server code does, with
// the session token read from an httpOnly cookie.

import { redirect } from "next/navigation";
import { BACKEND_URL } from "./config";

// Mirrors a sessions row from the backend. keep in sync with
// backend/src/db/schema.ts
export type ApiSession = {
  id: string;
  userId: string;
  playedAt: string; // ISO string over the wire
  goodReps: number;
  totalReps: number;
  bestStreak: number;
  commonFault: string | null;
  avgSpeed: number | null;
  durationSeconds: number | null;
  // §2 signal aggregates as a JSON string ({ imu?, camera? }); parse with
  // lib/signals. Null on old/demo sessions; a real station upload fills it.
  signals: string | null;
  // Analysis pipeline (B1). `analysis` + `drills` arrive as JSON strings; parse
  // with lib/analysis. Null until the analyzer runs.
  analysis: string | null;
  drills: string | null;
  analysisStatus: string | null;
  createdAt: string;
};

// keep in sync with backend/src/db/schema.ts
export type ApiUser = {
  id: string;
  name: string | null;
  email: string | null;
  // Chosen sport (B10). undefined = backend column not deployed yet; null =
  // deployed but not chosen; a string = chosen ("table_tennis" or an interest).
  sport?: string | null;
};

type FetchOpts = { token?: string; method?: string; body?: unknown };

async function backendFetch(path: string, opts: FetchOpts = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${BACKEND_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
}

export async function getMe(token: string): Promise<ApiUser | null> {
  const res = await backendFetch("/api/auth/me", { token });
  // 401 means "not signed in" — return null so callers (guards, getCurrentUser)
  // can decide. Any other non-OK is a real failure; surface it, don't swallow.
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Auth check failed (${res.status})`);
  return res.json();
}

export async function getSessions(token: string): Promise<ApiSession[]> {
  const res = await backendFetch("/api/sessions", { token });
  if (res.status === 401) redirect("/signin");
  // Never map a failure to [] — that renders as a lying "No sessions yet".
  if (!res.ok) throw new Error(`Failed to load sessions (${res.status})`);
  return res.json();
}

export async function getSession(
  token: string,
  id: string,
): Promise<ApiSession | null> {
  const res = await backendFetch(`/api/sessions/${id}`, { token });
  if (res.status === 401) redirect("/signin");
  if (res.status === 404) return null; // genuinely missing — caller can 404
  if (!res.ok) throw new Error(`Failed to load session (${res.status})`);
  return res.json();
}

export async function getMyPairing(token: string): Promise<string | null> {
  const res = await backendFetch("/api/pairings/me", { token });
  if (res.status === 401) redirect("/signin");
  if (!res.ok) throw new Error(`Failed to load pairing (${res.status})`);
  return (await res.json()).code;
}

export async function claimPairing(
  token: string,
  code: string,
): Promise<string | null> {
  const res = await backendFetch("/api/pairings/claim", {
    token,
    method: "POST",
    body: { code },
  });
  return res.ok ? (await res.json()).code : null;
}

export async function requestMagicLink(email: string): Promise<boolean> {
  const res = await backendFetch("/api/auth/request-link", {
    method: "POST",
    body: { email },
  });
  return res.ok;
}

export async function demoLogin(): Promise<string | null> {
  const res = await backendFetch("/api/auth/demo", { method: "POST" });
  return res.ok ? (await res.json()).token : null;
}

/** Set the signed-in user's chosen sport (B10 onboarding). */
export async function setSport(token: string, sport: string): Promise<boolean> {
  const res = await backendFetch("/api/auth/sport", {
    token,
    method: "POST",
    body: { sport },
  });
  return res.ok;
}

export type CoachAnswer = {
  answer?: string;
  error?: string;
  // The endpoint isn't deployed yet (404). Callers hide the feature rather than
  // surfacing an error — keeps a frontend deploy safe ahead of cc2's B11 backend.
  unavailable?: boolean;
};

/** Ask the web coach a question (B11). POST /api/coach/ask → { answer }. */
export async function askCoach(
  token: string,
  question: string,
): Promise<CoachAnswer> {
  const res = await backendFetch("/api/coach/ask", {
    token,
    method: "POST",
    body: { question },
  });
  if (res.status === 404) return { unavailable: true };
  if (res.status === 401) return { error: "Please sign in again." };
  if (!res.ok) {
    return { error: "The coach couldn't answer that one. Try again." };
  }
  const data = (await res.json().catch(() => null)) as { answer?: string } | null;
  if (!data?.answer) {
    return { error: "The coach didn't have a read on that. Try rephrasing." };
  }
  return { answer: data.answer };
}

/**
 * Feature-detect POST /api/coach/ask so the "Ask your coach" card can hide until
 * the backend ships. A missing route 404s; a live route validates the empty body
 * and returns 4xx — never a Claude call. Any non-404 (or an unreachable backend)
 * fails safe: unreachable → hidden, present-but-erroring → shown.
 */
export async function isCoachAvailable(token: string): Promise<boolean> {
  try {
    const res = await backendFetch("/api/coach/ask", {
      token,
      method: "POST",
      body: {},
    });
    return res.status !== 404;
  } catch {
    return false;
  }
}
