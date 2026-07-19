import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { chooseSport } from "./actions";
import { Header } from "@/app/components/header";
import { Card, SectionLabel } from "@/app/components/ui";

const COMING_SOON = [
  { id: "tennis", label: "Tennis" },
  { id: "badminton", label: "Badminton" },
  { id: "padel", label: "Padel" },
];

export default async function OnboardingPage() {
  const { user } = await requireUser();
  // Only an un-onboarded user sees this. sport === null means the backend has the
  // column and no choice has been made; undefined (column not deployed) or an
  // already-set value both skip to the dashboard, so it is never re-shown.
  if (user.sport !== null) redirect("/dashboard");

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-5 sm:px-8 py-10">
      <Header />
      <Card>
        <SectionLabel>What sport do you want to improve?</SectionLabel>
        <p className="text-rc-muted mt-2 mb-6">
          Table tennis is ready today. The others are on the way. Tap one to
          register your interest, and you will start with table tennis for now.
        </p>

        <form action={chooseSport}>
          <input type="hidden" name="sport" value="table_tennis" />
          <button
            type="submit"
            className="rc-btn rc-btn-amber w-full flex items-center justify-between"
          >
            <span>Table tennis</span>
            <span className="rc-label">Ready</span>
          </button>
        </form>

        <div className="grid gap-3 mt-3">
          {COMING_SOON.map((s) => (
            <form action={chooseSport} key={s.id}>
              <input type="hidden" name="sport" value={s.id} />
              <button
                type="submit"
                className="rc-btn rc-btn-ghost w-full flex items-center justify-between"
              >
                <span>{s.label}</span>
                <span className="rc-label">Coming soon</span>
              </button>
            </form>
          ))}
        </div>

        <div className="mt-6 pt-5 border-t-2 border-dashed border-rc-line text-center">
          <form action={chooseSport}>
            <input type="hidden" name="sport" value="table_tennis" />
            <button type="submit" className="rc-label hover:text-rc-ink">
              Skip for now
            </button>
          </form>
        </div>
      </Card>
    </main>
  );
}
