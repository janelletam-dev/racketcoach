// Ping Pong Racket Motion Capture
// LSM6DS3TR via I2C → CSV over Serial at 115200 baud
// Output: timestamp_ms, accel xyz (m/s²), gyro xyz (rad/s)

#include <Wire.h>
#include <Adafruit_LSM6DS3.h>

Adafruit_LSM6DS3 lsm6ds;

// Calibration offsets (computed once at startup)
float offAx = 0, offAy = 0, offAz = 0;
float offGx = 0, offGy = 0, offGz = 0;

// Sampling interval
const unsigned long INTERVAL_MS = 10; // 100 Hz
unsigned long lastSample = 0;

// Low-pass filter (exponential moving average)
// Alpha: 0 = max smoothing, 1 = no smoothing; 0.05 for stable idle at 100 Hz
const float ALPHA = 0.05f;

// Deadband: values smaller than these snap to zero (kills sensor idle chatter)
const float DEAD_A = 0.08f;  // m/s²
const float DEAD_G = 0.015f; // rad/s
float fAx = 0, fAy = 0, fAz = 0;
float fGx = 0, fGy = 0, fGz = 0;
bool filterInit = false;

// ── helpers ─────────────────────────────────────────────────────────────────

bool initSensor() {
  Wire.begin();
  if (!lsm6ds.begin_I2C(0x6B)) {
    return false;
  }
  // High-range settings for racket impact
  lsm6ds.setAccelRange(LSM6DS_ACCEL_RANGE_16_G);
  lsm6ds.setGyroRange(LSM6DS_GYRO_RANGE_2000_DPS);
  // ODR: 104 Hz (closest standard rate above 100 Hz)
  lsm6ds.setAccelDataRate(LSM6DS_RATE_104_HZ);
  lsm6ds.setGyroDataRate(LSM6DS_RATE_104_HZ);
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

// ── setup ────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500); // brief settle for USB enumeration

  if (!initSensor()) {
    Serial.println("ERROR: LSM6DS3 not found — check wiring and I2C address");
    while (true) { delay(1000); }
  }

  // Calibrate: hold racket vertically (handle up) for 5 s
  Serial.println("STATUS:CALIBRATING");
  calibrate(500); // 500 samples × 10 ms = 5 s

  Serial.println("STATUS:READY");

  // ── Height calibration phase 1: table level ─────────────────────────────
  Serial.println("STATUS:HEIGHT_LOW_START");
  for (int i = 5; i >= 1; i--) {
    Serial.print("HEIGHT:LOW:"); Serial.println(i);
    delay(1000);
  }
  Serial.println("STATUS:HEIGHT_LOW_CAPTURE");
  delay(400);

  // ── Height calibration phase 2: max reach ───────────────────────────────
  Serial.println("STATUS:HEIGHT_HIGH_START");
  for (int i = 5; i >= 1; i--) {
    Serial.print("HEIGHT:HIGH:"); Serial.println(i);
    delay(1000);
  }
  Serial.println("STATUS:HEIGHT_HIGH_CAPTURE");
  delay(400);

  // CSV header — streaming begins now
  Serial.println("timestamp_ms,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z");

  lastSample = millis();
}

// ── loop ─────────────────────────────────────────────────────────────────────

void loop() {
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

  // Print filtered CSV line
  Serial.print(now);          Serial.print(',');
  Serial.print(fAx, 4);       Serial.print(',');
  Serial.print(fAy, 4);       Serial.print(',');
  Serial.print(fAz, 4);       Serial.print(',');
  Serial.print(fGx, 4);       Serial.print(',');
  Serial.print(fGy, 4);       Serial.print(',');
  Serial.println(fGz, 4);
}
