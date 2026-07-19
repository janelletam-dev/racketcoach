import { describe, it, expect } from "vitest";
import { parseSignals, signalTiles } from "./signals";

describe("parseSignals", () => {
  it("returns null for null, empty, or non-JSON", () => {
    expect(parseSignals(null)).toBeNull();
    expect(parseSignals("")).toBeNull();
    expect(parseSignals("not json")).toBeNull();
  });
  it("parses a JSON object", () => {
    expect(parseSignals('{"imu":{"consistency":80}}')).toEqual({
      imu: { consistency: 80 },
    });
  });
});

describe("signalTiles", () => {
  it("is empty for null signals", () => {
    expect(signalTiles(null)).toEqual([]);
  });

  it("emits only fields that are present (guardrail: absent = not measured)", () => {
    const tiles = signalTiles({ imu: { consistency: 82 } });
    expect(tiles).toHaveLength(1);
    expect(tiles[0].label).toBe("Consistency");
    expect(tiles[0].value).toBe("82/100");
  });

  it("renders the full imu group in a stable order", () => {
    const tiles = signalTiles({
      imu: {
        swingSpeed: 2.4,
        consistency: 60,
        paddleFace: "dropped",
        returnTime: 900,
      },
    });
    expect(tiles.map((t) => t.label)).toEqual([
      "Swing power",
      "Consistency",
      "Paddle face",
      "Reset speed",
    ]);
  });

  it("converts returnTime ms to seconds and flags a quick reset", () => {
    const [tile] = signalTiles({ imu: { returnTime: 900 } });
    expect(tile.value).toBe("0.9s");
    expect(tile.sub).toMatch(/quick/i);
  });

  it("labels a dropped paddle face plainly", () => {
    const [tile] = signalTiles({ imu: { paddleFace: "dropped" } });
    expect(tile.value).toBe("Dropped");
  });

  it("includes camera signals when present", () => {
    const tiles = signalTiles({
      camera: { contactInFront: true, followThrough: "full" },
    });
    expect(tiles.map((t) => t.label)).toEqual([
      "Contact point",
      "Follow-through",
    ]);
    expect(tiles[0].value).toBe("In front");
  });

  it("never invents a tile from a missing/undefined value", () => {
    expect(signalTiles({ imu: { consistency: undefined } })).toEqual([]);
    expect(signalTiles({ imu: {}, camera: {} })).toEqual([]);
  });
});
