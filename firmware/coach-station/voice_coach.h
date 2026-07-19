// ── voice_coach.h — Step 3: always-on VAD + WiFi voice POST (patched) ────────
// PDM mic (AX22-0044, Port 3) — ESP32-S3 RULE: PDM RX exists ONLY on I2S0.
// The station's Audio object is pinned to I2S1 (see coach-station.ino:
// `Audio audio(false, 3, I2S_NUM_1)`), so pdmMic's I2S_NUM_AUTO lands on
// I2S0, which is the only port that works. Do NOT revert Audio to I2S0 —
// the mic can never init on I2S1 on this chip.
//
// PSRAM buffer: 16 kHz × 6 s × 2 B = 192 KB via ps_malloc() —
// Tools → PSRAM must be ENABLED in the Arduino IDE or initMic() fails.
//
// Call order:
//   setup()  → audio.setPinout(…), then initMic()
//   loop()   → vadTick(suppressTrigger)   // pass audioPlaying || roundActive
//   loop()   → if (voiceState == VS_SENDING) handleVoiceHandoff()  [sketch]
//   P4 press → recSamples = 0; voiceState = VS_RECORDING;   // push-to-talk
//
// secrets.h must define VOICE_ENDPOINT_URL (backend /api/voice, key in query).
// SD clip needed: /audio/thinking.mp3
//
// Patch log (vs Step 2):
//   [P1] RMS accumulator was 32-bit `long` — overflowed on loud chunks, so
//        shouts/claps could read as silence. Now int64_t.
//   [P2] VAD opened on a single 16 ms chunk — ball impacts false-triggered
//        recordings mid-rally. Now requires VAD_CONSEC sustained chunks.
//   [P3] /tmp/resp.mp3 failed silently when /tmp didn't exist on FAT.
//        Now SD.mkdir("/tmp") before writing.
//   [P4] I2S port comment corrected (see header above) — the old comment
//        described an allocation that cannot work on the S3.

#pragma once
#include <ESP_I2S.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SD.h>
#include <Audio.h>

// ── VAD tuning ────────────────────────────────────────────────────────────────
#define VAD_TRIGGER_RMS   600   // RMS that opens recording
#define VAD_RELEASE_RMS   200   // RMS below this counts as silence
#define VAD_SILENCE_MS    900   // consecutive silence (ms) before commit
#define VAD_MAX_SECS        6   // hard cap on one utterance
#define VAD_CONSEC          3   // [P2] chunks (~50 ms) that must ALL be loud
                                //      before recording opens — speech is
                                //      sustained, a paddle hit is not
#define MIC_RATE         16000  // 16 kHz — stable PDM rate on ESP32-S3

// ── PDM mic pins — Port 3 (AX22-0044) ────────────────────────────────────────
#define MIC_SEL   P3_IO0   // L/R select — drive LOW for mono/left slot
#define MIC_DATA  P3_IO1   // PDM data in
#define MIC_CLK   P3_IO2   // PDM clock out

// ── Module globals (accessible throughout the sketch via this include) ────────
I2SClass   pdmMic;                  // AUTO → I2S0 (Audio holds I2S1)
int16_t*   recBuf     = nullptr;    // PSRAM recording ring
int        recSamples = 0;
bool       micOk      = false;

enum VoiceState { VS_LISTEN, VS_RECORDING, VS_SENDING };
VoiceState voiceState = VS_LISTEN;

static unsigned long _vadSuppEnd   = 0;
static unsigned long _silenceStart = 0;
static int           _loudStreak   = 0;   // [P2]

// ── VAD suppression helpers ───────────────────────────────────────────────────
void vadSuppress(unsigned long ms) { _vadSuppEnd = millis() + ms; }
bool vadSuppressed()               { return millis() < _vadSuppEnd; }

// ── initMic() — call from setup() AFTER audio.setPinout() ────────────────────
bool initMic() {
  pinMode(MIC_SEL, OUTPUT);
  digitalWrite(MIC_SEL, LOW);                       // mono / left slot
  pdmMic.setPinsPdmRx(MIC_CLK, MIC_DATA);           // CLK first, DATA second
  if (!pdmMic.begin(I2S_MODE_PDM_RX, MIC_RATE,
                    I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO)) {
    Serial.println("Voice: PDM mic init failed (is Audio on I2S1? PDM needs I2S0)");
    return false;
  }
  recBuf = (int16_t*)ps_malloc((size_t)MIC_RATE * VAD_MAX_SECS * sizeof(int16_t));
  if (!recBuf) { Serial.println("Voice: PSRAM alloc failed (enable PSRAM in Tools)"); return false; }
  micOk = true;
  vadSuppress(2000);   // [P6] PDM startup transient: first chunks are garbage
                       // while the mic's filter settles — ignore them or some
                       // boots false-trigger a full voice cycle instantly
  Serial.println("Voice: PDM mic ready — VAD active");
  return true;
}

// ── vadTick() — call every loop() iteration ───────────────────────────────────
// suppressTrigger: pass (audioPlaying || roundActive) — blocks NEW triggers
// (speaker bleed + mid-rally ball impacts) but never interrupts a recording
// already in progress, so P4 push-to-talk works mid-round.
void vadTick(bool suppressTrigger) {
  if (!micOk) return;

  static int16_t mb[256];
  size_t n = pdmMic.readBytes((char*)mb, sizeof(mb));
  if (n == 0) return;
  int cnt = (int)(n / 2);

  // RMS of this chunk — [P1] 64-bit accumulator (256 × 32767² overflows long)
  // [P5] DC-offset corrected: PDM mics sit on a bias, so raw RMS reads
  // permanently high (observed rms≈1100 in a quiet room → instant false
  // trigger, never releases). Measure deviation from the chunk mean instead.
  int64_t sum = 0;
  for (int i = 0; i < cnt; i++) sum += mb[i];
  int32_t mean = (int32_t)(sum / cnt);
  int64_t sq = 0;
  for (int i = 0; i < cnt; i++) {
    int32_t d = (int32_t)mb[i] - mean;
    sq += (int64_t)d * d;
  }
  int rms = (int)sqrt((double)sq / cnt);

  bool suppress = suppressTrigger || vadSuppressed();

  if (voiceState == VS_LISTEN) {
    // [P2] sustained-loudness gate: a paddle hit is loud for one chunk;
    // speech stays loud across several. Only sustained sound opens recording.
    if (!suppress && rms > VAD_TRIGGER_RMS) {
      if (++_loudStreak >= VAD_CONSEC) {
        voiceState    = VS_RECORDING;
        recSamples    = 0;
        _silenceStart = 0;
        _loudStreak   = 0;
        Serial.printf("VAD: speech detected (rms=%d)\n", rms);
      }
    } else {
      _loudStreak = 0;
    }

  } else if (voiceState == VS_RECORDING) {
    // Append chunk to PSRAM buffer
    int maxSamp = MIC_RATE * VAD_MAX_SECS;
    int space   = maxSamp - recSamples;
    if (space > 0) {
      int cp = min(cnt, space);
      memcpy(recBuf + recSamples, mb, (size_t)cp * 2);
      recSamples += cp;
    }
    // End-of-speech detection
    if (rms < VAD_RELEASE_RMS) {
      if (!_silenceStart) _silenceStart = millis();
      else if (millis() - _silenceStart >= (unsigned long)VAD_SILENCE_MS) {
        Serial.printf("VAD: committed %.1f s\n", (float)recSamples / MIC_RATE);
        voiceState = VS_SENDING;
      }
    } else {
      _silenceStart = 0;   // speech resumed — reset silence timer
    }
    if (recSamples >= maxSamp) {
      Serial.println("VAD: buffer full — committing");
      voiceState = VS_SENDING;
    }
  }
  // VS_SENDING is handled by handleVoiceHandoff() in the sketch
}

// ── WAV header (44 bytes, little-endian PCM) ──────────────────────────────────
static void _writeWavHdr(uint8_t* h, int samples, int rate) {
  uint32_t dataB = (uint32_t)samples * 2;
  uint32_t riffS = 36 + dataB;
  uint32_t byteR = (uint32_t)rate * 2;
  uint32_t r32   = (uint32_t)rate;
  uint32_t sub   = 16;
  uint16_t u1=1, u2=2, u16=16;
  memcpy(h,    "RIFF",4); memcpy(h+ 4, &riffS, 4);
  memcpy(h+ 8, "WAVE",4); memcpy(h+12, "fmt ", 4);
                           memcpy(h+16, &sub,   4);
                           memcpy(h+20, &u1,    2);  // PCM
                           memcpy(h+22, &u1,    2);  // mono
                           memcpy(h+24, &r32,   4);
                           memcpy(h+28, &byteR, 4);
                           memcpy(h+32, &u2,    2);  // block align
                           memcpy(h+34, &u16,   2);  // bits/sample
  memcpy(h+36, "data",4); memcpy(h+40, &dataB, 4);
}

// ── TTS smoke test (optional, temporary) ─────────────────────────────────────
// Proves the one unverified hardware link — MP3 download → SD → amp — by
// calling ElevenLabs directly with a fixed line at boot. Enable by defining
// ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID and TTS_SMOKE_TEST in secrets.h.
// Remove the key from the device once B7 (/api/voice) is live — the backend
// owns all third-party keys in the real design.
#if defined(ELEVENLABS_API_KEY) && defined(TTS_SMOKE_TEST)
bool ttsSmokeTest(Audio& audio, bool sdOk) {
  if (WiFi.status() != WL_CONNECTED) { Serial.println("TTS test: no WiFi"); return false; }
  if (!sdOk)                         { Serial.println("TTS test: no SD");   return false; }
  WiFiClientSecure tls; tls.setInsecure();
  HTTPClient http;
  String url = "https://api.elevenlabs.io/v1/text-to-speech/"
               ELEVENLABS_VOICE_ID "?output_format=mp3_44100_64";
  if (!http.begin(tls, url)) return false;
  http.addHeader("xi-api-key", ELEVENLABS_API_KEY);
  http.addHeader("Content-Type", "application/json");
  const char* body =
    "{\"text\":\"Coach online. Nice paddle. Let's warm up those forehands.\","
    "\"model_id\":\"eleven_turbo_v2_5\"}";
  Serial.println("TTS test: requesting speech from ElevenLabs…");
  int code = http.POST((uint8_t*)body, strlen(body));
  if (code != 200) {
    Serial.printf("TTS test failed: HTTP %d (check key/voice id)\n", code);
    http.end(); return false;
  }
  SD.mkdir("/tmp");
  SD.remove("/tmp/tts.mp3");
  File f = SD.open("/tmp/tts.mp3", FILE_WRITE);
  if (!f) { http.end(); return false; }
  int len = http.getSize(); WiFiClient* s = http.getStreamPtr();
  uint8_t chunk[512]; int rem = len; unsigned long dl = millis() + 20000;
  while ((len < 0 || rem > 0) && millis() < dl) {
    int av = s->available();
    if (av > 0) { int rn = s->readBytes(chunk, min(av, 512)); f.write(chunk, rn); if (len > 0) rem -= rn; }
    else { if (!s->connected()) break; delay(1); }
  }
  f.close(); http.end();
  Serial.println("TTS test: playing — you should hear the coach");
  audio.connecttoFS(SD, "/tmp/tts.mp3");
  audioPlaying = true;
  vadSuppress(8000);
  return true;
}
#endif

// ── voicePost() ───────────────────────────────────────────────────────────────
// POST the recorded WAV (player context as query params) to the backend
// /api/voice. Streams the MP3 response body to SD → /tmp/resp.mp3, then
// queues it for playback. Returns true if response audio was queued.
// Call only with WiFi connected, SD mounted, and recSamples > 0.
bool voicePost(Audio& audio, bool sdOk,
               int playerId, int goodReps, int streak,
               int bestStreak, float avgSpeed) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (!sdOk || !recBuf || recSamples < MIC_RATE / 4) return false;

  // Build URL — player context as query params
  char url[320];
  snprintf(url, sizeof(url),
    "%s?player=%d&goodReps=%d&streak=%d&bestStreak=%d&avgSpeed=%.1f",
    VOICE_ENDPOINT_URL, playerId, goodReps, streak, bestStreak, avgSpeed);

  // Prepend WAV header to PCM in one PSRAM blob
  uint32_t wavSz = 44 + (uint32_t)recSamples * 2;
  uint8_t* blob  = (uint8_t*)ps_malloc(wavSz);
  if (!blob) { Serial.println("Voice: WAV blob alloc failed"); return false; }
  _writeWavHdr(blob, recSamples, MIC_RATE);
  memcpy(blob + 44, recBuf, (size_t)recSamples * 2);

  WiFiClientSecure tls;
  tls.setInsecure();            // backend key is in the URL; TLS for transport only
  HTTPClient http;
  http.begin(tls, url);
  http.addHeader("Content-Type", "audio/wav");
  Serial.printf("Voice: POST %u B to backend\n", wavSz);
  int code = http.POST(blob, (size_t)wavSz);
  free(blob);

  if (code != 200) {
    Serial.printf("Voice: POST failed HTTP %d\n", code);
    http.end();
    return false;
  }

  // Stream response body → SD (/tmp/resp.mp3). [P3] ensure /tmp exists on FAT.
  SD.mkdir("/tmp");
  int         len  = http.getSize();
  WiFiClient* s    = http.getStreamPtr();
  SD.remove("/tmp/resp.mp3");
  File f = SD.open("/tmp/resp.mp3", FILE_WRITE);
  if (!f) { Serial.println("Voice: SD open failed for /tmp/resp.mp3"); http.end(); return false; }
  uint8_t chunk[512];
  int rem = len;
  unsigned long dl = millis() + 20000;
  while ((len < 0 || rem > 0) && millis() < dl) {
    int av = s->available();
    if (av > 0) {
      int rn = s->readBytes(chunk, min(av, 512));
      f.write(chunk, rn);
      if (len > 0) rem -= rn;
    } else {
      if (!s->connected()) break;
      delay(1);
    }
  }
  f.close();
  http.end();

  Serial.println("Voice: playing response from SD");
  audio.connecttoFS(SD, "/tmp/resp.mp3");
  return true;
}
