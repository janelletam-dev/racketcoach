/**
 * Backend config — external-service keys and knobs for the analysis pipeline.
 * Getters are lazy so this module can be imported in any order relative to
 * src/env.ts (which loads .env into process.env in local dev).
 *
 * NOTE (A4): this is deliberately minimal. The full A4 refactor turns this into
 * the one zod-validated env module that everything imports; until then only the
 * analyzer/voice keys live here. AUTH_SECRET keeps its fail-fast in auth.ts.
 */
export const config = {
  /** Anthropic — session analysis (B3) and voice conversation (B7). */
  get anthropicApiKey(): string | undefined {
    return process.env.ANTHROPIC_API_KEY;
  },
  get anthropicModel(): string {
    return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
  },
  /** Linkup — sourced drill search (B3). */
  get linkupApiKey(): string | undefined {
    return process.env.LINKUP_API_KEY;
  },
  /** ElevenLabs — STT + TTS for /api/voice (B7) and cue-clip generation. */
  get elevenLabsApiKey(): string | undefined {
    return process.env.ELEVENLABS_API_KEY;
  },
  get elevenLabsVoiceId(): string {
    // One voice everywhere: instant SD/LittleFS cues and the thinking coach
    // must be audibly the same person (§8 tier 1).
    return process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
  },
  /** Male/female voice IDs for the web "Ask your coach" TTS (/api/coach/speak). */
  get elevenLabsVoiceIdMale(): string | undefined {
    return process.env.ELEVENLABS_VOICE_ID_MALE;
  },
  get elevenLabsVoiceIdFemale(): string | undefined {
    return process.env.ELEVENLABS_VOICE_ID_FEMALE;
  },
  get elevenLabsTtsModel(): string {
    return process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5";
  },
  /** Shared token the devices carry in the /api/voice query (B7). */
  get voiceDeviceToken(): string | undefined {
    return process.env.VOICE_DEVICE_TOKEN;
  },
  /** Timeout applied to each external call (Claude, Linkup). One retry each. */
  get externalTimeoutMs(): number {
    const n = Number(process.env.EXTERNAL_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? n : 20_000;
  },
};
