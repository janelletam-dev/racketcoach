import { describe, it, expect } from "vitest";
import {
  goodRepRate,
  pct,
  improvementLine,
  currentGoal,
  faultBreakdown,
} from "./insights";
import type { ApiSession } from "./api";

// Minimal session factory — only the fields the insights functions read matter;
// the rest are filled with harmless defaults.
function session(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: "s",
    userId: "u",
    playedAt: "2026-07-01T00:00:00Z",
    goodReps: 5,
    totalReps: 10,
    bestStreak: 3,
    commonFault: null,
    avgSpeed: null,
    durationSeconds: null,
    analysis: null,
    drills: null,
    analysisStatus: null,
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("goodRepRate", () => {
  it("is goodReps over totalReps", () => {
    expect(goodRepRate({ goodReps: 7, totalReps: 10 })).toBeCloseTo(0.7);
  });
  it("is 0 when there are no reps (no divide by zero)", () => {
    expect(goodRepRate({ goodReps: 0, totalReps: 0 })).toBe(0);
  });
});

describe("pct", () => {
  it("rounds to a whole percent", () => {
    expect(pct(0.714)).toBe("71%");
    expect(pct(0)).toBe("0%");
    expect(pct(1)).toBe("100%");
  });
});

describe("improvementLine", () => {
  it("nudges with fewer than two sessions", () => {
    expect(improvementLine([session()])).toMatch(/couple more sessions/i);
  });
  it("reports an increase (input is newest-first)", () => {
    const line = improvementLine([
      session({ goodReps: 8, totalReps: 10 }), // newest, 80%
      session({ goodReps: 4, totalReps: 10 }), // oldest, 40%
    ]);
    expect(line).toContain("40%");
    expect(line).toContain("80%");
    expect(line).toMatch(/went from/i);
  });
  it("flags a decline", () => {
    const line = improvementLine([
      session({ goodReps: 3, totalReps: 10 }), // newest, 30%
      session({ goodReps: 7, totalReps: 10 }), // oldest, 70%
    ]);
    expect(line).toMatch(/reset the basics/i);
  });
});

describe("currentGoal", () => {
  it("prompts a first session when empty", () => {
    expect(currentGoal([])).toMatch(/first session/i);
  });
  it("targets 80% when below it", () => {
    expect(currentGoal([session({ goodReps: 5, totalReps: 10 })])).toMatch(
      /80%/,
    );
  });
  it("targets the streak when at or above 80%", () => {
    expect(
      currentGoal([session({ goodReps: 9, totalReps: 10, bestStreak: 6 })]),
    ).toMatch(/best streak of 6/i);
  });
});

describe("faultBreakdown", () => {
  it("counts faults, most common first", () => {
    const result = faultBreakdown([
      session({ commonFault: "paddleDropped" }),
      session({ commonFault: "paddleDropped" }),
      session({ commonFault: "slowReturn" }),
    ]);
    expect(result[0]).toEqual({ fault: "paddleDropped", count: 2 });
    expect(result).toContainEqual({ fault: "slowReturn", count: 1 });
  });
  it("labels a missing fault as none", () => {
    expect(faultBreakdown([session({ commonFault: null })])).toEqual([
      { fault: "none", count: 1 },
    ]);
  });
});
