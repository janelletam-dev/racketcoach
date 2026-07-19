"use client";

import { useActionState, useState } from "react";
import { askCoachAction, type AskState } from "./ask-actions";
import { Card, SectionLabel } from "@/app/components/ui";

const INITIAL: AskState = {};

/**
 * B11 "Ask your coach" card. Feature-detected upstream (the page only renders
 * this when POST /api/coach/ask is live), so it never shows a dead input.
 */
export function AskCoach() {
  const [state, formAction, pending] = useActionState(askCoachAction, INITIAL);
  const [question, setQuestion] = useState("");

  return (
    <Card>
      <SectionLabel>Ask your coach</SectionLabel>
      <p className="text-rc-muted mt-2 mb-4">
        Ask about your play. The coach answers only from what your sessions
        actually measured.
      </p>

      <form action={formAction} className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          name="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Why do I keep hitting late?"
          disabled={pending}
          className="rc-term text-lg text-rc-ink bg-white border-2 border-rc-line rounded-xl px-4 py-2.5 outline-none focus:border-rc-indigo flex-1 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          className="rc-btn rc-btn-amber shrink-0 disabled:opacity-60"
        >
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>

      {pending ? (
        <p className="rc-term text-rc-muted mt-4">Coach is thinking&hellip;</p>
      ) : state.error ? (
        <p className="text-rc-magenta mt-4">{state.error}</p>
      ) : state.answer ? (
        <div className="rc-tile mt-4 p-4 sm:p-5">
          <p className="text-rc-ink whitespace-pre-wrap leading-relaxed">
            {state.answer}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
