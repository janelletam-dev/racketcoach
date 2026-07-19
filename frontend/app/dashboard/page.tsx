import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSessions } from "@/lib/api";
import { parseAnalysis } from "@/lib/analysis";
import {
  goodRepRate,
  pct,
  improvementLine,
  currentGoal,
  faultBreakdown,
} from "@/lib/insights";
import { formatShortDate, formatDate } from "@/lib/format";
import { Header } from "@/app/components/header";
import { Card, SectionLabel, PixelLink } from "@/app/components/ui";
import {
  FormScoreChart,
  StreakChart,
  FaultChart,
} from "@/app/components/charts";

const COMING_SOON_LABEL: Record<string, string> = {
  tennis: "Tennis",
  badminton: "Badminton",
  padel: "Padel",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { token } = await requireUser();
  // B10 onboarding gate is intentionally OFF until the backend adds a `sport`
  // column AND returns it in /api/auth/me. Until then the gate can't fire
  // correctly, and a redirect here (combined with a streaming loading.tsx) risks
  // a stuck-loading dashboard. Re-enable once the backend lands:
  //   const { user } = await requireUser();
  //   if (user.sport === null) redirect("/onboarding");

  const { welcome } = await searchParams;
  const welcomeName = welcome ? COMING_SOON_LABEL[welcome] : undefined;
  const welcomeNote = welcomeName ? (
    <div className="rc-card p-4 mb-6 text-rc-ink">
      {welcomeName} coaching is on the way. You are set up with table tennis for
      now.
    </div>
  ) : null;

  const sessions = await getSessions(token);

  if (sessions.length === 0) {
    return (
      <main className="flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 py-10">
        <Header />
        {welcomeNote}
        <Card className="text-center py-14">
          <SectionLabel>No sessions yet</SectionLabel>
          <p className="text-rc-muted mt-3 mb-6">
            Pair a paddle and your first practice session will land here.
          </p>
          <PixelLink href="/pair" variant="amber">
            Pair a paddle
          </PixelLink>
        </Card>
      </main>
    );
  }

  const chrono = [...sessions].reverse();
  const formSeries = chrono.map((s) => ({
    label: formatShortDate(s.playedAt),
    rate: Math.round(goodRepRate(s) * 100),
  }));
  const streakSeries = chrono.map((s) => ({
    label: formatShortDate(s.playedAt),
    streak: s.bestStreak,
  }));
  const faults = faultBreakdown(sessions);
  const latest = sessions[0];
  // Prefer the coach's own summary of the latest session when it exists.
  const coachSummary = parseAnalysis(latest.analysis)?.summary;

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 py-10">
      <Header />
      {welcomeNote}

      <div className="rc-card p-5 sm:p-6 mb-6 flex items-start gap-4">
        <span className="text-2xl" aria-hidden>
          🏓
        </span>
        <p className="rc-term text-2xl sm:text-3xl leading-tight text-rc-ink">
          {coachSummary ?? improvementLine(sessions)}
        </p>
      </div>

      <Card className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div>
            <SectionLabel>Continue</SectionLabel>
            <div className="rc-term text-xl text-rc-ink mt-1">
              Last session {formatDate(latest.playedAt)}
            </div>
            <div className="text-rc-muted mt-1">
              {pct(goodRepRate(latest))} good reps, best streak{" "}
              {latest.bestStreak}. Goal: {currentGoal(sessions)}
            </div>
          </div>
          <div className="shrink-0">
            <PixelLink href={`/session/${latest.id}`} variant="amber">
              Resume last session
            </PixelLink>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card>
          <SectionLabel>Form score over time</SectionLabel>
          <div className="mt-4">
            <FormScoreChart data={formSeries} />
          </div>
        </Card>
        <Card>
          <SectionLabel>Best streak over time</SectionLabel>
          <div className="mt-4">
            <StreakChart data={streakSeries} />
          </div>
        </Card>
      </div>

      <Card className="mb-6">
        <SectionLabel>Common faults</SectionLabel>
        <div className="mt-4">
          <FaultChart data={faults} />
        </div>
      </Card>

      <Card>
        <SectionLabel>Sessions</SectionLabel>
        <div className="mt-4">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1.4fr_auto] gap-3 rc-label !text-[0.78rem] pb-2 rc-divider">
            <div>Date</div>
            <div>Good-rep rate</div>
            <div>Best streak</div>
            <div>Common fault</div>
            <div />
          </div>
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/session/${s.id}`}
              className="grid grid-cols-[1.4fr_1fr_1fr_1.4fr_auto] gap-3 items-center py-3 border-b border-dashed border-rc-line last:border-0 hover:bg-rc-rowhover rounded-lg px-2 -mx-2 transition-colors"
            >
              <div className="rc-term text-lg text-rc-ink">
                {formatDate(s.playedAt)}
              </div>
              <div className="rc-term text-lg text-rc-purple">
                {pct(goodRepRate(s))}
              </div>
              <div className="rc-term text-lg text-rc-magenta">
                {s.bestStreak}
              </div>
              <div className="text-rc-ink truncate">
                {s.commonFault || "none"}
              </div>
              <div className="text-rc-muted rc-term">›</div>
            </Link>
          ))}
        </div>
      </Card>
    </main>
  );
}
