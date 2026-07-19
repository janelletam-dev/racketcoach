import { and, eq, desc, ne } from "drizzle-orm";
import { db } from "../db";
import { sessions, type SessionRow } from "../db/schema";
import { buildAnalysisPrompt, type AnalysisContext } from "../coaching/prompts";
import { linkupQueryForFault } from "../coaching/cueLibrary";

const ANALYZER_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
const CALL_TIMEOUT_MS = 20_000;

type Analysis = { summary: string; faultDetail: string; focusAdvice: string };
type Drill = { title: string; url: string; source: string; why: string };

/**
 * Post-session analyzer (B3). Grounds Claude on the measured session summary
 * (via the coaching module's guardrail) for a "Coach's read", and fetches
 * sourced drills from Linkup for the diagnosed fault. Fire-and-forget from the
 * board endpoint.
 *
 * Graceful degradation: a missing key or a failed external call just drops that
 * half of the output. The session ALWAYS resolves out of "pending" (never left
 * stuck) and still renders without analysis.
 *
 * (Parsing the raw IMU stream into derived features lands once the firmware wire
 * format is fixed; today the analyzer grounds on the aggregate signals and the
 * paddle's classified commonFault, which are what is actually measured.)
 */
export async function analyzeSession(sessionId: string): Promise<void> {
  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session) return;

    const history = await db
      .select()
      .from(sessions)
      .where(
        and(eq(sessions.userId, session.userId), ne(sessions.id, sessionId)),
      )
      .orderBy(desc(sessions.playedAt))
      .limit(5);

    const context = buildContext(session, history);

    const [analysis, drills] = await Promise.all([
      runClaude(context).catch((e) => {
        console.error(`[analyzer] claude failed for ${sessionId}:`, e);
        return null;
      }),
      runLinkup(session.commonFault).catch((e) => {
        console.error(`[analyzer] linkup failed for ${sessionId}:`, e);
        return null;
      }),
    ]);

    const produced = Boolean(analysis) || Boolean(drills && drills.length);
    await db
      .update(sessions)
      .set({
        analysis: analysis ? JSON.stringify(analysis) : null,
        drills: drills && drills.length ? JSON.stringify(drills) : null,
        analysisStatus: produced ? "done" : "failed",
      })
      .where(eq(sessions.id, sessionId));

    console.log(
      `[analyzer] ${sessionId}: ${produced ? "done" : "failed"} (analysis=${!!analysis}, drills=${drills?.length ?? 0})`,
    );
  } catch (err) {
    console.error(`[analyzer] fatal for ${sessionId}:`, err);
    await db
      .update(sessions)
      .set({ analysisStatus: "failed" })
      .where(eq(sessions.id, sessionId))
      .catch(() => {});
  }
}

function goodRepRate(s: Pick<SessionRow, "goodReps" | "totalReps">): number {
  return s.totalReps ? s.goodReps / s.totalReps : 0;
}

function buildContext(session: SessionRow, history: SessionRow[]): AnalysisContext {
  let trend: string | null = null;
  if (history.length >= 1) {
    const oldest = history[history.length - 1]; // history is newest-first
    const from = Math.round(goodRepRate(oldest) * 100);
    const to = Math.round(goodRepRate(session) * 100);
    if (from !== to) {
      trend = `good-rep rate ${from}% -> ${to}% over the last ${history.length + 1} sessions`;
    }
  }
  return {
    goodReps: session.goodReps,
    totalReps: session.totalReps,
    bestStreak: session.bestStreak,
    avgSpeed: session.avgSpeed,
    durationSeconds: session.durationSeconds,
    commonFault: session.commonFault,
    trend,
  };
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function runClaude(context: AnalysisContext): Promise<Analysis | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.log("[analyzer] ANTHROPIC_API_KEY not set — skipping Claude analysis");
    return null;
  }
  const { system, user } = buildAnalysisPrompt(context);
  return withRetry(async () => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANALYZER_MODEL,
        max_tokens: 500,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { content?: { text?: string }[] };
    return parseAnalysis(data.content?.[0]?.text ?? "");
  });
}

function parseAnalysis(text: string): Analysis {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      return {
        summary: String(obj.summary ?? "").trim(),
        faultDetail: String(obj.faultDetail ?? "").trim(),
        focusAdvice: String(obj.focusAdvice ?? "").trim(),
      };
    } catch {
      // not valid JSON — fall through to plain text
    }
  }
  return { summary: text.trim().slice(0, 400), faultDetail: "", focusAdvice: "" };
}

async function runLinkup(commonFault: string | null): Promise<Drill[] | null> {
  const key = process.env.LINKUP_API_KEY;
  if (!key) {
    console.log("[analyzer] LINKUP_API_KEY not set — skipping Linkup drills");
    return null;
  }
  const q = linkupQueryForFault(commonFault);
  return withRetry(async () => {
    const res = await fetch("https://api.linkup.so/v1/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        q,
        depth: "standard",
        outputType: "searchResults",
        maxResults: 3,
        includeImages: false,
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Linkup ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      results?: { name?: string; url?: string; content?: string }[];
    };
    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .filter((r) => r?.url && r?.name)
      .slice(0, 3)
      .map((r) => ({
        title: String(r.name),
        url: String(r.url),
        source: hostname(String(r.url)),
        why: String(r.content ?? "").slice(0, 200),
      }));
  });
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
