import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSession, getSessions } from "@/lib/api";
import { parseAnalysis, parseDrills } from "@/lib/analysis";
import { parseSignals, signalTiles } from "@/lib/signals";
import { goodRepRate, deltaVsPrevious, bestRate } from "@/lib/insights";
import { formatDateTime, formatDuration, formatShortDate } from "@/lib/format";
import { Header } from "@/app/components/header";
import {
  Card,
  SectionLabel,
  StatTile,
  ProgressRing,
  Badge,
} from "@/app/components/ui";
import { FormScoreChart } from "@/app/components/charts";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { token } = await requireUser();
  const { id } = await params;

  // The session itself + the full list (for the delta badge, "vs your best",
  // and the trend chart — all derived from data already in the list).
  const [s, sessions] = await Promise.all([
    getSession(token, id),
    getSessions(token),
  ]);
  if (!s) notFound();

  const rate = goodRepRate(s);
  const analysis = parseAnalysis(s.analysis);
  const drills = parseDrills(s.drills);
  const tiles = signalTiles(parseSignals(s.signals));

  const reviewing = s.analysisStatus === "pending";
  const hasAnalysis = Boolean(
    analysis &&
      (analysis.summary || analysis.faultDetail || analysis.focusAdvice),
  );

  // Trend context (oldest -> newest), with this session marked.
  const chrono = [...sessions].sort(
    (a, b) => +new Date(a.playedAt) - +new Date(b.playedAt),
  );
  const trend = chrono.map((x) => ({
    label: formatShortDate(x.playedAt),
    rate: Math.round(goodRepRate(x) * 100),
  }));
  const highlightIndex = chrono.findIndex((x) => x.id === s.id);

  const delta = deltaVsPrevious(sessions, s.id);
  const best = bestRate(sessions);
  const isBest = sessions.length > 0 && rate >= best;

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 py-10">
      <Header />

      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 rc-term text-lg text-rc-purple hover:text-rc-magenta transition-colors mb-5"
      >
        <span aria-hidden>&lsaquo;</span> Back to dashboard
      </Link>

      {/* Hero: good-rep ring + delta vs last session. */}
      <Card className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div>
            <SectionLabel>Session</SectionLabel>
            <div className="rc-term text-3xl text-rc-ink mt-1">
              {formatDateTime(s.playedAt)}
            </div>
            <div className="text-rc-muted mt-1">
              Duration {formatDuration(s.durationSeconds)}
            </div>
            <div className="mt-4">
              <DeltaBadge delta={delta} />
            </div>
          </div>
          <ProgressRing rate={rate} size={136} label="good reps" />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column: the numbers + what the sensors saw. */}
        <div className="space-y-6">
          <Card>
            <SectionLabel>The numbers</SectionLabel>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <StatTile label="Good reps" value={s.goodReps} />
              <StatTile label="Total reps" value={s.totalReps} />
              <StatTile label="Best streak" value={s.bestStreak} />
              <StatTile label="Common fault" value={s.commonFault || "none"} />
            </div>
          </Card>

          {tiles.length > 0 ? (
            <Card>
              <SectionLabel>What the sensors saw</SectionLabel>
              <div className="grid grid-cols-2 gap-3 mt-4">
                {tiles.map((t, i) => (
                  <StatTile key={i} label={t.label} value={t.value} sub={t.sub} />
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        {/* Right column: coach read (always renders) + drills + trend. */}
        <div className="space-y-6">
          <Card>
            <SectionLabel>Coach&apos;s read</SectionLabel>
            {reviewing ? (
              <p className="text-rc-muted mt-3">
                Coach is reviewing this session&hellip;
              </p>
            ) : hasAnalysis ? (
              <div className="mt-3 space-y-3">
                {analysis?.summary ? (
                  <p className="rc-term text-xl text-rc-ink">
                    {analysis.summary}
                  </p>
                ) : null}
                {analysis?.faultDetail ? (
                  <p className="text-rc-muted">{analysis.faultDetail}</p>
                ) : null}
                {analysis?.focusAdvice ? (
                  <p className="text-rc-ink">
                    <span className="rc-label">Focus on</span>{" "}
                    {analysis.focusAdvice}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-rc-muted mt-3">
                No analysis for this session. The coach reviews sessions
                uploaded from the paddle.
              </p>
            )}
          </Card>

          {drills.length > 0 ? (
            <Card>
              <SectionLabel>Recommended drills</SectionLabel>
              <ul className="mt-4 space-y-3">
                {drills.map((d, i) => (
                  <li
                    key={i}
                    className="pb-3 border-b border-dashed border-rc-line last:border-0"
                  >
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rc-term text-lg text-rc-purple hover:underline"
                    >
                      {d.title}
                    </a>
                    {d.why ? (
                      <p className="text-rc-muted text-sm mt-1">{d.why}</p>
                    ) : null}
                    {d.source ? (
                      <p className="rc-label !text-[0.72rem] mt-1">
                        Source: {d.source}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {trend.length > 0 ? (
            <Card>
              <div className="flex items-center justify-between gap-3">
                <SectionLabel>Your form trend</SectionLabel>
                {isBest ? (
                  <Badge tone="pink">Your best yet</Badge>
                ) : (
                  <span className="rc-term text-sm text-rc-muted">
                    Best {Math.round(best * 100)}%
                  </span>
                )}
              </div>
              <div className="mt-4">
                <FormScoreChart
                  data={trend}
                  highlightIndex={highlightIndex}
                  height={200}
                />
              </div>
              <p className="text-xs text-rc-muted mt-2">
                The magenta dot is this session.
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  );
}

/** Good-rep-rate change vs the previous session, as a labelled badge. */
function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <Badge tone="muted">First session</Badge>;
  const pts = Math.round(delta * 100);
  if (pts > 0) return <Badge tone="violet">{`▲ +${pts}% vs last session`}</Badge>;
  if (pts < 0) return <Badge tone="amber">{`▼ ${pts}% vs last session`}</Badge>;
  return <Badge tone="muted">{`→ Same as last session`}</Badge>;
}
