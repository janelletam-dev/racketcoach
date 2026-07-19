import { Hono } from "hono";
import { config } from "../config";
import { buildConversationPrompt } from "../coaching/prompts";

/**
 * B7 — POST /api/voice. One brain for BOTH devices (coach station + Genesis
 * mini): recorded question in, spoken answer out. Built to the firmware
 * client's contract (voice_coach.h voicePost()):
 *
 *   POST {VOICE_ENDPOINT_URL}?player=&goodReps=&streak=&bestStreak=&avgSpeed=
 *   Content-Type: audio/wav (16 kHz mono PCM, ≤6 s)  →  200 + raw MP3 bytes
 *   in the body (the device streams them to SD and plays; it does NOT follow
 *   a URL). Any non-200 is simply logged by the device — safe to fail.
 *
 * Device auth: VOICE_ENDPOINT_URL in the device's secrets.h carries the token
 * as `?key=<token>`. NOTE the firmware appends its params with a second "?"
 * (snprintf "%s?player=..."), so the wire query can arrive MANGLED as
 * `key=TOKEN?player=3&goodReps=1`. We tolerate both forms below rather than
 * requiring a firmware change — that client is hardware-verified as-is.
 *
 * Pipeline: ElevenLabs STT → Claude (conversation prompt, §6 guardrail) →
 * ElevenLabs TTS. All keys server-side (D4). Missing keys → 503 (the device
 * logs "POST failed" and carries on — graceful degradation, same policy as
 * the analyzer).
 */

const MAX_WAV_BYTES = 2 * 1024 * 1024; // 16kHz*2B*6s ≈ 192KB; allow headroom

export const voiceRoute = new Hono();

voiceRoute.post("/", async (c) => {
  // --- device auth (tolerating the firmware's double-"?" query) ---
  if (!config.voiceDeviceToken) {
    return c.json({ error: "voice endpoint not configured" }, 503);
  }
  const q = parseDeviceQuery(new URL(c.req.url));
  if (q.key !== config.voiceDeviceToken) {
    return c.json({ error: "unauthorized" }, 401);
  }

  if (!config.elevenLabsApiKey || !config.anthropicApiKey) {
    return c.json({ error: "voice pipeline keys not configured" }, 503);
  }

  // --- request audio ---
  const wav = Buffer.from(await c.req.arrayBuffer());
  if (wav.length < 128 || wav.length > MAX_WAV_BYTES) {
    return c.json({ error: "audio body missing or out of range" }, 400);
  }

  try {
    const question = await speechToText(wav);
    if (!question.trim()) {
      return c.json({ error: "no speech recognized" }, 422);
    }
    console.log(`[voice] Q (player ${q.player ?? "?"}): ${question}`);

    const answer = await askCoach(question, q);
    console.log(`[voice] A: ${answer}`);

    const mp3 = await textToSpeech(answer);
    return c.body(mp3, 200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(mp3.byteLength),
    });
  } catch (err) {
    console.error(`[voice] pipeline failed:`, err);
    return c.json({ error: "voice pipeline failed" }, 502);
  }
});

/**
 * Parse the device query. Clean form: ?key=T&player=1&... Mangled firmware
 * form: ?key=T?player=1&... (the value of `key` swallows the rest). Split any
 * param value at "?" and re-parse the tail as more params.
 */
export function parseDeviceQuery(url: URL): {
  key?: string;
  player?: number;
  goodReps?: number;
  streak?: number;
  bestStreak?: number;
  avgSpeed?: number;
} {
  const flat = new Map<string, string>();
  const absorb = (k: string, v: string) => {
    const qm = v.indexOf("?");
    if (qm === -1) {
      flat.set(k, v);
      return;
    }
    flat.set(k, v.slice(0, qm));
    for (const [k2, v2] of new URLSearchParams(v.slice(qm + 1))) absorb(k2, v2);
  };
  for (const [k, v] of url.searchParams) absorb(k, v);

  const num = (k: string): number | undefined => {
    const n = Number(flat.get(k));
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    key: flat.get("key"),
    player: num("player"),
    goodReps: num("goodReps"),
    streak: num("streak"),
    bestStreak: num("bestStreak"),
    avgSpeed: num("avgSpeed"),
  };
}

// ---------- pipeline stages (timeout per call; no retry — latency budget) ----

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(config.externalTimeoutMs) });
}

async function speechToText(wav: Buffer): Promise<string> {
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append(
    "file",
    new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
    "question.wav",
  );
  const res = await timedFetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": config.elevenLabsApiKey! },
    body: form,
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

async function askCoach(
  question: string,
  snapshot: Parameters<typeof buildConversationPrompt>[0],
): Promise<string> {
  const res = await timedFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicApiKey!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 200,
      system: buildConversationPrompt(snapshot),
      messages: [{ role: "user", content: question }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = data.content?.find((b) => b.type === "text")?.text?.trim();
  if (!text) throw new Error("empty coach reply");
  return text;
}

async function textToSpeech(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await timedFetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoiceId}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsApiKey!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, model_id: config.elevenLabsTtsModel }),
    },
  );
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}
