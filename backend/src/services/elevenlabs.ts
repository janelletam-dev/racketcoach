import { config } from "../config";

/**
 * ElevenLabs STT + TTS, shared by the station voice endpoint (B7 /api/voice,
 * WAV in) and the web "Ask your coach" endpoints (B11 /api/coach/speak +
 * /transcribe, browser webm/opus in). Keys, timeout, and TTS model come from
 * config. Callers handle graceful degradation (503 on missing key, 502 on
 * upstream failure).
 */

function timedFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(config.externalTimeoutMs),
  });
}

function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return ".webm";
  if (m.includes("ogg") || m.includes("opus")) return ".ogg";
  if (m.includes("mp4") || m.includes("m4a")) return ".m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  return ".wav";
}

/**
 * Speech to text (scribe_v1). The incoming mime is passed through to ElevenLabs
 * unchanged — the station sends audio/wav, browsers send audio/webm;codecs=opus
 * (never assume WAV). Throws on a missing key or a non-2xx upstream.
 */
export async function speechToText(
  audio: Buffer,
  mime = "audio/wav",
  filename = "audio",
): Promise<string> {
  const key = config.elevenLabsApiKey;
  if (!key) throw new Error("ELEVENLABS_API_KEY not set");

  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: mime }),
    `${filename}${extForMime(mime)}`,
  );

  const res = await timedFetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

/** Text to speech for a specific voice id → MP3 bytes. */
export async function textToSpeech(
  text: string,
  voiceId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = config.elevenLabsApiKey;
  if (!key) throw new Error("ELEVENLABS_API_KEY not set");

  const res = await timedFetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: config.elevenLabsTtsModel }),
    },
  );
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}
