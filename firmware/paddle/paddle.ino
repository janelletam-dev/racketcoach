// RacketCoach Paddle — Genesis Mini + LSM6DS3TR (AX22-0054 on port 1)
//
// Three jobs, all at once:
//   1. RAW STREAM  — filtered CSV @30Hz over USB serial + SSE on port 80
//                    (unchanged: feeds Live Motion.html for demos/data collection)
//   2. SWING DETECT — knowledge-base §3 IMU parsing, on RAW samples @~100Hz:
//                    magnitude threshold → peak → settle, 350ms debounce,
//                    consistency vs recent peaks, paddleFace pitch at peak,
//                    returnTime until orientation is stable again
//   3. STATION LINK — one small UDP JSON packet per swing to the coach
//                    station (fixed IP on the station's own AP). Carries the
//                    numeric signals AND the legacy result/faultType fields,
//                    so the current station firmware works unmodified.
//
// Networks: set WIFI_SSID/WIFI_PASSWORD in secrets.h.
//   - Demo/venue: the station's AP  →  "racketcoach" / "paddle123"
//     (station is always at 192.168.4.1 — the default STATION_IP below)
//   - Home bench: your home network; set STATION_IP to the station's IP,
//     or leave the paddle talking to nothing and just use Live Motion.
//
// Output CSV: timestamp_ms, accel xyz (m/s²), gyro xyz (rad/s)

#include <Wire.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <ESPmDNS.h>
#include <Adafruit_LSM6DS3.h>
#include "secrets.h"

// ── Station link ─────────────────────────────────────────────────────────────
#ifndef STATION_IP
#define STATION_IP "192.168.4.1"     // coach station on its own AP
#endif
#ifndef PLAYER_ID
#define PLAYER_ID 1                  // set 2 on the second paddle
#endif
const int STATION_PORT = 4210;
WiFiUDP udp;

Adafruit_LSM6DS3 lsm6ds;
WiFiServer server(80);
WiFiClient streamClient;

// Calibration offsets (computed once at startup) — used for the DISPLAY
// stream only. Swing detection uses raw values incl. gravity (§3: magnitude
// crosses threshold, ends near 1g).
float offAx = 0, offAy = 0, offAz = 0;
float offGx = 0, offGy = 0, offGz = 0;

// ── Timing ──────────────────────────────────────────────────────────────────
// Detection polls fast (impact peaks are short); the display stream stays 30Hz.
const unsigned long DETECT_MS = 10;   // ~100 Hz detection poll
const unsigned long STREAM_MS = 33;   // ~30 Hz display stream
unsigned long lastDetect = 0, lastStream = 0;

// Low-pass + deadband — display stream only
const float ALPHA  = 0.17f;
const float DEAD_A = 0.12f;   // m/s²
const float DEAD_G = 0.025f;  // rad/s
float fAx = 0, fAy = 0, fAz = 0, fGx = 0, fGy = 0, fGz = 0;
bool  filterInit = false;

// ── Swing detection (knowledge base §3) ──────────────────────────────────────
const float G_MS2         = 9.80665f;
const float SWING_START_G = 1.8f;    // raw |a| crosses above → swing begins
const float SWING_END_G   = 1.25f;   // raw |a| back near 1g → swing over
const unsigned long DEBOUNCE_MS   = 350;
const float GYRO_STILL_RAD  = 0.35f; // |gyro| below this = paddle settled
const unsigned long STILL_HOLD_MS = 250;   // must stay still this long
const unsigned long RETURN_CAP_MS = 2500;  // give up waiting; report cap
const float FACE_DROPPED_DEG = -25.0f;     // pitch at peak below this = dropped

// Thresholds for classification (tune on real swings)
const float  OVERHIT_FACTOR   = 1.35f;  // peak > 1.35× running avg = "hard"
const float  CONSISTENCY_LOW  = 55.0f;  // 0-100
const unsigned long SLOW_RETURN_MS = 1200;

enum SwingState { SW_IDLE, SW_IN_SWING, SW_SETTLING };
SwingState swingState = SW_IDLE;
unsigned long swingEndAt = 0, stillSince = 0, lastSwingSent = 0;
float peakG = 0, pitchAtPeak = 0;

// Recent peaks for consistency (§3: closeness to running average)
const int PEAK_N = 8;
float peaks[PEAK_N]; int peakCount = 0, peakIdx = 0;

// Complementary-filter pitch estimate (for paddleFace).
// NOTE: assumes gyro Y is the pitch axis for how the sensor sits in the
// paddle — if face up/dropped reads backwards or dead, swap gy for gx here
// and in the update below. Verify with Live Motion: tilt the paddle face
// down and watch which gyro axis moves.
float pitchDeg = 0;
unsigned long lastPitchUs = 0;

void updatePitch(float axr, float ayr, float azr, float gyr) {
  unsigned long nowUs = micros();
  float dt = lastPitchUs ? (nowUs - lastPitchUs) / 1e6f : 0.01f;
  lastPitchUs = nowUs;
  pitchDeg += gyr * 57.2958f * dt;                 // integrate gyro (deg)
  float mag = sqrtf(axr * axr + ayr * ayr + azr * azr);
  if (fabsf(mag - G_MS2) < 0.15f * G_MS2) {         // quasi-static → trust accel
    float accPitch = atan2f(-axr, sqrtf(ayr * ayr + azr * azr)) * 57.2958f;
    pitchDeg = 0.98f * pitchDeg + 0.02f * accPitch;
  }
}

float runningPeakAvg() {
  if (peakCount == 0) return 0;
  float s = 0;
  for (int i = 0; i < peakCount; i++) s += peaks[i];
  return s / peakCount;
}

// §3: consistency = how close this peak is to the running average (0-100)
float consistencyFor(float peak) {
  float avg = runningPeakAvg();
  if (avg <= 0) return 100.0f;
  float dev = fabsf(peak - avg) / avg;
  return constrain(100.0f * (1.0f - dev), 0.0f, 100.0f);
}

// ── Station packet — signals + legacy fields the current station parses ──────
void sendSwingPacket(float swingSpeedG, float consistency, bool faceDropped,
                     unsigned long returnMs) {
  // Classify (cue-library priority; station plays its matching clip)
  const char* fault  = "none";
  const char* result = "good";
  if (faceDropped)                                { fault = "paddleDropped"; }
  else if (returnMs >= SLOW_RETURN_MS)            { fault = "slowReturn"; }
  else if (swingSpeedG > runningPeakAvg() * OVERHIT_FACTOR &&
           consistency < CONSISTENCY_LOW)         { fault = "overHitting"; }
  else if (consistency < CONSISTENCY_LOW)         { fault = "inconsistent"; }
  if (fault[0] != 'n') result = "fault";

  char pkt[240];
  snprintf(pkt, sizeof(pkt),
    "{\"playerId\":%d,\"result\":\"%s\",\"faultType\":\"%s\",\"speed\":%.2f,"
    "\"swingSpeed\":%.2f,\"consistency\":%.0f,\"paddleFace\":\"%s\",\"returnTime\":%lu}",
    PLAYER_ID, result, fault, swingSpeedG,
    swingSpeedG, consistency, faceDropped ? "dropped" : "up", returnMs);

  if (WiFi.status() == WL_CONNECTED) {
    udp.beginPacket(STATION_IP, STATION_PORT);
    udp.print(pkt);
    udp.endPacket();
  }
  Serial.print("SWING:"); Serial.println(pkt);   // visible on Live Motion too
}

// Run the §3 state machine on RAW samples (gravity included)
void detectSwing(float axr, float ayr, float azr, float gxr, float gyr, float gzr) {
  unsigned long now = millis();
  float magG  = sqrtf(axr * axr + ayr * ayr + azr * azr) / G_MS2;
  float gyroM = sqrtf(gxr * gxr + gyr * gyr + gzr * gzr);

  switch (swingState) {
    case SW_IDLE:
      if (magG > SWING_START_G && now - lastSwingSent > DEBOUNCE_MS) {
        swingState  = SW_IN_SWING;
        peakG       = magG;
        pitchAtPeak = pitchDeg;
      }
      break;

    case SW_IN_SWING:
      if (magG > peakG) { peakG = magG; pitchAtPeak = pitchDeg; }
      if (magG < SWING_END_G) {
        swingState = SW_SETTLING;      // §3: returnTime starts at swing end
        swingEndAt = now;
        stillSince = 0;
      }
      break;

    case SW_SETTLING: {
      bool still = gyroM < GYRO_STILL_RAD;
      if (still && stillSince == 0) stillSince = now;
      if (!still) stillSince = 0;
      bool settled  = still && (now - stillSince >= STILL_HOLD_MS);
      bool capped   = now - swingEndAt >= RETURN_CAP_MS;
      if (settled || capped) {
        unsigned long returnMs = settled ? (stillSince - swingEndAt)
                                         : RETURN_CAP_MS;
        float cons = consistencyFor(peakG);
        sendSwingPacket(peakG, cons, pitchAtPeak < FACE_DROPPED_DEG, returnMs);
        peaks[peakIdx] = peakG;                      // update history AFTER
        peakIdx = (peakIdx + 1) % PEAK_N;            // scoring this swing
        if (peakCount < PEAK_N) peakCount++;
        lastSwingSent = now;
        swingState = SW_IDLE;
      }
      break;
    }
  }
}

// ── Raw-stream helpers (unchanged behavior) ──────────────────────────────────
bool initSensor() {
  Wire.begin();
  if (!lsm6ds.begin_I2C(0x6B)) return false;
  lsm6ds.setAccelRange(LSM6DS_ACCEL_RANGE_8_G);
  lsm6ds.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  // 104 Hz: detection polls at ~100 Hz, so every poll sees a fresh sample.
  lsm6ds.setAccelDataRate(LSM6DS_RATE_104_HZ);
  lsm6ds.setGyroDataRate(LSM6DS_RATE_104_HZ);
  return true;
}

void calibrate(int samples) {
  double sumAx = 0, sumAy = 0, sumAz = 0, sumGx = 0, sumGy = 0, sumGz = 0;
  sensors_event_t a, g, temp;
  for (int i = 0; i < samples; i++) {
    lsm6ds.getEvent(&a, &g, &temp);
    sumAx += a.acceleration.x; sumAy += a.acceleration.y; sumAz += a.acceleration.z;
    sumGx += g.gyro.x;         sumGy += g.gyro.y;         sumGz += g.gyro.z;
    delay(10);
  }
  offAx = sumAx / samples; offAy = sumAy / samples; offAz = sumAz / samples;
  offGx = sumGx / samples; offGy = sumGy / samples; offGz = sumGz / samples;
}

void broadcastLine(const String &line) {
  Serial.println(line);
  if (streamClient.connected()) {
    streamClient.print("data: ");
    streamClient.print(line);
    streamClient.print("\n\n");
  }
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);   // low-latency swing packets beat modem power-save
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi \""); Serial.print(WIFI_SSID); Serial.print("\"");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected. Board IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Swing packets -> "); Serial.print(STATION_IP);
    Serial.print(":"); Serial.println(STATION_PORT);
    server.begin();
    if (MDNS.begin("racketcoach-paddle")) {
      Serial.println("mDNS ready: http://racketcoach-paddle.local/");
    } else {
      Serial.println("mDNS setup failed - use the IP address above instead.");
    }
  } else {
    Serial.println("Wi-Fi connect failed - check secrets.h and signal. USB serial still works.");
  }
}

void handleClients() {
  WiFiClient newClient = server.available();
  if (!newClient) return;
  newClient.setTimeout(200);
  while (newClient.connected() && newClient.readStringUntil('\n').length() > 1) {}
  newClient.print(
    "HTTP/1.1 200 OK\r\n"
    "Content-Type: text/event-stream\r\n"
    "Cache-Control: no-cache\r\n"
    "Connection: keep-alive\r\n"
    "Access-Control-Allow-Origin: *\r\n"
    "\r\n"
  );
  streamClient.stop();
  streamClient = newClient;
}

// ── setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  if (!initSensor()) {
    Serial.println("ERROR: LSM6DS3 not found — check wiring and I2C address");
    while (true) { delay(1000); }
  }

  connectWiFi();

  broadcastLine("STATUS:CALIBRATING");
  calibrate(500);   // hold racket vertically (handle up) for 5 s
  broadcastLine("STATUS:READY");
  broadcastLine("timestamp_ms,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z");

  lastDetect = lastStream = millis();
}

// ── loop ─────────────────────────────────────────────────────────────────────
void loop() {
  handleClients();

  unsigned long now = millis();
  if (now - lastDetect < DETECT_MS) return;
  lastDetect = now;

  sensors_event_t a, g, temp;
  lsm6ds.getEvent(&a, &g, &temp);

  // RAW values (gravity included) → pitch estimate + swing detection
  updatePitch(a.acceleration.x, a.acceleration.y, a.acceleration.z, g.gyro.y);
  detectSwing(a.acceleration.x, a.acceleration.y, a.acceleration.z,
              g.gyro.x, g.gyro.y, g.gyro.z);

  // DISPLAY stream at 30 Hz: offset-corrected, filtered, deadbanded
  if (now - lastStream < STREAM_MS) return;
  lastStream = now;

  float ax = a.acceleration.x - offAx, ay = a.acceleration.y - offAy,
        az = a.acceleration.z - offAz;
  float gx = g.gyro.x - offGx, gy = g.gyro.y - offGy, gz = g.gyro.z - offGz;

  if (!filterInit) {
    fAx = ax; fAy = ay; fAz = az; fGx = gx; fGy = gy; fGz = gz;
    filterInit = true;
  } else {
    fAx = ALPHA*ax + (1-ALPHA)*fAx;  fAy = ALPHA*ay + (1-ALPHA)*fAy;
    fAz = ALPHA*az + (1-ALPHA)*fAz;  fGx = ALPHA*gx + (1-ALPHA)*fGx;
    fGy = ALPHA*gy + (1-ALPHA)*fGy;  fGz = ALPHA*gz + (1-ALPHA)*fGz;
  }
  if (fabsf(fAx) < DEAD_A) fAx = 0;  if (fabsf(fAy) < DEAD_A) fAy = 0;
  if (fabsf(fAz) < DEAD_A) fAz = 0;  if (fabsf(fGx) < DEAD_G) fGx = 0;
  if (fabsf(fGy) < DEAD_G) fGy = 0;  if (fabsf(fGz) < DEAD_G) fGz = 0;

  String line = String(now) + ',' + String(fAx, 4) + ',' + String(fAy, 4) + ',' +
                String(fAz, 4) + ',' + String(fGx, 4) + ',' + String(fGy, 4) + ',' +
                String(fGz, 4);
  broadcastLine(line);
}
