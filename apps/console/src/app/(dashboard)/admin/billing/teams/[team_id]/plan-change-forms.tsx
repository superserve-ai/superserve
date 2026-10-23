"use client"

import { Alert, Button, Field, Textarea } from "@superserve/ui"
import * as React from "react"

import type { PlanChangeActionResult } from "./actions"
import { cancelPlanChangeAction, schedulePlanChangeAction } from "./actions"

const FAILURES: Record<
  Exclude<PlanChangeActionResult["kind"], "saved">,
  string
> = {
  forbidden: "You do not have permission to change billing.",
  not_found: "The team or plan change no longer exists.",
  conflict:
    "The team's billing state does not allow this change. Reload to see the current state.",
  invalid: "Check the plan and reason and try again.",
  unavailable: "Billing is unavailable. Retry to send the same request.",
}

export interface PlanOption {
  offerKey: string
  label: string
  description: string
}

export function SchedulePlanChangeForm({
  region,
  teamId,
  options,
}: {
  region: string
  teamId: string
  options: PlanOption[]
}) {
  const [target, setTarget] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [key, setKey] = React.useState(() => crypto.randomUUID())
  const [pending, setPending] = React.useState(false)
  const [result, setResult] = React.useState<PlanChangeActionResult | null>(
    null,
  )

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    const outcome: PlanChangeActionResult = await schedulePlanChangeAction({
      region,
      teamId,
      idempotencyKey: key,
      targetOffer: target,
      reason,
    }).catch(() => ({ kind: "unavailable" as const }))
    setPending(false)
    setResult(outcome)
    if (outcome.kind === "saved") {
      setKey(crypto.randomUUID())
      setReason("")
      setTarget("")
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="New plan" htmlFor="plan-change-target" required>
        <select
          id="plan-change-target"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value)
            setKey(crypto.randomUUID())
          }}
          className="flex h-9 w-full border border-input bg-background px-3 text-sm text-foreground focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none"
        >
          <option value="" disabled>
            Choose a plan
          </option>
          {options.map((o) => (
            <option key={o.offerKey} value={o.offerKey}>
              {o.label} — {o.description}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason" htmlFor="plan-change-reason" required>
        <Textarea
          id="plan-change-reason"
          value={reason}
          maxLength={2000}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this team is changing plans"
        />
      </Field>
      <p className="text-xs text-muted">
        The change takes effect at the team's next billing anniversary (the end
        of the paid year for annual plans). Nothing is refunded or prorated.
      </p>
      {result && result.kind !== "saved" ? (
        <Alert variant="destructive">{FAILURES[result.kind]}</Alert>
      ) : null}
      {result?.kind === "saved" ? (
        <Alert variant="success">Plan change scheduled.</Alert>
      ) : null}
      <Button
        type="submit"
        size="sm"
        disabled={pending || !target || !reason.trim()}
      >
        {result?.kind === "unavailable" ? "Retry" : "Schedule change"}
      </Button>
    </form>
  )
}

export function CancelPlanChangeForm({
  region,
  teamId,
  changeId,
}: {
  region: string
  teamId: string
  changeId: string
}) {
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [result, setResult] = React.useState<PlanChangeActionResult | null>(
    null,
  )

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setResult(
      await cancelPlanChangeAction({ region, teamId, changeId, reason }).catch(
        () => ({ kind: "unavailable" as const }),
      ),
    )
    setPending(false)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Cancellation reason" htmlFor="plan-change-cancel" required>
        <Textarea
          id="plan-change-cancel"
          value={reason}
          maxLength={2000}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {result && result.kind !== "saved" ? (
        <Alert variant="destructive">{FAILURES[result.kind]}</Alert>
      ) : null}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending || !reason.trim() || result?.kind === "saved"}
      >
        Cancel scheduled change
      </Button>
    </form>
  )
}
