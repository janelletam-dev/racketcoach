import Link from "next/link";
import { signOut } from "@/auth";
import { Wordmark, PixelLink } from "./ui";

export function Header() {
  return (
    <header className="w-full flex items-center justify-between gap-4 mb-8 flex-wrap">
      <Link href="/dashboard" className="text-xl sm:text-2xl">
        <Wordmark />
      </Link>
      <div className="flex items-center gap-3">
        <PixelLink href="/pair" variant="ghost">
          Pair paddle
        </PixelLink>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button type="submit" className="rc-btn rc-btn-ghost">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
