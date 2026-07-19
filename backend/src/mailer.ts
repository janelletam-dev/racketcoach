const EMAIL_FROM = process.env.EMAIL_FROM ?? "RacketCoach <onboarding@resend.dev>";

/** Send a magic sign-in link. No Resend key in dev -> log it to the console. */
export async function sendMagicLink(email: string, url: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n[RacketCoach] magic sign-in link for ${email}:\n${url}\n`);
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
      to: email,
      subject: "Your RacketCoach sign-in link",
      html: `<p>Tap to sign in to RacketCoach.</p><p><a href="${url}">${url}</a></p>`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend error ${res.status}: ${await res.text()}`);
  }
}
