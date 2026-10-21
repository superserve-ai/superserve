import Link from "next/link"

import { journeyMessages, type JourneyState } from "@/lib/yc/journey-state"

export function StatusPanel({
  state,
  readyAction,
}: {
  state: JourneyState
  readyAction?: () => Promise<void>
}) {
  const message = journeyMessages[state] ?? journeyMessages.unavailable
  return (
    <section
      className="space-y-4 border border-dashed border-border p-6"
      aria-live="polite"
    >
      <h1 className="text-2xl font-semibold">{message.title}</h1>
      <p>{message.description}</p>
      {state === "funding_ready" && readyAction && (
        <form action={readyAction}>
          <button className="underline">Open Console</button>
        </form>
      )}
      {state === "rejected" && (
        <Link className="underline" href="/onboarding/plan">
          Choose a standard plan
        </Link>
      )}
      {(state === "payment_needed" || state === "exhausted") && (
        <p>Open your team’s billing settings to review payment and usage.</p>
      )}
      {state === "mismatch" && (
        <Link className="underline" href="/auth/signin?next=%2Fyc%2Fclaim">
          Use your founder email
        </Link>
      )}
    </section>
  )
}
