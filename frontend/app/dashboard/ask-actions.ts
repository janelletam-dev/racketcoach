"use server";

import { getSessionToken } from "@/lib/session";
import {
  askCoach,
  coachSpeak,
  coachTranscribe,
  type ChatTurn,
  type VoiceGender,
} from "@/lib/api";

/**
 * B11.2 chat ask. Direct-callable (not a form action) so the chat thread can
 * drive it for both text and mic. `history` is the recent turns, mapped into
 * Claude's messages. Server-side so the session token never reaches the browser;
 * errors render honestly (A11).
 */
export async function askAction(
  question: string,
  history: ChatTurn[] = [],
): Promise<{ answer?: string; error?: string }> {
  const q = question?.trim();
  if (!q) return { error: "Type a question first." };

  const token = await getSessionToken();
  if (!token) return { error: "Please sign in again." };

  const result = await askCoach(token, q, history);
  if (result.unavailable) {
    return { error: "The coach isn't taking questions yet." };
  }
  if (result.error) return { error: result.error };
  return { answer: result.answer };
}

// /api/coach/speak caps text at 600 chars, but answers can be long-form. Trim to
// the last full sentence under the cap so a long answer still speaks cleanly
// instead of 400-ing (the spoken version can be shorter than the shown text).
function fitForTts(text: string, max = 600): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const stop = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  return stop > max * 0.5 ? slice.slice(0, stop + 1) : slice.trimEnd();
}

/** TTS: speak the coach's answer in the chosen ElevenLabs voice (Anya/Miles ->
 *  female/male). Returns base64 MP3 for the browser to play. Called directly. */
export async function speakAction(
  text: string,
  voice: VoiceGender,
): Promise<{ audio?: string; error?: string }> {
  const clean = fitForTts(text?.trim() ?? "");
  if (!clean) return { error: "Nothing to play." };
  const token = await getSessionToken();
  if (!token) return { error: "Please sign in again." };
  const result = await coachSpeak(token, clean, voice);
  if (result.unavailable) return { error: "Voice isn't available yet." };
  if (result.error) return { error: result.error };
  return { audio: result.audioBase64 };
}

/** STT: transcribe a recorded voice clip (ElevenLabs Scribe) into the question
 *  box. Takes the audio Blob via FormData. Called directly (not a form action). */
export async function transcribeAction(
  formData: FormData,
): Promise<{ text?: string; error?: string }> {
  const clip = formData.get("audio");
  if (!(clip instanceof Blob) || clip.size === 0) {
    return { error: "No audio captured." };
  }
  const token = await getSessionToken();
  if (!token) return { error: "Please sign in again." };
  const buf = await clip.arrayBuffer();
  const result = await coachTranscribe(token, buf, clip.type || "audio/webm");
  if (result.unavailable) return { error: "Voice input isn't available yet." };
  if (result.error) return { error: result.error };
  return { text: result.text };
}
