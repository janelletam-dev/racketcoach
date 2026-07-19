"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { askAction, speakAction, transcribeAction } from "./ask-actions";
import type { ChatTurn, VoiceGender } from "@/lib/api";
import { Card, SectionLabel } from "@/app/components/ui";

const REC_CAP_S = 15; // hard cap on a voice clip — a demo must never wonder "still recording?"
const REC_RED = "#ef4444";
const MAX_HISTORY = 8; // last N turns sent to the backend
const MSG_CAP = 1000; // per-message char cap for history
const GREETING =
  "Paddle up. Ask me anything about your play — I'll answer from what your sessions actually measured.";

// Character-select style: display the voice NAME, send the semantic gender.
const VOICES: { value: VoiceGender; label: string }[] = [
  { value: "male", label: "MILES" },
  { value: "female", label: "ANYA" },
];

type Msg = {
  id: string;
  role: "user" | "coach";
  content: string;
  pending?: boolean; // coach bubble awaiting an answer
  failed?: boolean; // transcript didn't come through / answer errored
};

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export function AskCoach({ voiceAvailable }: { voiceAvailable: boolean }) {
  // In-memory only (B11.2) — a refresh resets to the greeting, which is fine.
  const [messages, setMessages] = useState<Msg[]>([
    { id: "greeting", role: "coach", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [gender, setGender] = useState<VoiceGender>("male");

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recLeft, setRecLeft] = useState(REC_CAP_S);
  const [micSupported, setMicSupported] = useState(false);

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesRef = useRef(messages);
  const seqRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const nextId = () => `m${++seqRef.current}`;

  useEffect(() => {
    messagesRef.current = messages;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // The turns BEFORE the new question, mapped into Claude's messages array.
  function historyFor(): ChatTurn[] {
    return messagesRef.current
      .filter((m) => !m.pending && !m.failed && m.content.trim())
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content.slice(0, MSG_CAP),
      }))
      .slice(-MAX_HISTORY);
  }

  async function sendQuestion(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    const history = historyFor(); // capture before appending the new turn
    const userId = nextId();
    const coachId = nextId();
    setMessages((m) => [
      ...m,
      { id: userId, role: "user", content: q },
      { id: coachId, role: "coach", content: "", pending: true },
    ]);
    setInput("");
    setSending(true);
    const res = await askAction(q, history);
    setMessages((m) =>
      m.map((msg) =>
        msg.id === coachId
          ? res.answer
            ? { ...msg, content: res.answer, pending: false }
            : {
                ...msg,
                content: res.error ?? "The coach couldn't answer that one.",
                pending: false,
                failed: true,
              }
          : msg,
      ),
    );
    setSending(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void sendQuestion(input);
  }

  // --- mic: record -> transcribe -> show transcript bubble -> ask ---
  // Never silently swallow a mic attempt — surface a gentle nudge instead.
  function addMicMiss() {
    const id = nextId();
    setMessages((m) => [
      ...m,
      {
        id,
        role: "user",
        content: "That didn't come through — try again?",
        failed: true,
      },
    ]);
  }

  async function transcribeAndSend(blob: Blob) {
    setTranscribing(true);
    try {
      const fd = new FormData();
      fd.append("audio", blob, "clip.webm");
      const res = await transcribeAction(fd);
      const text = res.text?.trim();
      if (!text) {
        addMicMiss();
        return;
      }
      await sendQuestion(text);
    } catch {
      addMicMiss();
    } finally {
      setTranscribing(false);
    }
  }

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

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return; // mic permission denied
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
      if (blob.size > 0) void transcribeAndSend(blob);
    };
    mediaRecorderRef.current = mr;
    mr.start();
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

  // --- tts: one voice at a time, per coach bubble ---
  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  }

  async function playBubble(msg: Msg) {
    if (playingId === msg.id) {
      stopAudio();
      return;
    }
    stopAudio(); // stop any other bubble first
    setGeneratingId(msg.id);
    try {
      const res = await speakAction(msg.content, gender);
      if (res.error || !res.audio) return;
      const audio = new Audio(`data:audio/mpeg;base64,${res.audio}`);
      audioRef.current = audio;
      setPlayingId(msg.id);
      audio.onended = () => setPlayingId(null);
      audio.onerror = () => setPlayingId(null);
      await audio.play().catch(() => setPlayingId(null));
    } finally {
      setGeneratingId(null);
    }
  }

  useEffect(() => {
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
      <div className="flex items-start justify-between gap-3 mb-4">
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

      {/* Thread */}
      <div className="flex flex-col gap-3 max-h-[420px] overflow-y-auto pr-1">
        {messages.map((msg) =>
          msg.role === "user" ? (
            <div key={msg.id} className="flex justify-end">
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 rc-term text-lg ${
                  msg.failed
                    ? "bg-rc-row text-rc-muted italic"
                    : "bg-rc-purple text-white"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex justify-start gap-2">
              <span className="text-xl shrink-0 mt-1" aria-hidden>
                🏓
              </span>
              <div className="max-w-[85%]">
                <div className="rc-tile px-4 py-2.5">
                  {msg.pending ? (
                    <p className="rc-term text-rc-muted">
                      Coach is thinking&hellip;
                    </p>
                  ) : (
                    <p
                      className={`whitespace-pre-wrap leading-relaxed ${
                        msg.failed ? "text-rc-magenta" : "text-rc-ink"
                      }`}
                    >
                      {msg.content}
                    </p>
                  )}
                </div>
                {voiceAvailable && !msg.pending && !msg.failed && msg.content ? (
                  <button
                    type="button"
                    onClick={() => playBubble(msg)}
                    disabled={generatingId === msg.id}
                    className="rc-term text-xs text-rc-purple hover:text-rc-magenta disabled:opacity-60 mt-1 ml-1"
                  >
                    {generatingId === msg.id
                      ? "Generating…"
                      : playingId === msg.id
                        ? "■ Stop"
                        : "▶ Play"}
                  </button>
                ) : null}
              </div>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

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

      {/* Input row — pinned below the thread */}
      <form onSubmit={onSubmit} className="mt-4 flex gap-2 items-stretch">
        <div className="relative flex-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Why do I keep hitting late?"
            className={`rc-term text-lg text-rc-ink bg-white border-2 border-rc-line rounded-xl px-4 py-2.5 outline-none focus:border-rc-indigo w-full ${
              showMic ? "pr-14" : ""
            }`}
          />
          {showMic ? (
            <button
              type="button"
              onClick={toggleMic}
              disabled={!recording && (sending || transcribing)}
              aria-label={recording ? "Stop recording" : "Ask by voice"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 disabled:opacity-40"
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
          disabled={sending || !input.trim()}
          className="rc-btn rc-btn-amber shrink-0 disabled:opacity-60"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
    </Card>
  );
}
