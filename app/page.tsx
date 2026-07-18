import { getCurrentUser } from "@/lib/session";
import { Wordmark, PixelLink } from "@/app/components/ui";

export default async function LandingPage() {
  const user = await getCurrentUser();

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="max-w-2xl w-full flex flex-col items-center gap-8">
        <h1 className="text-4xl sm:text-6xl">
          <Wordmark />
        </h1>

        <pre className="rc-term text-white/90 text-sm sm:text-base leading-tight select-none">
{`   ()__
   |  o|>   . . . . . . . .   ( o )
   |__|`}
        </pre>

        <p className="text-white text-lg sm:text-xl max-w-xl">
          RacketCoach is an AI table-tennis coach that lives on your paddle and
          tracks your form over time.
        </p>

        {user ? (
          <PixelLink href="/dashboard" variant="amber">
            Go to dashboard
          </PixelLink>
        ) : (
          <PixelLink href="/signin" variant="amber">
            Get started
          </PixelLink>
        )}

        <div className="rc-label mt-2">Table tennis, meet the arcade.</div>
      </div>
    </main>
  );
}
