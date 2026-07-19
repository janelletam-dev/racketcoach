// Coach Station — Step 2 (patched)
// WiFi/UDP receive · TFT leaderboard · Game logic · NeoPixel face · SD audio cues
//
// Radio topology (AP_STA):
//   - The station broadcasts its OWN network ("racketcoach") for the paddle.
//     Paddle sends UDP JSON to 192.168.4.1:4210 — fixed IP, immune to venue
//     WiFi captive portals / client isolation.
//   - The STA side joins the venue network / phone hotspot for cloud voice
//     calls only. The game runs fine if that side never connects.
//
// I2S allocation (ESP32-S3 constraint: PDM RX exists ONLY on I2S0):
//   - I2S0 → PDM mic          (initMic() in voice_coach.h must claim port 0)
//   - I2S1 → MAX98357A amp    (Audio object constructed on port 1 below)
//
// Port map:
//   P1 — AX22-0034  ST7735 TFT display  (CS=P1_IO0, RST=P1_IO1, DC=P1_IO2)
//   P2 — AX22-0053  MAX98357A audio amp  (BCLK=P2_IO1, LRC=P2_IO2, DIN=P2_IO0)
//   P3 — AX22-0044  PDM mic              (always-on VAD — speaks when it hears you)
//   P4 — AX22-0007  Manual trigger button (IO1 — force voice query if VAD misses)
//   P5 — AX22-0007  Round-reset button   (IO1)
//   P6 — AX22-0028  NeoPixel 5×5 matrix  (IO1)
//   P7 — AX22-0029  SD card              (CS=P7_IO1, shares SPI bus)
//
// Audio clips on SD: /audio/paddle_dropped.mp3  slow_return.mp3  inconsistent.mp3
//                    new_best.mp3  ready_go.mp3  player1_wins.mp3  player2_wins.mp3

#include <WiFi.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <Adafruit_NeoPixel.h>
#include <SD.h>
#include <Audio.h>
#include <RotaryEncoder.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include "secrets.h"
#include "voice_coach.h"

// Session upload config (secrets.h). Without BACKEND_URL the station skips
// uploads entirely — the local game is unaffected.
//   #define BACKEND_URL "https://janelletam-dev--racketcoach-backend.modal.run"
//   #define STATION_PAIRING_CODE "ACE123"        // player 1's claimed code
//   #define STATION_PAIRING_CODE_P2 "XYZ789"     // optional, player 2
#ifndef STATION_PAIRING_CODE
#define STATION_PAIRING_CODE "ACE123"
#endif

// Internet-side credentials (venue / hotspot / home) live ONLY in secrets.h
// (gitignored). No fallback on purpose: a missing secrets.h must fail the
// compile, never silently embed credentials in a committable file.
#ifndef WIFI_SSID
#error "Create secrets.h (copy secrets.h.example) with WIFI_SSID / WIFI_PASS"
#endif

// Paddle-side network — the station's own AP. The paddle firmware must join
// this SSID and send UDP to 192.168.4.1:4210.
const char* AP_SSID = "racketcoach";
const char* AP_PASS = "paddle123";

// ── Pin definitions ───────────────────────────────────────────────────────────
#define TFT_CS   P1_IO0
#define TFT_RST  P1_IO1
#define TFT_DC   P1_IO2

#define AUD_BCLK P2_IO1
#define AUD_LRC  P2_IO2
#define AUD_DIN  P2_IO0

#define BTN_PTT   P4_IO1
#define BTN_RESET P5_IO1

#define NEO_PIN  P6_IO1
#define SD_CS    P7_IO1

// ── Rotary encoder (P8 — AX22-0003) ─────────────────────────────────────────
// P8_IO1/IO2 are UART0 pins — must explicitly pinMode before use
#define ENC_BTN  P8_IO0
#define ENC_CLK  P8_IO1
#define ENC_DT   P8_IO2

// ── BGR-swapped colors for this display panel ─────────────────────────────────
// This ST7735 has BGR pixel order. Pass color565(B, G, R) instead of (R, G, B).
// Never use ST77XX_* constants — they display as wrong hues on this panel.
const uint16_t COL_BLACK   = 0x0000;
const uint16_t COL_WHITE   = 0xFFFF;
const uint16_t COL_YELLOW  = 0x07FF; // RGB(255,255,  0) → BGR pass → 0x07FF
const uint16_t COL_GREEN   = 0x07E0; // RGB(  0,255,  0) → same
const uint16_t COL_RED     = 0x001F; // RGB(255,  0,  0) → BGR pass → 0x001F
const uint16_t COL_CYAN    = 0xFFE0; // RGB(  0,255,255) → BGR pass → 0xFFE0
const uint16_t COL_ORANGE  = 0x053F; // RGB(255,165,  0) → BGR pass → 0x053F
const uint16_t COL_DIMGRAY = 0x4208;

// ── Hardware objects ──────────────────────────────────────────────────────────
RotaryEncoder encoder(ENC_CLK, ENC_DT, RotaryEncoder::LatchMode::TWO03);
SPIClass mySPI(FSPI);
Adafruit_ST7735 tft = Adafruit_ST7735(&mySPI, TFT_CS, TFT_DC, TFT_RST);
GFXcanvas16     canvas(160, 80);
Adafruit_NeoPixel matrix(25, NEO_PIN, NEO_GRB + NEO_KHZ800);

// Amp on I2S1 so the PDM mic can have I2S0 (S3: PDM RX is I2S0-only).
// If this constructor signature doesn't match your ESP32-audioI2S version,
// check Audio.h for the i2sPort parameter position.
Audio audio(false, 3, I2S_NUM_1);

// ── Game types ────────────────────────────────────────────────────────────────
// Fault tally indices — names match the paddle's wire faultType strings.
static const char* FAULT_NAMES[4] =
  {"paddleDropped", "slowReturn", "inconsistent", "overHitting"};

struct Player {
  int      id;
  int      goodReps;
  int      streak;
  int      bestStreak;   // survives across rounds
  int      totalReps;
  float    speedSum;
  char     lastFault[24];
  uint16_t faultCounts[4];   // tallied per round → commonFault in the upload
};

// ── Game state ────────────────────────────────────────────────────────────────
Player p[2];
int           roundNum    = 0;
bool          roundActive = false;
unsigned long roundStart  = 0;

const unsigned long ROUND_MS   = 60000UL;
const int           WIN_STREAK = 5;

// ── Timing ────────────────────────────────────────────────────────────────────
unsigned long lastDraw = 0;
const unsigned long DRAW_MS = 50;   // ~20 fps — safe alongside SPI audio reads

// ── NeoPixel flash ────────────────────────────────────────────────────────────
unsigned long neoFlashEnd  = 0;
uint32_t      neoIdleColor = 0;

// ── Button debounce ───────────────────────────────────────────────────────────
bool prevPTT   = HIGH;
bool prevReset = HIGH;

// ── UDP listener ────────────────────────────────────────────────────────────────
WiFiUDP   udp;
char      msgBuf[251];
const int UDP_PORT = 4210;

// ── Volume (0-21, Audio library range) ───────────────────────────────────────
int  volLevel     = 16;          // start at same default as before
long lastEncPos   = 0;
bool lastEncBtn   = LOW;
unsigned long lastEncBtnTime = 0;
bool volDirty     = false;       // flag: redraw volume overlay on next frame
unsigned long volShowEnd = 0;    // hide overlay 2 s after last turn

// ── SD / audio availability ───────────────────────────────────────────────────
bool sdOk            = false;
bool audioPlaying    = false;   // true while any clip is playing (suppresses VAD)
int  lastActivePlayer = 1;      // updated on each paddle UDP message

// ── Audio clip paths (FAT32 SD, /audio/) ─────────────────────────────────────
const char* CUE_PADDLE = "/audio/paddle_dropped.mp3";
const char* CUE_SLOW   = "/audio/slow_return.mp3";
const char* CUE_INCON  = "/audio/inconsistent.mp3";
const char* CUE_BEST   = "/audio/new_best.mp3";
const char* CUE_READY  = "/audio/ready_go.mp3";
const char* CUE_P1WIN  = "/audio/player1_wins.mp3";
const char* CUE_P2WIN  = "/audio/player2_wins.mp3";
const char* CUE_THINK  = "/audio/thinking.mp3";   // plays while WiFi connects

// ── Forward declarations ──────────────────────────────────────────────────────
void drawLeaderboard();
void drawWinner(int winnerId);
void drawIdle();
void drawVolOverlay();
void handleVoiceHandoff();
void endRound(int winnerId);

// ── Audio ─────────────────────────────────────────────────────────────────────
void playClip(const char* path) {
  if (!sdOk) { Serial.printf("SD unavailable: %s\n", path); return; }
  audio.connecttoFS(SD, path);
  audioPlaying = true;
  vadSuppress(5000);   // keep VAD off during + 5 s after every clip
}

// ── NeoPixel helpers ──────────────────────────────────────────────────────────
void setAllNeo(uint32_t c) {
  for (int i = 0; i < 25; i++) matrix.setPixelColor(i, c);
  matrix.show();
}

void flashNeo(uint32_t color, unsigned long ms = 500) {
  setAllNeo(color);
  neoFlashEnd = millis() + ms;
}

void updateNeo() {
  if (neoFlashEnd > 0 && millis() > neoFlashEnd) {
    neoFlashEnd = 0;
    setAllNeo(neoIdleColor);
  }
}

// ── Game helpers ──────────────────────────────────────────────────────────────
void clearPlayer(Player& pl, int id) {
  pl.id          = id;
  pl.goodReps    = 0;
  pl.streak      = 0;
  pl.totalReps   = 0;
  pl.speedSum    = 0.0f;
  pl.lastFault[0] = 0;
  for (int i = 0; i < 4; i++) pl.faultCounts[i] = 0;
  // bestStreak intentionally NOT cleared here
}

// ── Session upload — one POST per player per completed round ─────────────────
// Contract: docs/architecture-proposal.md B1/B2 (existing board API fields +
// durationSeconds; unknown fields are stripped server-side pre-B1, so this is
// safe to ship before the backend migration lands).
#ifdef BACKEND_URL
bool isoTimeNow(char* out, size_t n) {
  time_t t = time(nullptr);
  if (t < 1700000000) return false;   // NTP hasn't synced — no valid clock
  struct tm tmv;
  gmtime_r(&t, &tmv);
  snprintf(out, n, "%04d-%02d-%02dT%02d:%02d:%02d.000Z",
           tmv.tm_year + 1900, tmv.tm_mon + 1, tmv.tm_mday,
           tmv.tm_hour, tmv.tm_min, tmv.tm_sec);
  return true;
}

void sendSessionSummary(Player& pl, const char* code, unsigned long durSec) {
  if (pl.totalReps <= 0) return;   // player never hit — nothing to record
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("[upload] P%d skipped — no internet (game unaffected)\n", pl.id);
    return;
  }
  char iso[36];
  if (!isoTimeNow(iso, sizeof(iso))) {
    Serial.printf("[upload] P%d skipped — clock not NTP-synced yet\n", pl.id);
    return;
  }
  int best = -1; uint16_t bc = 0;
  for (int i = 0; i < 4; i++)
    if (pl.faultCounts[i] > bc) { bc = pl.faultCounts[i]; best = i; }

  char body[360];
  snprintf(body, sizeof(body),
    "{\"pairingCode\":\"%s\",\"date\":\"%s\",\"goodReps\":%d,\"totalReps\":%d,"
    "\"bestStreak\":%d,\"commonFault\":\"%s\",\"avgSpeed\":%.2f,"
    "\"durationSeconds\":%lu}",
    code, iso, pl.goodReps, pl.totalReps, pl.bestStreak,
    best >= 0 ? FAULT_NAMES[best] : "none",
    pl.speedSum / pl.totalReps, durSec);

  String url = String(BACKEND_URL) + "/api/session";
  WiFiClientSecure tlsC;
  WiFiClient plainC;
  HTTPClient http;
  http.setTimeout(8000);
  bool began;
  if (url.startsWith("https")) { tlsC.setInsecure(); began = http.begin(tlsC, url); }
  else                         { began = http.begin(plainC, url); }
  if (!began) { Serial.println("[upload] http.begin failed"); return; }
  http.addHeader("Content-Type", "application/json");
  int status = http.POST((uint8_t*)body, strlen(body));
  Serial.printf("[upload] P%d round summary -> HTTP %d\n", pl.id, status);
  http.end();
}

void postRoundSessions(unsigned long durSec) {
  sendSessionSummary(p[0], STATION_PAIRING_CODE, durSec);
#ifdef STATION_PAIRING_CODE_P2
  sendSessionSummary(p[1], STATION_PAIRING_CODE_P2, durSec);
#else
  if (p[1].totalReps > 0)
    Serial.println("[upload] P2 skipped — no STATION_PAIRING_CODE_P2 configured");
#endif
}
#endif  // BACKEND_URL

void startRound() {
  int b0 = p[0].bestStreak;
  int b1 = p[1].bestStreak;
  clearPlayer(p[0], 1); p[0].bestStreak = b0;
  clearPlayer(p[1], 2); p[1].bestStreak = b1;
  roundNum++;
  roundStart   = millis();
  roundActive  = true;
  lastDraw     = 0;               // force first display frame immediately
  neoIdleColor = matrix.Color(0, 15, 0); // dim green idle during play
  setAllNeo(neoIdleColor);
  drawLeaderboard();
  playClip(CUE_READY);
  Serial.printf("Round %d started\n", roundNum);
}

void endRound(int winnerId) {
  unsigned long durSec = roundActive ? (millis() - roundStart) / 1000 : 0;
  roundActive  = false;
  neoIdleColor = 0;
  uint32_t flashCol = (winnerId == 1) ? matrix.Color(0, 0, 160)   // blue P1
                    : (winnerId == 2) ? matrix.Color(160, 80, 0)   // amber P2
                    :                   matrix.Color(80, 80, 80);   // white tie
  flashNeo(flashCol, 2000);
  // Tie: NeoPixel flash + winner screen only — there is no tie clip on the SD,
  // and playing "ready go" as a result sound confuses players.
  if      (winnerId == 1) playClip(CUE_P1WIN);
  else if (winnerId == 2) playClip(CUE_P2WIN);
  drawWinner(winnerId);
  Serial.printf("Round %d ended. Winner: P%d\n", roundNum, winnerId);

#ifdef BACKEND_URL
  // Upload after the win clip finishes — the TLS POST blocks, and blocking
  // mid-clip would starve the audio buffer. Winner screen is static anyway.
  unsigned long clipWait = millis() + 6000;
  while (audioPlaying && millis() < clipWait) audio.loop();
  postRoundSessions(durSec);
#endif
}

// ── Process one incoming paddle UDP JSON message ──────────────────────────────
void processMsg() {
  StaticJsonDocument<256> doc;
  // Quick sanity check before parsing — ignore non-JSON frames
  if (msgBuf[0] != '{') return;
  if (deserializeJson(doc, msgBuf) != DeserializationError::Ok) {
    Serial.printf("JSON parse error — raw: %.40s\n", msgBuf);
    return;
  }

  int pid = doc["playerId"] | 0;
  if (pid < 1 || pid > 2) return;
  Player& pl = p[pid - 1];
  lastActivePlayer = pid;

  const char* result    = doc["result"]    | "fault";
  const char* faultType = doc["faultType"] | "none";
  float       speed     = doc["speed"]     | 0.0f;

  if (!roundActive) { Serial.println("Msg ignored: no active round"); return; }

  pl.totalReps++;
  pl.speedSum += speed;

  if (strcmp(result, "good") == 0) {
    pl.goodReps++;
    pl.streak++;
    Serial.printf("P%d GOOD  streak=%d\n", pid, pl.streak);
    if (pl.streak > pl.bestStreak) {
      pl.bestStreak = pl.streak;
      playClip(CUE_BEST);
      flashNeo(matrix.Color(0, 200, 0), 500);
    } else {
      flashNeo(matrix.Color(0, 200, 0), 350);
    }
    if (pl.streak >= WIN_STREAK) {
      endRound(pid);
      return;
    }
  } else {
    pl.streak = 0;
    strncpy(pl.lastFault, faultType, 23);
    pl.lastFault[23] = 0;
    for (int i = 0; i < 4; i++)
      if (strcmp(faultType, FAULT_NAMES[i]) == 0) { pl.faultCounts[i]++; break; }
    Serial.printf("P%d FAULT  type=%s\n", pid, faultType);
    if      (strcmp(faultType, "paddleDropped") == 0) playClip(CUE_PADDLE);
    else if (strcmp(faultType, "slowReturn")    == 0) playClip(CUE_SLOW);
    else if (strcmp(faultType, "inconsistent")  == 0) playClip(CUE_INCON);
    flashNeo(matrix.Color(200, 0, 0), 350);
  }
}

// ── Display: leaderboard (canvas → push once per frame) ──────────────────────
void drawLeaderboard() {
  canvas.fillScreen(COL_BLACK);

  // Header row — "Round N"  and  "XXs" timer
  canvas.setTextSize(1);
  canvas.setTextColor(COL_YELLOW);
  char hdr[16];
  snprintf(hdr, sizeof(hdr), "Round %d", roundNum);
  canvas.setCursor(4, 1);
  canvas.print(hdr);

  long remSec = max(0L, (long)((ROUND_MS - (millis() - roundStart)) / 1000));
  char tmr[8];
  snprintf(tmr, sizeof(tmr), "%lds", remSec);
  canvas.setTextColor(COL_CYAN);
  canvas.setCursor(160 - (int)(strlen(tmr) * 6) - 4, 1);
  canvas.print(tmr);

  // Sort by streak descending for leaderboard rank
  Player* sorted[2] = { &p[0], &p[1] };
  if (sorted[1]->streak > sorted[0]->streak) {
    Player* tmp = sorted[0]; sorted[0] = sorted[1]; sorted[1] = tmp;
  }

  // Two player rows — y=11 and y=38 (size-2 text = 16px, sub = 8px, gap = 3px)
  for (int i = 0; i < 2; i++) {
    Player* pl = sorted[i];
    int y = 11 + i * 27;
    canvas.setTextColor(i == 0 ? COL_GREEN : COL_WHITE);
    canvas.setTextSize(2);
    char line[14];
    snprintf(line, sizeof(line), "P%d  %d", pl->id, pl->streak);
    canvas.setCursor(4, y);
    canvas.print(line);

    canvas.setTextSize(1);
    canvas.setTextColor(COL_DIMGRAY);
    char sub[28];
    snprintf(sub, sizeof(sub), "best:%d  reps:%d", pl->bestStreak, pl->goodReps);
    canvas.setCursor(4, y + 18);
    canvas.print(sub);
  }

  // Last fault — bottom strip y=68 (8px height → ends at 76, inside 80)
  const char* fault = p[0].lastFault[0] ? p[0].lastFault : p[1].lastFault;
  if (fault[0]) {
    canvas.setTextSize(1);
    canvas.setTextColor(COL_RED);
    char fl[22];
    snprintf(fl, sizeof(fl), "%.21s", fault);
    canvas.setCursor(4, 68);
    canvas.print(fl);
  }

  tft.drawRGBBitmap(0, 0, canvas.getBuffer(), 160, 80);
}

// ── Display: winner screen (static, drawn once) ───────────────────────────────
void drawWinner(int winnerId) {
  canvas.fillScreen(COL_BLACK);

  canvas.setTextSize(2);
  canvas.setTextColor(COL_YELLOW);
  // "WINNER!" = 7 chars × 12px = 84px; cx = (160-84)/2 = 38
  canvas.setCursor(38, 8);
  canvas.print("WINNER!");

  canvas.setTextSize(3);
  canvas.setTextColor(COL_GREEN);
  char w[8];
  if (winnerId > 0) snprintf(w, sizeof(w), "P%d", winnerId);
  else              strncpy(w, "TIE", sizeof(w));
  int cx = (160 - (int)(strlen(w) * 18)) / 2;
  canvas.setCursor(cx, 32);
  canvas.print(w);

  canvas.setTextSize(1);
  canvas.setTextColor(COL_DIMGRAY);
  // "Press reset for next" = 20 chars × 6px = 120px; x=20 → ends at 140 < 160
  canvas.setCursor(20, 68);
  canvas.print("Press reset for next");

  tft.drawRGBBitmap(0, 0, canvas.getBuffer(), 160, 80);
}

// ── Display: idle / splash (drawn once at startup) ────────────────────────────
void drawIdle() {
  canvas.fillScreen(COL_BLACK);
  canvas.setTextSize(1);
  canvas.setTextColor(COL_CYAN);
  // "COACH STATION" = 13 chars × 6px = 78px; cx = (160-78)/2 = 41
  canvas.setCursor(41, 22);
  canvas.print("COACH STATION");
  canvas.setTextColor(COL_WHITE);
  // "Press reset to start" = 20 chars × 6px = 120px; cx = 20
  canvas.setCursor(20, 38);
  canvas.print("Press reset to start");
  canvas.setTextColor(COL_DIMGRAY);
  canvas.setCursor(8, 56);
  canvas.print(sdOk ? "SD: OK" : "SD: MISSING — no audio");
  tft.drawRGBBitmap(0, 0, canvas.getBuffer(), 160, 80);
}

// ── Display: volume overlay (drawn directly onto TFT, not via canvas) ─────────
// A semi-opaque pill in the top-right corner: speaker icon + bar + number.
// Appears for 2 s after any encoder turn or button press, then vanishes.
void drawVolOverlay() {
  // Pill background: x=90 y=0 w=70 h=14
  uint16_t bg  = 0x2945;   // dark blue-grey
  uint16_t bar = (volLevel == 0) ? COL_RED : COL_CYAN;
  tft.fillRect(90, 0, 70, 14, bg);

  // Speaker icon (simple: two lines)
  tft.drawPixel(93, 5, COL_WHITE); tft.drawPixel(93, 6, COL_WHITE); tft.drawPixel(93, 7, COL_WHITE);
  tft.drawLine(94, 3, 96, 1, COL_WHITE);
  tft.drawLine(94, 9, 96, 11, COL_WHITE);
  tft.drawLine(96, 1, 96, 11, COL_WHITE);

  // Volume bar: 21 steps, 2 px each → 42 px wide, starts at x=99
  int filled = (volLevel * 42) / 21;
  tft.fillRect(99, 4, filled,   6, bar);
  tft.fillRect(99 + filled, 4, 42 - filled, 6, 0x2104);   // dark remainder
  tft.drawRect(99, 4, 42, 6, COL_DIMGRAY);

  // Number right-aligned: up to "21"
  tft.setTextSize(1);
  tft.setTextColor(COL_WHITE, bg);
  char vn[4];
  snprintf(vn, sizeof(vn), "%2d", volLevel);
  tft.setCursor(152, 3);
  tft.print(vn);

  // If overlay expired, clear the pill area back to black
  if (volShowEnd == 0) tft.fillRect(90, 0, 70, 14, COL_BLACK);
}

// ── Voice handoff — pause game, ensure STA is up, POST, play, restore ─────────
void handleVoiceHandoff() {
  Serial.println("Voice: handoff start");
  unsigned long handoffStart = millis();   // round timer is paused for this long

  // No dead air while the POST happens
  playClip(CUE_THINK);
  unsigned long clipWait = millis() + 4000;
  while (millis() < clipWait) audio.loop();

  // Reconnect the internet (STA) side if not already up.
  // The paddle AP side is unaffected — UDP stays armed throughout.
  if (WiFi.status() != WL_CONNECTED) {
    Serial.print("Voice: WiFi reconnecting");
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    unsigned long wt = millis(), lastDot = 0;
    while (WiFi.status() != WL_CONNECTED && millis() - wt < 12000) {
      audio.loop();          // keep the "thinking" clip fed while we wait
      delay(10);
      if (millis() - lastDot > 200) { Serial.print("."); lastDot = millis(); }
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("Voice: WiFi OK — %s\n", WiFi.localIP().toString().c_str());
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Player& pl    = p[lastActivePlayer - 1];
    float   avgSp = pl.totalReps > 0 ? pl.speedSum / pl.totalReps : 0.0f;
    bool    ok    = voicePost(audio, sdOk,
                              pl.id, pl.goodReps, pl.streak, pl.bestStreak, avgSp);
    if (ok) {
      audioPlaying = true;
      unsigned long dl = millis() + 25000;
      while (millis() < dl) { audio.loop(); if (!audioPlaying) break; }
    } else {
      Serial.println("Voice: POST failed — resuming game");
    }
  } else {
    Serial.println("Voice: WiFi not connected — resuming game");
  }

  // Pause credit: the round shouldn't burn down while the coach was talking.
  if (roundActive) roundStart += millis() - handoffStart;

  voiceState = VS_LISTEN;
  recSamples = 0;
  vadSuppress(2000);
  Serial.println("Voice: done — game resumed");
}

// ── Arduino setup ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);

  // Buttons
  pinMode(BTN_PTT,   INPUT_PULLUP);
  pinMode(BTN_RESET, INPUT_PULLUP);

  // Rotary encoder — P8_IO1/IO2 need explicit pinMode (UART0 pins)
  pinMode(ENC_CLK, INPUT);
  pinMode(ENC_DT,  INPUT);
  pinMode(ENC_BTN, INPUT);   // active-HIGH, built-in pull-down

  // SPI bus + TFT
  mySPI.begin(SCK, MISO, MOSI);
  tft.initR(INITR_MINI160x80);
  tft.setRotation(3);

  // SD card (shares mySPI — must init after mySPI.begin)
  sdOk = SD.begin(SD_CS, mySPI);
  Serial.println(sdOk ? "SD: OK" : "SD: FAILED — clips unavailable");

  // Audio amplifier (on I2S1 — see constructor above)
  audio.setPinout(AUD_BCLK, AUD_LRC, AUD_DIN);
  audio.setVolume(16);

  // NeoPixel matrix
  matrix.begin();
  matrix.setBrightness(20);
  matrix.show();

  // Player state
  clearPlayer(p[0], 1);
  clearPlayer(p[1], 2);

  // Radio: own AP for the paddle (always up) + STA for internet (best-effort).
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(AP_SSID, AP_PASS);
  WiFi.setSleep(false);   // no modem power-save — keeps paddle UDP latency low
  Serial.printf("AP up: \"%s\" — paddle target %s:%d\n",
                AP_SSID, WiFi.softAPIP().toString().c_str(), UDP_PORT);
  udp.begin(UDP_PORT);    // paddle link works even if the venue side fails below

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi (internet) connecting");
  unsigned long wt0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wt0 < 15000) {
    delay(200); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWiFi: %s\n", WiFi.localIP().toString().c_str());
    // UTC clock for session timestamps — uploads skip until this syncs (~sec)
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  } else {
    Serial.println("\nWiFi (internet) failed — game runs offline; voice will retry on demand");
  }

  lastEncPos = encoder.getPosition();
  initMic();   // must allocate I2S0 in PDM RX mode (amp is on I2S1)
  drawIdle();
  Serial.println("Coach station ready. Press the reset button to start a round.");
}

// ── Arduino loop ──────────────────────────────────────────────────────────────
void loop() {
  audio.loop();   // MUST be called every iteration — feeds the I2S buffer

  // Poll UDP for paddle messages
  int pktSz = udp.parsePacket();
  if (pktSz > 0 && pktSz < 251) {
    int n = udp.read(msgBuf, 250);
    if (n > 0) { msgBuf[n] = 0; processMsg(); }
  }

  // Round-timer expiry (time-based win: most good reps)
  if (roundActive && millis() - roundStart >= ROUND_MS) {
    int winner = (p[0].goodReps > p[1].goodReps) ? 1
               : (p[1].goodReps > p[0].goodReps) ? 2 : 0;  // 0 = tie
    endRound(winner);
    return;   // skip display update this iteration
  }

  // Leaderboard refresh (throttled — unthrottled SPI clashes with audio reads)
  if (roundActive && millis() - lastDraw >= DRAW_MS) {
    drawLeaderboard();
    lastDraw = millis();
    if (volShowEnd > 0) volDirty = true;   // leaderboard just overwrote the pill
  }

  // ── Rotary encoder — volume control ────────────────────────────────────────
  encoder.tick();
  long encPos = encoder.getPosition();
  if (encPos != lastEncPos) {
    int delta   = (int)(encPos - lastEncPos);
    lastEncPos  = encPos;
    volLevel    = constrain(volLevel + delta, 0, 21);
    audio.setVolume(volLevel);
    volDirty    = true;
    volShowEnd  = millis() + 2000;
    Serial.printf("Volume: %d\n", volLevel);
  }
  // Encoder button — mute / restore toggle
  bool encBtn = digitalRead(ENC_BTN);
  if (encBtn == HIGH && lastEncBtn == LOW && (millis() - lastEncBtnTime > 150)) {
    volLevel   = (volLevel > 0) ? 0 : 16;
    audio.setVolume(volLevel);
    volDirty   = true;
    volShowEnd = millis() + 2000;
    lastEncBtnTime = millis();
    Serial.printf("Volume toggled: %d\n", volLevel);
  }
  lastEncBtn = encBtn;

  // Overlay expired — redraw to clear it
  if (volShowEnd > 0 && millis() > volShowEnd) {
    volShowEnd = 0;
    volDirty   = true;
  }

  // Draw volume overlay if needed (on top of whatever is on screen)
  if (volDirty) { drawVolOverlay(); volDirty = false; }

  // NeoPixel flash timeout → restore idle color
  updateNeo();

  // Round-reset button
  bool curReset = digitalRead(BTN_RESET);
  if (curReset == LOW && prevReset == HIGH) startRound();
  prevReset = curReset;

  // VAD — speech detection. Triggers are suppressed during clips AND during
  // active rounds (ball impacts false-trigger otherwise); P4 still works.
  if (micOk) vadTick(audioPlaying || roundActive);

  // P4 button — push-to-talk: starts a recording (the old jump straight to
  // VS_SENDING posted an empty buffer, which voicePost always rejected).
  bool curPTT = digitalRead(BTN_PTT);
  if (curPTT == LOW && prevPTT == HIGH && voiceState == VS_LISTEN) {
    Serial.println("P4: push-to-talk — recording");
    recSamples = 0;
    voiceState = VS_RECORDING;   // silence detection commits it as usual
  }
  prevPTT = curPTT;

  // Handle committed utterance (blocks while the POST runs; game timer pauses)
  if (voiceState == VS_SENDING) handleVoiceHandoff();
}

// ── Audio library callbacks ───────────────────────────────────────────────────
void audio_eof_mp3(const char* info) {
  Serial.printf("Clip finished: %s\n", info);
  audioPlaying = false;   // re-arms VAD after clip ends (+ vadSuppress cooldown)
}
