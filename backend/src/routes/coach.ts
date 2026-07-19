import { Hono } from "hono";
import { z } from "zod";
import { userIdFromAuthHeader } from "../auth";
import { config } from "../config";
import {
  loadRecentSessions,
  goodRepRate,
  trendLine,
  faultSummary,
} from "../services/history";
import { buildWebCoachPrompt } from "../coaching/prompts";
import { speechToText, textToSpeech } from "../services/elevenlabs";

/**
 * B11 — POST /api/coach/ask. The logged-in web player asks about their play and
 * gets an in-depth, grounded answer. Bearer-authorized (no device token, unlike
 * /api/voice). Reuses B3's history/trend assembly (services/history.ts). Text
 * in, text out; ElevenLabs audio (?speak=1) is a later phase.
 *
 * Graceful: no ANTHROPIC key -> 503; upstream failure -> 502. Never hangs.
 */
export const coachRoute = new Hono();

coachRoute.post("/ask", async (c) => {
  const uid = userIdFromAuthHeader(c.req.header("Authorization"));
  if (!uid) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({ question: z.string().min(1).max(500) })
    .safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "question required (1-500 chars)" }, 400);
  }

  if (!config.anthropicApiKey) {
    return c.json({ error: "coach not configured" }, 503);
  }

  const recent = await loadRecentSessions(uid, 10);

  // Existing Claude reads (B3) give the coach continuity across sessions.
  const analyses: string[] = [];
  for (const s of recent) {
    if (!s.analysis) continue;
    try {
      const a = JSON.parse(s.analysis);
      if (a?.summary) analyses.push(String(a.summary));
    } catch {
      // skip malformed
    }
  }

  const summary = {
    sessionCount: recent.length,
    latestRate: recent[0] ? Math.round(goodRepRate(recent[0]) * 100) : null,
    bestStreak: recent.length
      ? Math.max(...recent.map((s) => s.bestStreak))
      : null,
    trend: trendLine(recent),
    faults: faultSummary(recent),
    analyses: analyses.slice(0, 3),
  };

  const { system, user } = buildWebCoachPrompt(summary, parsed.data.question);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(config.externalTimeoutMs),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const answer = data.content?.find((b) => b.type === "text")?.text?.trim();
    if (!answer) throw new Error("empty answer");
    return c.json({ answer });
  } catch (err) {
    console.error("[coach] ask failed:", err);
    return c.json({ error: "coach unavailable" }, 502);
  }
});

/**
 * Voice OUT: TTS a coach answer with the selected voice → raw MP3 bytes.
 * Bearer-authorized. Voice ids come from the Modal secret (male/female).
 */
coachRoute.post("/speak", async (c) => {
  const uid = userIdFromAuthHeader(c.req.header("Authorization"));
  if (!uid) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      text: z.string().min(1).max(600),
      voice: z.enum(["male", "female"]),
    })
    .safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "text (1-600) and voice (male|female) required" }, 400);
  }

  const voiceId =
    parsed.data.voice === "male"
      ? config.elevenLabsVoiceIdMale
      : config.elevenLabsVoiceIdFemale;
  if (!config.elevenLabsApiKey || !voiceId) {
    return c.json({ error: "voice not configured" }, 503);
  }

  try {
    const mp3 = await textToSpeech(parsed.data.text, voiceId);
    return c.body(mp3, 200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(mp3.byteLength),
    });
  } catch (err) {
    console.error("[coach] speak failed:", err);
    return c.json({ error: "tts unavailable" }, 502);
  }
});

/**
 * Voice IN: transcribe recorded audio → text. Accepts ANY audio/* — browsers
 * record webm/opus, not WAV — and passes the incoming mime straight through to
 * ElevenLabs. Bearer-authorized.
 */
coachRoute.post("/transcribe", async (c) => {
  const uid = userIdFromAuthHeader(c.req.header("Authorization"));
  if (!uid) return c.json({ error: "unauthorized" }, 401);

  const contentType = c.req.header("content-type") ?? "";
  const baseMime = contentType.split(";")[0].trim();
  if (!baseMime.startsWith("audio/")) {
    return c.json({ error: "an audio/* body is required" }, 400);
  }
  if (!config.elevenLabsApiKey) {
    return c.json({ error: "transcribe not configured" }, 503);
  }

  const audio = Buffer.from(await c.req.arrayBuffer());
  if (audio.length < 64) {
    return c.json({ error: "audio body missing" }, 400);
  }

  try {
    const text = await speechToText(audio, contentType || baseMime, "recording");
    return c.json({ text });
  } catch (err) {
    console.error("[coach] transcribe failed:", err);
    return c.json({ error: "transcribe unavailable" }, 502);
  }
});
