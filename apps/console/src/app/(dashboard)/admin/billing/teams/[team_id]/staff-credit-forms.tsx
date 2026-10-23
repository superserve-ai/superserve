"use client"

import { Alert, Button, Field, Input, Textarea } from "@superserve/ui"
import * as React from "react"

import type { StaffCredit } from "@/lib/admin/team-billing"

import type { PlanChangeActionResult } from "./actions"
import { grantStaffCreditAction } from "./actions"

const MAX_CREDIT_CENTS = 100_000_000

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

const CREDIT_FAILURES: Record<
  Exclude<PlanChangeActionResult["kind"], "saved">,
  string
> = {
  forbidden: "You do not have permission to grant credit.",
  not_found: "The team no longer exists.",
  conflict:
    "Stripe was not asked to grant this credit. The team may have no billing customer, its previous invoice may still be closing, or the credit needs operator review. Check the team before trying again.",
  invalid: "Enter an amount between $0.01 and $1,000,000.00 and a reason.",
  unavailable:
    "The outcome is unknown: Stripe may have granted the credit. Retry the same request; do not start a new one.",
  impersonating:
    "Billing changes are disabled while viewing another team. Stop viewing it first.",
}

export function parseDollarsToCents(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, fraction = ""] = trimmed.split(".")
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_CREDIT_CENTS
    ? cents
    : null
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
  // An unknown outcome may already have granted credit; the request is frozen
  // until it is retried as-is or deliberately abandoned.
  const unknown = result?.kind === "unavailable"

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

  function startOver() {
    setKey(crypto.randomUUID())
    setResult(null)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Credit amount (USD)" htmlFor="staff-credit-amount" required>
        <Input
          id="staff-credit-amount"
          inputMode="decimal"
          value={amount}
          disabled={unknown}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="250.00"
        />
      </Field>
      <Field label="Reason" htmlFor="staff-credit-reason" required>
        <Textarea
          id="staff-credit-reason"
          value={reason}
          maxLength={2000}
          disabled={unknown}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this team is receiving credit"
        />
      </Field>
      <p className="text-xs text-muted">
        Credit applies to usage only, never to plan fees, and does not expire.
      </p>
      {result && result.kind !== "saved" ? (
        <Alert variant="destructive">{CREDIT_FAILURES[result.kind]}</Alert>
      ) : null}
      {result?.kind === "saved" ? (
        <Alert variant="success">Credit granted.</Alert>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={pending || cents === null || !reason.trim()}
        >
          {unknown
            ? "Retry same request"
            : cents === null
              ? "Grant credit"
              : `Grant ${usd.format(cents / 100)}`}
        </Button>
        {unknown ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={startOver}
            disabled={pending}
          >
            Start a new request
          </Button>
        ) : null}
      </div>
      {unknown ? (
        <p className="text-xs text-muted">
          Start a new request only after confirming in Stripe that no credit was
          granted for this one.
        </p>
      ) : null}
    </form>
  )
}

export function ResumeStaffCreditButton({
  region,
  teamId,
  credit,
}: {
  region: string
  teamId: string
  credit: StaffCredit
}) {
  const [pending, setPending] = React.useState(false)
  const [result, setResult] = React.useState<PlanChangeActionResult | null>(
    null,
  )

  async function resume() {
    setPending(true)
    setResult(
      await grantStaffCreditAction({
        region,
        teamId,
        idempotencyKey: credit.idempotency_key,
        amountCents: credit.amount_cents,
        reason: credit.reason,
      }).catch(() => ({ kind: "unavailable" as const })),
    )
    setPending(false)
  }

  if (result?.kind === "saved") return <span className="text-xs">Issued</span>
  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={resume}
        disabled={pending}
      >
        Resume
      </Button>
      {result ? (
        <p className="text-xs text-destructive">
          {CREDIT_FAILURES[result.kind]}
        </p>
      ) : null}
    </div>
  )
}
