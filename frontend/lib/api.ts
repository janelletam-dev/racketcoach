// Server-side client for the RacketCoach backend (Hono API on Modal).
// The browser never calls the backend directly; Next server code does, with
// the session token read from an httpOnly cookie.

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";

export type ApiSession = {
  id: string;
  userId: string;
  playedAt: string; // ISO string over the wire
  goodReps: number;
  totalReps: number;
  bestStreak: number;
  commonFault: string | null;
  avgSpeed: number | null;
  createdAt: string;
};

export type ApiUser = {
  id: string;
  name: string | null;
  email: string | null;
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
  return res.ok ? res.json() : null;
}

export async function getSessions(token: string): Promise<ApiSession[]> {
  const res = await backendFetch("/api/sessions", { token });
  return res.ok ? res.json() : [];
}

export async function getSession(
  token: string,
  id: string,
): Promise<ApiSession | null> {
  const res = await backendFetch(`/api/sessions/${id}`, { token });
  return res.ok ? res.json() : null;
}

export async function getMyPairing(token: string): Promise<string | null> {
  const res = await backendFetch("/api/pairings/me", { token });
  return res.ok ? (await res.json()).code : null;
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
