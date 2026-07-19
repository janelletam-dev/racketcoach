import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/session";
import { getMe, getMyPairing, claimPairing } from "@/lib/api";
import { Header } from "@/app/components/header";
import { Card, SectionLabel, PixelLink, Badge } from "@/app/components/ui";
import { Qr } from "@/app/components/qr";

export default async function PairPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const token = await getSessionToken();
  if (!token) redirect("/signin");
  const user = await getMe(token);
  if (!user) redirect("/signin");

  const { code: incoming } = await searchParams;

  let activeCode: string | null;
  let justLinked = false;

  if (incoming) {
    // Claim the scanned code for this user (backend creates it if needed).
    activeCode = await claimPairing(token, incoming);
    justLinked = true;
  } else {
    // Show the user's existing code, or the backend mints one.
    activeCode = await getMyPairing(token);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const qrValue = activeCode ? `${appUrl}/pair?code=${activeCode}` : appUrl;

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-5 sm:px-8 py-10">
      <Header />

      <Card className="text-center">
        {justLinked ? (
          <div className="mb-4">
            <Badge tone="amber">Paddle linked</Badge>
          </div>
        ) : (
          <SectionLabel>Connect a paddle</SectionLabel>
        )}

        <div className="rc-wordmark text-4xl sm:text-5xl !text-rc-indigo [text-shadow:2px_2px_0_#c7d2fe] tracking-widest my-5">
          {activeCode ?? "------"}
        </div>

        <div className="flex justify-center my-6">
          <Qr value={qrValue} />
        </div>

        <p className="text-rc-muted text-sm max-w-md mx-auto">
          {justLinked
            ? "This paddle is now linked to your account. Sessions from the coach station will show up on your dashboard."
            : "On the coach station, scan this code from your phone to link the paddle. The station can also send sessions using this code."}
        </p>

        <div className="mt-7 pt-5 border-t-2 border-dashed border-rc-line">
          <PixelLink href="/dashboard" variant="indigo">
            Go to dashboard
          </PixelLink>
        </div>
      </Card>
    </main>
  );
}
