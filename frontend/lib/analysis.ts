// Parsers for the session-analysis fields. The backend stores `analysis` and
// `drills` as JSON strings (see backend/src/db/schema.ts), so the frontend
// parses them. Both are null until the analyzer (Part B) has run, and malformed
// JSON degrades to a safe default rather than crashing the page.

export type Analysis = {
  summary?: string;
  faultDetail?: string;
  focusAdvice?: string;
};

export type Drill = {
  title: string;
  url: string;
  source?: string;
  why?: string;
};

export function parseAnalysis(raw: string | null): Analysis | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Analysis;
  } catch {
    return null;
  }
}

export function parseDrills(raw: string | null): Drill[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? (value as Drill[]) : [];
  } catch {
    return [];
  }
}
