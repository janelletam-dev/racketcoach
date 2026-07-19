"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  askCoachAction,
  speakAction,
  transcribeAction,
  type AskState,
} from "./ask-actions";
import type { VoiceGender } from "@/lib/api";
import { Card, SectionLabel } from "@/app/components/ui";

const INITIAL: AskState = {};
const REC_CAP_S = 15; // hard cap on a voice clip — a demo must never wonder "still recording?"
const REC_RED = "#ef4444";

// Character-select style: display the voice NAME, send the semantic gender.
// Labels and wire values are decoupled on purpose — IDs live server-side only.
const VOICES: { value: VoiceGender; label: string }[] = [
  { value: "male", label: "MILES" },
  { value: "female", label: "ANYA" },
];

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export function AskCoach({ voiceAvailable }: { voiceAvailable: boolean }) {
  const [state, formAction, pending] = useActionState(askCoachAction, INITIAL);
  const [question, setQuestion] = useState("");
  const [gender, setGender] = useState<VoiceGender>("male"); // Miles = first toggle

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recLeft, setRecLeft] = useState(REC_CAP_S);
  const [micSupported, setMicSupported] = useState(false);

  const [generating, setGenerating] = useState(false); // fetching TTS audio
  const [playing, setPlaying] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const answer = state.answer;

  function clearTimers() {
    if (capRef.current) {
      clearTimeout(capRef.current);
      capRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function transcribe(blob: Blob) {
    setTranscribing(true);
    setVoiceError(null);
    try {
      const fd = new FormData();
      fd.append("audio", blob, "clip.webm");
      const res = await transcribeAction(fd);
      if (res.text) setQuestion(res.text);
      else if (res.error) setVoiceError(res.error);
    } catch {
      setVoiceError("Voice input failed. Type your question instead.");
    } finally {
      setTranscribing(false);
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    setVoiceError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceError("Mic permission is needed for voice input.");
      return;
    }
    const mime = pickMime();
    const mr = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimers();
      setRecording(false);
      const blob = new Blob(chunksRef.current, {
        type: mr.mimeType || "audio/webm",
      });
      if (blob.size > 0) void transcribe(blob);
    };
    mediaRecorderRef.current = mr;
    mr.start();
    setQuestion("");
    setRecording(true);
    setRecLeft(REC_CAP_S);
    tickRef.current = setInterval(
      () => setRecLeft((s) => Math.max(0, s - 1)),
      1000,
    );
    capRef.current = setTimeout(() => {
      if (mr.state !== "inactive") mr.stop(); // hard cap
    }, REC_CAP_S * 1000);
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    else {
      clearTimers();
      setRecording(false);
    }
  }

  function toggleMic() {
    if (recording) stopRecording();
    else void startRecording();
  }

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlaying(false);
  }

  // TTS: fetch the answer as ElevenLabs audio, then play it. Opt-in (never
  // auto-played) — venue audio should be a choice, not a surprise.
  async function playAnswer() {
    if (!answer) return;
    setGenerating(true);
    setVoiceError(null);
    try {
      const res = await speakAction(answer, gender);
      if (res.error || !res.audio) {
        setVoiceError(res.error ?? "Couldn't play that.");
        return;
      }
      stopAudio();
      const audio = new Audio(`data:audio/mpeg;base64,${res.audio}`);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.onerror = () => setPlaying(false);
      setPlaying(true);
      await audio.play().catch(() => setPlaying(false));
    } catch {
      setVoiceError("Couldn't reach the voice service.");
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    // Client-only capability check — must run post-hydration (SSR has no
    // MediaRecorder), so setting state in the effect is the correct pattern here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMicSupported(
      typeof window !== "undefined" &&
        typeof MediaRecorder !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia,
    );
    return () => {
      clearTimers();
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") mr.stop();
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const showMic = voiceAvailable && micSupported;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <SectionLabel>Ask your coach</SectionLabel>
        {voiceAvailable ? (
          <div className="flex items-center gap-2">
            <span className="rc-label !text-[0.7rem] text-rc-muted">Voice</span>
            <div className="flex rounded-lg overflow-hidden border-2 border-rc-line">
              {VOICES.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => setGender(v.value)}
                  className={`px-2.5 py-1 rc-term !text-[0.85rem] transition-colors ${
                    gender === v.value
                      ? "bg-rc-purple text-white"
                      : "text-rc-muted hover:text-rc-ink"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <p className="text-rc-muted mt-2 mb-4">
        Ask about your play. The coach answers only from what your sessions
        actually measured. Type your question{showMic ? ", or tap the mic" : ""}.
      </p>

      {/* Text is always the primary path; voice is a bonus. */}
      <form action={formAction} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            name="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Why do I keep hitting late?"
            disabled={pending || transcribing}
            className={`rc-term text-lg text-rc-ink bg-white border-2 border-rc-line rounded-xl px-4 py-2.5 outline-none focus:border-rc-indigo w-full disabled:opacity-60 ${
              showMic ? "pr-14" : ""
            }`}
          />
          {showMic ? (
            <button
              type="button"
              onClick={toggleMic}
              disabled={transcribing}
              aria-label={recording ? "Stop recording" : "Ask by voice"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 disabled:opacity-60"
            >
              {recording ? (
                <span
                  className="inline-block w-3.5 h-3.5 rounded-full animate-pulse"
                  style={{ background: REC_RED }}
                />
              ) : (
                <span className="text-xl text-rc-muted hover:text-rc-purple">
                  🎤
                </span>
              )}
            </button>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={pending || transcribing || !question.trim()}
          className="rc-btn rc-btn-amber shrink-0 disabled:opacity-60"
        >
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>

      {recording ? (
        <p
          className="rc-term mt-3 flex items-center gap-2"
          style={{ color: REC_RED }}
        >
          <span
            className="inline-block w-2.5 h-2.5 rounded-full animate-pulse"
            style={{ background: REC_RED }}
          />
          Recording&hellip; speak now ({recLeft}s)
        </p>
      ) : transcribing ? (
        <p className="rc-term text-rc-muted mt-3">Transcribing&hellip;</p>
      ) : null}

      {voiceError ? (
        <p className="text-rc-magenta mt-3 text-sm">{voiceError}</p>
      ) : null}

      {pending ? (
        <p className="rc-term text-rc-muted mt-4">Coach is thinking&hellip;</p>
      ) : state.error ? (
        <p className="text-rc-magenta mt-4">{state.error}</p>
      ) : answer ? (
        <div className="rc-tile mt-4 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="rc-label !text-[0.72rem]">Coach</span>
            {voiceAvailable ? (
              <button
                type="button"
                onClick={playing ? stopAudio : playAnswer}
                disabled={generating}
                className="rc-term text-sm text-rc-purple hover:text-rc-magenta disabled:opacity-60"
              >
                {generating ? "Generating…" : playing ? "■ Stop" : "▶ Play"}
              </button>
            ) : null}
          </div>
          <p className="text-rc-ink whitespace-pre-wrap leading-relaxed">
            {answer}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
