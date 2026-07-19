"use server";

import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/session";
import { setSport } from "@/lib/api";

const COMING_SOON = new Set(["tennis", "badminton", "padel"]);
const VALID = new Set(["table_tennis", "tennis", "badminton", "padel"]);

// One server action for the whole onboarding page: picking table tennis, tapping
// a "coming soon" sport (stores interest), and Skip all route through here.
export async function chooseSport(formData: FormData) {
  const raw = String(formData.get("sport") ?? "table_tennis");
  const sport = VALID.has(raw) ? raw : "table_tennis";

  const token = await getSessionToken();
  if (token) await setSport(token, sport);

  // A "coming soon" pick still lands in table tennis (what actually works today),
  // with a friendly note. Active pick / skip go straight to the dashboard.
  redirect(
    COMING_SOON.has(sport) ? `/dashboard?welcome=${sport}` : "/dashboard",
  );
}
