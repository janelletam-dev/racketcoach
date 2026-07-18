import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import {
  users,
  accounts,
  authSessions,
  verificationTokens,
} from "@/lib/db/schema";

const EMAIL_FROM = process.env.EMAIL_FROM ?? "RacketCoach <onboarding@resend.dev>";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: authSessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  trustHost: true,
  pages: { signIn: "/signin" },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "re_dev_placeholder",
      from: EMAIL_FROM,
      // One place for both dev and prod: no key -> log the link, key -> send it.
      async sendVerificationRequest({ identifier, url }) {
        if (!process.env.RESEND_API_KEY) {
          console.log(
            `\n[RacketCoach] magic sign-in link for ${identifier}:\n${url}\n`,
          );
          return;
        }
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: identifier,
            subject: "Your RacketCoach sign-in link",
            html: `<p>Tap to sign in to RacketCoach.</p><p><a href="${url}">${url}</a></p>`,
          }),
        });
        if (!res.ok) {
          throw new Error(`Resend error ${res.status}: ${await res.text()}`);
        }
      },
    }),
  ],
});
