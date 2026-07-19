/**
 * B7 voice-endpoint smoke suite (stubbed externals). Run from backend/:
 *   npx tsx scripts/_smoke-voice.mts
 * Builds the exact WAV blob voice_coach.h builds (44-byte header + 16kHz mono
 * PCM), exercises the route in-process with stubbed ElevenLabs/Anthropic, and
 * checks BOTH query forms — clean (?key=&player=) and the firmware's mangled
 * double-? form (?key=TOKEN?player=...).
 */
process.env.DATABASE_URL = "file:./racketcoach.db";
process.env.VOICE_DEVICE_TOKEN = "test-device-token";
process.env.ELEVENLABS_API_KEY = "test-el-key";
process.env.ANTHROPIC_API_KEY = "test-an-key";

const { voiceRoute, parseDeviceQuery } = await import("../src/routes/voice");
const { Hono } = await import("hono");

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}`, extra ?? "");
  }
}

// ---- parseDeviceQuery unit ----------------------------------------------
console.log("parseDeviceQuery");
{
  const clean = parseDeviceQuery(
    new URL("https://x/api/voice?key=T&player=3&goodReps=12&streak=4&bestStreak=9&avgSpeed=11.5"),
  );
  check("clean form", clean.key === "T" && clean.player === 3 && clean.avgSpeed === 11.5);
  const mangled = parseDeviceQuery(
    new URL("https://x/api/voice?key=T?player=3&goodReps=12&streak=4&bestStreak=9&avgSpeed=11.5"),
  );
  check(
    "mangled firmware form",
    mangled.key === "T" && mangled.player === 3 && mangled.goodReps === 12 && mangled.avgSpeed === 11.5,
    mangled,
  );
}

// ---- WAV blob exactly as _writeWavHdr builds it -------------------------
const RATE = 16000;
const SECS = 2;
const samples = RATE * SECS;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + samples * 2, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(RATE, 24);
wav.writeUInt32LE(RATE * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  wav.writeInt16LE(Math.round(3000 * Math.sin((i / RATE) * 2 * Math.PI * 220)), 44 + i * 2);
}

// ---- stub externals ------------------------------------------------------
const realFetch = globalThis.fetch;
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5]); // "ID3" + junk
let sttForm: FormData | null = null;
let claudeBody: any = null;
let ttsBody: any = null;
globalThis.fetch = (async (url: any, init: any) => {
  const u = String(url);
  if (u.includes("speech-to-text")) {
    sttForm = init.body;
    return new Response(JSON.stringify({ text: "How do I hold the paddle for backspin?" }), { status: 200 });
  }
  if (u.includes("api.anthropic.com")) {
    claudeBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: "Try a relaxed shakehand grip and brush under the ball. You have got the streak for it!" }] }),
      { status: 200 },
    );
  }
  if (u.includes("text-to-speech")) {
    ttsBody = JSON.parse(init.body);
    return new Response(MP3.buffer.slice(0), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  }
  return realFetch(url, init);
}) as any;

const app = new Hono().route("/api/voice", voiceRoute);
const post = (qs: string, body?: BodyInit, headers?: Record<string, string>) =>
  app.request(`http://station.local/api/voice${qs}`, { method: "POST", body, headers });

// ---- happy path, mangled query (the real firmware wire form) ------------
console.log("voice route: mangled-query happy path");
{
  const res = await post(
    "?key=test-device-token?player=1&goodReps=12&streak=4&bestStreak=9&avgSpeed=11.5",
    new Uint8Array(wav),
    { "Content-Type": "audio/wav" },
  );
  const bytes = new Uint8Array(await res.arrayBuffer());
  check("200", res.status === 200, res.status);
  check("audio/mpeg", res.headers.get("content-type") === "audio/mpeg");
  check("MP3 bytes returned raw", bytes.length === MP3.length && bytes[0] === 0x49);
  check("content-length set", res.headers.get("content-length") === String(MP3.length));
  check("STT got a file", sttForm != null && (sttForm as any).get("file") instanceof Blob);
  check(
    "snapshot reached prompt",
    String(claudeBody.system).includes("good reps 12") && String(claudeBody.system).includes("best streak 9"),
  );
  check("question forwarded", claudeBody.messages[0].content.includes("backspin"));
  check("spoken-reply system rules", String(claudeBody.system).includes("spoken aloud"));
  check("TTS got coach reply", String(ttsBody.text).includes("shakehand"));
}

// ---- auth + degradation matrix ------------------------------------------
console.log("voice route: auth + degradation");
{
  const bad = await post("?key=wrong-token&player=1", new Uint8Array(wav), { "Content-Type": "audio/wav" });
  check("wrong token 401", bad.status === 401, bad.status);

  const empty = await post("?key=test-device-token&player=1", new Uint8Array(0));
  check("empty body 400", empty.status === 400, empty.status);

  delete process.env.ELEVENLABS_API_KEY;
  const noKeys = await post("?key=test-device-token&player=1", new Uint8Array(wav), { "Content-Type": "audio/wav" });
  check("missing EL key 503", noKeys.status === 503, noKeys.status);
  process.env.ELEVENLABS_API_KEY = "test-el-key";

  delete process.env.VOICE_DEVICE_TOKEN;
  const unconfigured = await post("?key=test-device-token&player=1", new Uint8Array(wav), { "Content-Type": "audio/wav" });
  check("no device token configured 503", unconfigured.status === 503, unconfigured.status);
  process.env.VOICE_DEVICE_TOKEN = "test-device-token";
}

// ---- STT failure → 502 (device logs and carries on) ----------------------
console.log("voice route: upstream failure");
{
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("speech-to-text")) return new Response("boom", { status: 500 });
    return new Response("{}", { status: 200 });
  }) as any;
  const res = await post("?key=test-device-token&player=1", new Uint8Array(wav), { "Content-Type": "audio/wav" });
  check("502 on upstream failure", res.status === 502, res.status);
}

globalThis.fetch = realFetch;
console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
