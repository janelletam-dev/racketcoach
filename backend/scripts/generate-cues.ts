/**
 * B7 — pre-generate the §4 cue-library clips with the SAME ElevenLabs voice
 * /api/voice speaks with, so the instant tier-1 coach (station SD, mini
 * LittleFS) and the thinking coach are audibly one person (§8 tier 1).
 *
 * One-off, run by a human with ELEVENLABS_API_KEY in backend/.env:
 *   npm run generate:cues        (writes scripts/out/cues/<fault>.mp3)
 *
 * Copy the output to the station SD card's /audio/ and the mini's LittleFS
 * partition. Cue TEXT comes only from coaching/cueLibrary.ts — the single
 * source of advice; do not add clip text here.
 */
import "../src/env";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CUE_LIBRARY } from "../src/coaching/cueLibrary";
import { config } from "../src/config";

const OUT_DIR = "scripts/out/cues";

// Non-fault clips the devices also need, same voice.
const EXTRA_CLIPS: Record<string, string> = {
  doingWell: "Great control — keep that rhythm and shape.",
  thinking: "Let me think about that one.",
};

if (!config.elevenLabsApiKey) {
  console.error("ELEVENLABS_API_KEY missing (backend/.env or Modal secret).");
  process.exit(1);
}
const voiceId = config.elevenLabsVoiceId;
if (!voiceId) {
  console.error("ELEVENLABS_VOICE_ID or ELEVENLABS_VOICE_ID_MALE required.");
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

const clips: [string, string][] = [
  ...CUE_LIBRARY.map((c): [string, string] => [c.fault, c.cue]),
  ...Object.entries(EXTRA_CLIPS),
];

for (const [name, text] of clips) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, model_id: config.elevenLabsTtsModel }),
    },
  );
  if (!res.ok) {
    console.error(`FAIL ${name}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const path = join(OUT_DIR, `${name}.mp3`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  console.log(`wrote ${path}  ("${text}")`);
}
console.log(`\n${clips.length} clips → ${OUT_DIR}. Copy to station SD /audio/ and mini LittleFS.`);
