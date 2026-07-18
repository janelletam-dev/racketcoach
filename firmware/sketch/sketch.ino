// Ping Pong Racket Motion Capture
// LSM6DS3TR via I2C → CSV streamed over USB serial (115200 baud) AND, once
// on Wi-Fi, over HTTP Server-Sent Events on port 80 (no cable needed).
// Once on Wi-Fi the board is also reachable at http://racketcoach.local/
// (mDNS) so you never have to look up its IP.
// Output: timestamp_ms, accel xyz (m/s²), gyro xyz (rad/s)
//
// Wi-Fi credentials live in secrets.h (gitignored, not committed) - copy
// secrets.h.example to secrets.h in this folder and fill in your network.

#include <Wire.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Adafruit_LSM6DS3.h>
#include "secrets.h"

Adafruit_LSM6DS3 lsm6ds;
WiFiServer server(80);
WiFiClient streamClient;

// Calibration offsets (computed once at startup)
float offAx = 0, offAy = 0, offAz = 0;
float offGx = 0, offGy = 0, offGz = 0;

// Sampling interval
// Table tennis swing kinematics live well under 20 Hz, so 30 Hz still gives
// headroom without flooding the link or the demo UI with samples.
const unsigned long INTERVAL_MS = 33; // ~30 Hz
unsigned long lastSample = 0;

// Low-pass filter (exponential moving average)
// Alpha: 0 = max smoothing, 1 = no smoothing. 0.17 keeps roughly the same
// ~0.2 s time constant as before now that the sample interval is longer.
const float ALPHA = 0.17f;

// Deadband: values smaller than these snap to zero (kills sensor idle chatter,
// e.g. hand tremor while holding the paddle still)
const float DEAD_A = 0.12f; // m/s²
const float DEAD_G = 0.025f; // rad/s
float fAx = 0, fAy = 0, fAz = 0;
float fGx = 0, fGy = 0, fGz = 0;
bool filterInit = false;

// ── helpers ─────────────────────────────────────────────────────────────────

bool initSensor() {
  Wire.begin();
  if (!lsm6ds.begin_I2C(0x6B)) {
    return false;
  }
  // Range sized for table tennis strokes, not full-power tennis/squash swings:
  // paddle-head accel tops out around 6-8g on a hard loop, wrist rate around
  // 500-800 deg/s on a fast topspin. Narrower range = finer resolution.
  lsm6ds.setAccelRange(LSM6DS_ACCEL_RANGE_8_G);
  lsm6ds.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  // ODR: 52 Hz (closest standard rate above the 30 Hz sample loop, so every
  // poll gets a fresh reading instead of a stale/repeated one)
  lsm6ds.setAccelDataRate(LSM6DS_RATE_52_HZ);
  lsm6ds.setGyroDataRate(LSM6DS_RATE_52_HZ);
  return true;
}

void calibrate(int samples) {
  // Collect samples while sensor is stationary; average as offset baseline
  double sumAx = 0, sumAy = 0, sumAz = 0;
  double sumGx = 0, sumGy = 0, sumGz = 0;

  sensors_event_t a, g, temp;
  for (int i = 0; i < samples; i++) {
    lsm6ds.getEvent(&a, &g, &temp);
    sumAx += a.acceleration.x;
    sumAy += a.acceleration.y;
    sumAz += a.acceleration.z;
    sumGx += g.gyro.x;
    sumGy += g.gyro.y;
    sumGz += g.gyro.z;
    delay(10);
  }

  offAx = sumAx / samples;
  offAy = sumAy / samples;
  offAz = sumAz / samples;
  offGx = sumGx / samples;
  offGy = sumGy / samples;
  offGz = sumGz / samples;
}

// Sends a line to whichever links are live: always USB serial, plus the
// Wi-Fi client (if one is connected) as one SSE event.
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
    server.begin();
    if (MDNS.begin("racketcoach")) {
      Serial.println("mDNS ready: http://racketcoach.local/");
    } else {
      Serial.println("mDNS setup failed - use the IP address above instead.");
    }
  } else {
    Serial.println("Wi-Fi connect failed - check secrets.h and signal. USB serial still works.");
  }
}

// Accepts a new HTTP client and turns it into the live SSE stream. Serves
// the same response regardless of path/method - there is only one stream.
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

  streamClient.stop(); // only one live viewer at a time
  streamClient = newClient;
}

// ── setup ────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500); // brief settle for USB enumeration

  if (!initSensor()) {
    Serial.println("ERROR: LSM6DS3 not found — check wiring and I2C address");
    while (true) { delay(1000); }
  }

  connectWiFi();

  // Calibrate: hold racket vertically (handle up) for 5 s
  broadcastLine("STATUS:CALIBRATING");
  calibrate(500); // 500 samples × 10 ms = 5 s

  broadcastLine("STATUS:READY");

  // CSV header — streaming begins now
  broadcastLine("timestamp_ms,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z");

  lastSample = millis();
}

// ── loop ─────────────────────────────────────────────────────────────────────

void loop() {
  handleClients();

  unsigned long now = millis();
  if (now - lastSample < INTERVAL_MS) return;
  lastSample = now;

  sensors_event_t a, g, temp;
  lsm6ds.getEvent(&a, &g, &temp);

  float ax = a.acceleration.x - offAx;
  float ay = a.acceleration.y - offAy;
  float az = a.acceleration.z - offAz;
  float gx = g.gyro.x - offGx;
  float gy = g.gyro.y - offGy;
  float gz = g.gyro.z - offGz;

  // Exponential moving-average low-pass filter
  if (!filterInit) {
    fAx = ax; fAy = ay; fAz = az;
    fGx = gx; fGy = gy; fGz = gz;
    filterInit = true;
  } else {
    fAx = ALPHA*ax + (1-ALPHA)*fAx;
    fAy = ALPHA*ay + (1-ALPHA)*fAy;
    fAz = ALPHA*az + (1-ALPHA)*fAz;
    fGx = ALPHA*gx + (1-ALPHA)*fGx;
    fGy = ALPHA*gy + (1-ALPHA)*fGy;
    fGz = ALPHA*gz + (1-ALPHA)*fGz;
  }

  // Deadband: clamp tiny residual noise to zero
  if (fabsf(fAx) < DEAD_A) fAx = 0;
  if (fabsf(fAy) < DEAD_A) fAy = 0;
  if (fabsf(fAz) < DEAD_A) fAz = 0;
  if (fabsf(fGx) < DEAD_G) fGx = 0;
  if (fabsf(fGy) < DEAD_G) fGy = 0;
  if (fabsf(fGz) < DEAD_G) fGz = 0;

  // Broadcast the filtered CSV line over whichever links are live
  String line = String(now) + ',' + String(fAx, 4) + ',' + String(fAy, 4) + ',' +
                 String(fAz, 4) + ',' + String(fGx, 4) + ',' + String(fGy, 4) + ',' +
                 String(fGz, 4);
  broadcastLine(line);
}
