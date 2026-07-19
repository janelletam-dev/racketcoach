import { Card, SectionLabel } from "@/app/components/ui";

// Instant loading state for the dashboard while sessions stream in from the
// backend (Next streams this via Suspense, then swaps in the real content).
export default function Loading() {
  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 py-10">
      <Card className="text-center py-14">
        <SectionLabel>Loading your sessions</SectionLabel>
        <p className="text-rc-muted mt-3">One moment.</p>
      </Card>
    </main>
  );
}
