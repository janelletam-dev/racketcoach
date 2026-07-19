// Parser + plain-language formatter for a session's `signals` JSON (see
// backend/src/coaching/signals.ts — the canonical wire schema). Aggregates are
// always present; `imu` / `camera` groups appear only when that sensor ran, and
// individual fields inside a group are partial. GUARDRAIL: an absent field means
// "not measured" — never default it, never invent it. We render only what is
// present, so the page can never claim a signal the sensors did not capture.

export type ImuSignals = {
  swingSpeed?: number; // peak acceleration magnitude, in g
  consistency?: number; // 0-100, inverse of swing-peak variance
  paddleFace?: "up" | "dropped";
  returnTime?: number; // ms to settle back to ready
};

export type CameraSignals = {
  elbowGap?: number; // normalised elbow-to-torso distance
  contactInFront?: boolean; // wrist ahead of the shoulder line at contact
  shoulderRotation?: number; // degrees, backswing to contact
  followThrough?: "short" | "full";
};

export type Signals = {
  goodReps?: number;
  totalReps?: number;
  bestStreak?: number;
  imu?: ImuSignals;
  camera?: CameraSignals;
};

export function parseSignals(raw: string | null): Signals | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    return value as Signals;
  } catch {
    return null;
  }
}

export type SignalTile = { label: string; value: string; sub?: string };

const isNum = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);

// Each present signal becomes one plain-language tile. Order is stable so the
// grid reads the same session to session. Only present fields are emitted.
export function signalTiles(signals: Signals | null): SignalTile[] {
  if (!signals) return [];
  const tiles: SignalTile[] = [];
  const imu = signals.imu;
  const cam = signals.camera;

  if (imu) {
    if (isNum(imu.swingSpeed)) {
      tiles.push({
        label: "Swing power",
        value: `${imu.swingSpeed.toFixed(1)}g`,
        sub: imu.swingSpeed >= 3 ? "Big hitter" : "Controlled pace",
      });
    }
    if (isNum(imu.consistency)) {
      const c = Math.round(imu.consistency);
      tiles.push({
        label: "Consistency",
        value: `${c}/100`,
        sub: c >= 75 ? "Steady, repeatable swing" : c >= 50 ? "Getting there" : "Match your last swing",
      });
    }
    if (imu.paddleFace === "up" || imu.paddleFace === "dropped") {
      tiles.push({
        label: "Paddle face",
        value: imu.paddleFace === "up" ? "Up" : "Dropped",
        sub: imu.paddleFace === "up" ? "Held level at contact" : "Dropping on contact",
      });
    }
    if (isNum(imu.returnTime)) {
      const s = imu.returnTime / 1000;
      tiles.push({
        label: "Reset speed",
        value: `${s.toFixed(1)}s`,
        sub: imu.returnTime <= 1000 ? "Quick back to ready" : imu.returnTime >= 1200 ? "Reset faster to ready" : "Steady reset",
      });
    }
  }

  if (cam) {
    if (isNum(cam.shoulderRotation)) {
      tiles.push({
        label: "Shoulder turn",
        value: `${Math.round(cam.shoulderRotation)}°`,
        sub: cam.shoulderRotation >= 30 ? "Good rotation" : "Turn more into the shot",
      });
    }
    if (typeof cam.contactInFront === "boolean") {
      tiles.push({
        label: "Contact point",
        value: cam.contactInFront ? "In front" : "Behind",
        sub: cam.contactInFront ? "Meeting the ball early" : "Catch it further in front",
      });
    }
    if (cam.followThrough === "short" || cam.followThrough === "full") {
      tiles.push({
        label: "Follow-through",
        value: cam.followThrough === "full" ? "Full" : "Short",
        sub: cam.followThrough === "full" ? "Finishing the swing" : "Finish through the ball",
      });
    }
    if (isNum(cam.elbowGap)) {
      tiles.push({
        label: "Elbow gap",
        value: cam.elbowGap.toFixed(2),
        sub: "Elbow-to-body distance",
      });
    }
  }

  return tiles;
}
