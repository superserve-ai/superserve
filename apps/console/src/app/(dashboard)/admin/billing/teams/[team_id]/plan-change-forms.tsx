"use client"

import { Alert, Button, Field, Input, Textarea } from "@superserve/ui"
import * as React from "react"

import type { PlanChangeActionResult } from "./actions"
import {
  cancelPlanChangeAction,
  grantStaffCreditAction,
  schedulePlanChangeAction,
} from "./actions"

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
  impersonating:
    "Billing changes are disabled while viewing another team. Stop viewing it first.",
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
  nextAnniversary,
}: {
  region: string
  teamId: string
  options: PlanOption[]
  nextAnniversary: string
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
          onChange={(e) => {
            setReason(e.target.value)
            setKey(crypto.randomUUID())
          }}
          placeholder="Why this team is changing plans"
        />
      </Field>
      <p className="text-xs text-muted">
        The change takes effect at the team's next billing anniversary (
        {nextAnniversary}). An annual plan ends at the end of its paid year, and
        a new annual fee starts on the next yearly anniversary of the team's
        billing. Nothing is refunded or prorated.
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

export function parseDollarsToCents(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, fraction = ""] = trimmed.split(".")
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

export function StaffCreditForm({
  region,
  teamId,
}: {
  region: string
  teamId: string
}) {
  const [amount, setAmount] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [key, setKey] = React.useState(() => crypto.randomUUID())
  const [pending, setPending] = React.useState(false)
  const [result, setResult] = React.useState<PlanChangeActionResult | null>(
    null,
  )
  const cents = parseDollarsToCents(amount)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (cents === null) return
    setPending(true)
    const outcome: PlanChangeActionResult = await grantStaffCreditAction({
      region,
      teamId,
      idempotencyKey: key,
      amountCents: cents,
      reason,
    }).catch(() => ({ kind: "unavailable" as const }))
    setPending(false)
    setResult(outcome)
    if (outcome.kind === "saved") {
      setKey(crypto.randomUUID())
      setAmount("")
      setReason("")
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Credit amount (USD)" htmlFor="staff-credit-amount" required>
        <Input
          id="staff-credit-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            setKey(crypto.randomUUID())
          }}
          placeholder="250.00"
        />
      </Field>
      <Field label="Reason" htmlFor="staff-credit-reason" required>
        <Textarea
          id="staff-credit-reason"
          value={reason}
          maxLength={2000}
          onChange={(e) => {
            setReason(e.target.value)
            setKey(crypto.randomUUID())
          }}
          placeholder="Why this team is receiving credit"
        />
      </Field>
      <p className="text-xs text-muted">
        Credit applies to usage only, never to plan fees, and does not expire.
      </p>
      {result && result.kind !== "saved" ? (
        <Alert variant="destructive">{FAILURES[result.kind]}</Alert>
      ) : null}
      {result?.kind === "saved" ? (
        <Alert variant="success">Credit granted.</Alert>
      ) : null}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending || cents === null || !reason.trim()}
      >
        {result?.kind === "unavailable" ? "Retry" : "Grant credit"}
      </Button>
    </form>
  )
}
