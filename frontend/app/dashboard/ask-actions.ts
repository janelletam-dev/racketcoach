"use server";

import { getSessionToken } from "@/lib/session";
import { askCoach } from "@/lib/api";

export type AskState = {
  answer?: string;
  error?: string;
  // Echoed back so the input keeps the user's question after submit.
  question?: string;
};

/**
 * B11 "Ask your coach" submit. Server-side so the session token never reaches
 * the browser. Errors render honestly (A11) — no silent failures.
 */
export async function askCoachAction(
  _prev: AskState,
  formData: FormData,
): Promise<AskState> {
  const question = String(formData.get("question") ?? "").trim();
  if (!question) return { error: "Type a question first." };

  const token = await getSessionToken();
  if (!token) return { error: "Please sign in again.", question };

  const result = await askCoach(token, question);
  if (result.unavailable) {
    return { error: "The coach isn't taking questions yet.", question };
  }
  if (result.error) return { error: result.error, question };
  return { answer: result.answer, question };
}
