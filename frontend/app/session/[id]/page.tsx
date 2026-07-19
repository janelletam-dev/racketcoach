import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSession } from "@/lib/api";
import { parseAnalysis, parseDrills } from "@/lib/analysis";
import { goodRepRate, pct } from "@/lib/insights";
import { formatDateTime, formatDuration } from "@/lib/format";
import { Header } from "@/app/components/header";
import { Card, SectionLabel, StatTile } from "@/app/components/ui";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { token } = await requireUser();

  const { id } = await params;
  const s = await getSession(token, id);
  if (!s) notFound();

  const rate = goodRepRate(s);
  const analysis = parseAnalysis(s.analysis);
  const drills = parseDrills(s.drills);
  const reviewing = s.analysisStatus === "pending";

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-5 sm:px-8 py-10">
      <Header />

      <Card>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <SectionLabel>Session</SectionLabel>
            <div className="rc-term text-3xl text-rc-ink mt-1">
              {formatDateTime(s.playedAt)}
            </div>
          </div>
          <div className="rc-wordmark text-3xl sm:text-4xl !text-rc-purple [text-shadow:none]">
            {pct(rate)}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6">
          <StatTile label="Good reps" value={s.goodReps} />
          <StatTile label="Total reps" value={s.totalReps} />
          <StatTile label="Good-rep rate" value={pct(rate)} />
          <StatTile label="Best streak" value={s.bestStreak} />
          <StatTile label="Duration" value={formatDuration(s.durationSeconds)} />
          <StatTile label="Common fault" value={s.commonFault || "none"} />
        </div>
      </Card>

      {/* Coach's read — from Claude, once the analyzer has run. */}
      {reviewing ? (
        <Card className="mt-6">
          <SectionLabel>Coach&apos;s read</SectionLabel>
          <p className="text-rc-muted mt-3">Coach is reviewing this session&hellip;</p>
        </Card>
      ) : analysis ? (
        <Card className="mt-6">
          <SectionLabel>Coach&apos;s read</SectionLabel>
          {analysis.summary ? (
            <p className="rc-term text-xl text-rc-ink mt-3">{analysis.summary}</p>
          ) : null}
          {analysis.faultDetail ? (
            <p className="text-rc-muted mt-3">{analysis.faultDetail}</p>
          ) : null}
          {analysis.focusAdvice ? (
            <p className="text-rc-ink mt-3">
              <span className="rc-label">Focus on</span> {analysis.focusAdvice}
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* Recommended drills — from Linkup, each with its source cited. */}
      {drills.length > 0 ? (
        <Card className="mt-6">
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

      <div className="mt-6">
        <Link href="/dashboard" className="rc-label hover:text-rc-ink">
          &lsaquo; Back to dashboard
        </Link>
      </div>
    </main>
  );
}
