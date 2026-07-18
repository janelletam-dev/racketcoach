import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import { Wordmark, Card, PixelAnchor } from "@/app/components/ui";

export default async function SignInPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  const isDev = process.env.NODE_ENV !== "production";

  async function sendMagicLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return;
    await signIn("resend", { email, redirectTo: "/dashboard" });
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md flex flex-col items-center gap-8">
        <Link href="/" className="text-3xl sm:text-4xl">
          <Wordmark />
        </Link>

        <Card className="w-full">
          <div className="rc-label mb-2">Sign in</div>
          <p className="text-rc-muted text-sm mb-5">
            Enter your email and we will send you a one-tap sign-in link.
          </p>

          <form action={sendMagicLink} className="flex flex-col gap-3">
            <input
              type="email"
              name="email"
              required
              placeholder="you@email.com"
              className="rc-term text-lg text-rc-ink bg-white border-2 border-rc-line rounded-xl px-4 py-2.5 outline-none focus:border-rc-indigo"
            />
            <button type="submit" className="rc-btn w-full">
              Send sign-in link
            </button>
          </form>

          {isDev ? (
            <div className="mt-6 pt-5 border-t-2 border-dashed border-rc-line">
              <div className="rc-label !text-[0.8rem] mb-2">Dev shortcut</div>
              <PixelAnchor href="/api/dev-login" variant="amber">
                Sign in as demo user
              </PixelAnchor>
              <p className="text-rc-muted text-xs mt-2">
                In development the magic link is printed to the server console,
                so no email service is needed.
              </p>
            </div>
          ) : null}
        </Card>

        <Link href="/" className="rc-label hover:text-white">
          Back to home
        </Link>
      </div>
    </main>
  );
}
