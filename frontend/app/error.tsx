"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { Card, SectionLabel } from "@/app/components/ui";

// App-level error boundary. Catches thrown errors from server components (e.g. a
// backend outage in lib/api.ts) and shows an honest error state instead of a
// misleading empty one. Next 16: the recovery prop is `unstable_retry`.
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 py-10">
      <Card className="text-center py-14">
        <SectionLabel>Something went wrong</SectionLabel>
        <p className="text-rc-muted mt-3 mb-6">
          We hit a problem loading this. It is on our end, not you. Try again in
          a moment.
        </p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="rc-btn rc-btn-amber"
        >
          Try again
        </button>
      </Card>
    </main>
  );
}
