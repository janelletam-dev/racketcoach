import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionToken } from "@/lib/session";
import { getMe, getSession } from "@/lib/api";
import { goodRepRate, pct } from "@/lib/insights";
import { formatDate } from "@/lib/format";
import { Header } from "@/app/components/header";
import { Card, SectionLabel, StatTile } from "@/app/components/ui";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const token = await getSessionToken();
  if (!token) redirect("/signin");
  const user = await getMe(token);
  if (!user) redirect("/signin");

  const { id } = await params;
  const s = await getSession(token, id);
  if (!s) notFound();

  const rate = goodRepRate(s);

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-5 sm:px-8 py-10">
      <Header />

      <Card>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <SectionLabel>Session</SectionLabel>
            <div className="rc-term text-3xl text-rc-ink mt-1">
              {formatDate(s.playedAt)}
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
          <StatTile
            label="Avg speed"
            value={s.avgSpeed ?? "-"}
            sub="per hardware"
          />
          <StatTile label="Common fault" value={s.commonFault || "none"} />
        </div>

        <div className="mt-6 pt-5 border-t-2 border-dashed border-rc-line">
          <Link href="/dashboard" className="rc-label hover:text-rc-ink">
            ‹ Back to dashboard
          </Link>
        </div>
      </Card>
    </main>
  );
}
