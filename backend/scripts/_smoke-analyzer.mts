/**
 * B3 analyzer smoke suite (stubbed externals, local DB). Run from backend/:
 *   npx tsx scripts/_smoke-analyzer.mts
 * Exercises: (A) degraded no-keys path, (B) happy path with stubbed
 * Claude+Linkup, (C) Linkup 5xx never kills an analysis, (D) Claude garbage
 * output → failed never pending, (E) raw-file feature derivation, (F) camera
 * metrics lifting the guardrail.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = "file:./racketcoach.db";

const { db } = await import("../src/db/index");
const { sessions, users } = await import(
  "../src/db/schema"
);
const { analyzeSession } = await import(
  "../src/services/analyzeSession"
);

const [demo] = await db.select().from(users).limit(1);
if (!demo) throw new Error("seed first");

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}`, extra ?? "");
  }
}

async function mkSession(over: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(sessions)
    .values({
      userId: demo.id,
      playedAt: new Date(),
      goodReps: 42,
      totalReps: 100,
      bestStreak: 6,
      commonFault: "late paddle",
      avgSpeed: 9.4,
      analysisStatus: "pending",
      ...over,
    })
    .returning();
  return row;
}
const getRow = async (id: string) =>
  (await db.select().from(sessions).where(eq(sessions.id, id)).limit(1))[0];

const realFetch = globalThis.fetch;

// ---- A: no keys → failed, row intact -----------------------------------
console.log("A: degraded (no keys)");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LINKUP_API_KEY;
{
  const s = await mkSession();
  await analyzeSession(s.id);
  const r = await getRow(s.id);
  check("status failed", r.analysisStatus === "failed", r.analysisStatus);
  check("no analysis", r.analysis == null);
  check("stats intact", r.goodReps === 42 && r.totalReps === 100);
}

// ---- B: happy path (stubbed Claude + Linkup) ---------------------------
console.log("B: happy path (stubs)");
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.LINKUP_API_KEY = "test-key";
let claudeReqs: any[] = [];
let linkupReqs: any[] = [];
globalThis.fetch = (async (url: any, init: any) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    claudeReqs.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              summary: "Solid session — 42 of 100 clean with a best streak of 6.",
              faultDetail: "The station flagged late paddle contact most often.",
              focusAdvice: "Next session, focus on resetting to ready between shots.",
            }),
          },
        ],
      }),
      { status: 200 },
    );
  }
  if (u.includes("api.linkup.so")) {
    linkupReqs.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        results: [
          { name: "Drill 1", url: "https://www.pingsunday.com/d1", content: "why 1" },
          { name: "Drill 2", url: "https://pingskills.com/d2", content: "why 2" },
          { name: "Drill 3", url: "https://example.com/d3", content: "why 3" },
          { name: "Drill 4", url: "https://example.com/d4", content: "why 4" },
        ],
      }),
      { status: 200 },
    );
  }
  return realFetch(url, init);
}) as any;
{
  const s = await mkSession();
  await analyzeSession(s.id);
  const r = await getRow(s.id);
  check("status done", r.analysisStatus === "done", r.analysisStatus);
  const analysis = JSON.parse(r.analysis!);
  check("analysis fields", !!(analysis.summary && analysis.faultDetail && analysis.focusAdvice));
  const drills = JSON.parse(r.drills!);
  check("3 drills max", drills.length === 3, drills.length);
  check("drill shape", !!(drills[0].title && drills[0].url && drills[0].source && drills[0].why));
  check("source is hostname", drills[0].source === "pingsunday.com", drills[0].source);
  const claudeBody = claudeReqs[0];
  const userMsg: string = claudeBody.messages[0].content;
  check("MEASURED has aggregates", userMsg.includes("goodReps: 42"));
  check(
    "no fabricated imu/camera in MEASURED",
    !userMsg.includes("swingSpeed:") && !userMsg.includes("elbowGap:"),
  );
  check(
    "guardrail forbids unmeasured topics",
    String(claudeBody.system).includes("may NOT claim"),
  );
  check("history lines present", userMsg.includes("RECENT SESSIONS"));
  check(
    "linkup fallback maps commonFault via cue library (no classifiable fault)",
    String(linkupReqs[0].q).includes("contact point timing"),
    linkupReqs[0].q,
  );
}

// ---- C: Linkup 5xx → analysis still done, drills [] --------------------
console.log("C: Linkup down");
globalThis.fetch = (async (url: any, init: any) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    return new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: '{"summary":"s","faultDetail":"f","focusAdvice":"a"}',
          },
        ],
      }),
      { status: 200 },
    );
  }
  if (u.includes("api.linkup.so")) return new Response("boom", { status: 503 });
  return realFetch(url, init);
}) as any;
{
  const s = await mkSession();
  await analyzeSession(s.id);
  const r = await getRow(s.id);
  check("status done despite linkup 503", r.analysisStatus === "done", r.analysisStatus);
  check("drills empty", JSON.parse(r.drills!).length === 0);
}

// ---- D: Claude garbage → failed, never pending -------------------------
console.log("D: Claude garbage output");
globalThis.fetch = (async (url: any) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: "sorry, not JSON" }] }),
      { status: 200 },
    );
  }
  return new Response("{}", { status: 200 });
}) as any;
{
  const s = await mkSession();
  await analyzeSession(s.id);
  const r = await getRow(s.id);
  check("status failed", r.analysisStatus === "failed", r.analysisStatus);
  check("never pending", r.analysisStatus !== "pending");
}

// ---- E: raw features reach the prompt ----------------------------------
console.log("E: raw-file features");
await mkdir("./data/raw", { recursive: true });
// 30Hz-ish: t, ax, ay, az. Two clear swings above 2.5g, well separated.
const lines: string[] = [];
for (let i = 0; i < 120; i++) {
  const swing = i === 30 || i === 31 || i === 90;
  const mag = swing ? 3.4 : 1.0;
  lines.push(`${i * 33},${mag},0,0`);
}
const rawPath = "./data/raw/test-e.csv";
await writeFile(rawPath, lines.join("\n"));
claudeReqs = [];
globalThis.fetch = (async (url: any, init: any) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    claudeReqs.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        content: [
          { type: "text", text: '{"summary":"s","faultDetail":"f","focusAdvice":"a"}' },
        ],
      }),
      { status: 200 },
    );
  }
  return new Response(JSON.stringify({ results: [] }), { status: 200 });
}) as any;
{
  const s = await mkSession({ rawPath });
  await analyzeSession(s.id);
  const r = await getRow(s.id);
  const userMsg: string = claudeReqs[0].messages[0].content;
  check("status done", r.analysisStatus === "done", r.analysisStatus);
  check("raw sample count in prompt", userMsg.includes("120 samples"), userMsg.match(/raw sensor file.*/)?.[0]);
  check("2 swing peaks detected", userMsg.includes("~2 swing peaks"), userMsg.match(/raw sensor file.*/)?.[0]);
}

// ---- F: camera metrics (B9) lift the guardrail -------------------------
console.log("F: camera metrics lift guardrail");
claudeReqs = [];
linkupReqs = [];
globalThis.fetch = (async (url: any, init: any) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    claudeReqs.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        content: [
          { type: "text", text: '{"summary":"s","faultDetail":"f","focusAdvice":"a"}' },
        ],
      }),
      { status: 200 },
    );
  }
  if (u.includes("api.linkup.so")) {
    linkupReqs.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }
  return realFetch(url, init);
}) as any;
{
  // elbowGap 0.2 < 0.35 threshold -> elbowTucked classifiable ONLY because
  // camera metrics are present.
  const s = await mkSession({
    cameraMetrics: JSON.stringify({ elbowGap: 0.2, contactInFront: true }),
  });
  await analyzeSession(s.id);
  const r = await getRow(s.id);
  const body = claudeReqs[0];
  const userMsg: string = body.messages[0].content;
  check("status done", r.analysisStatus === "done", r.analysisStatus);
  check("MEASURED includes camera", userMsg.includes("elbowGap: 0.2"));
  check(
    "elbowTucked classified from camera",
    userMsg.includes("elbowTucked"),
    userMsg.match(/FAULTS[^\n]*\n[^\n]*/)?.[0],
  );
  check(
    "allowed topics include elbow position",
    String(body.system).includes("elbow position"),
  );
  check(
    "linkup query is the elbow drill query",
    String(linkupReqs[0].q).includes("elbow"),
    linkupReqs[0].q,
  );
  check(
    "imu topics still forbidden (no imu signals)",
    String(body.system).includes("may NOT claim") &&
      String(body.system).match(/may NOT claim[^.]*paddle face/) != null,
  );
}

globalThis.fetch = realFetch;
console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
