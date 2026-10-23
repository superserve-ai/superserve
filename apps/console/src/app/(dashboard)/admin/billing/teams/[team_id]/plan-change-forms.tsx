"use client"

import { Alert, Button, Field, Textarea } from "@superserve/ui"
import * as React from "react"

import type {
  ActionFailure,
  PlanChangeActionResult,
  PlanChangePreviewResult,
} from "./actions"
import {
  cancelPlanChangeAction,
  previewPlanChangeAction,
  schedulePlanChangeAction,
} from "./actions"
import { FailureNotice } from "./failure-notice"

const TIMING = new Map([
  [
    "next_anniversary",
    "Plan changes apply at the team's next billing anniversary.",
  ],
  ["end_of_paid_year", "The team's current paid year ends then."],
  [
    "annual_fee_starts_on_yearly_anniversary",
    "An annual fee starts only on a yearly anniversary of the team's billing.",
  ],
])

export function formatEffectiveDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

function PlanChangePreviewNotice({
  result,
  onRetry,
}: {
  result: PlanChangePreviewResult | "loading" | null
  onRetry: () => void
}) {
  if (result === null) return null
  if (result === "loading")
    return <p className="text-sm text-muted">Checking when this would apply…</p>
  if (result.kind !== "preview")
    return (
      <Alert variant="warning">
        <FailureNotice
          message="The effective date could not be checked."
          detail={result.detail}
        />
        {result.kind === "unavailable" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={onRetry}
          >
            Check again
          </Button>
        ) : null}
      </Alert>
    )
  if ("blocked" in result.preview)
    return (
      <Alert variant="destructive">
        This team cannot move to this plan: {result.preview.blocked}
      </Alert>
    )
  return (
    <Alert variant="default">
      <span className="block text-base font-medium text-foreground">
        Takes effect {formatEffectiveDate(result.preview.effective_at)}
      </span>
      <span className="text-sm text-muted">
        {TIMING.get(result.preview.timing) ??
          "Plan changes apply at a billing anniversary."}
      </span>
    </Alert>
  )
}

const FAILURES: Record<ActionFailure["kind"], string> = {
  forbidden: "You do not have permission to change billing.",
  not_found: "The team or plan change no longer exists.",
  conflict:
    "The team's billing state does not allow this change. Reload to see the current state.",
  invalid: "Check the plan and reason and try again.",
  unavailable: "Billing is unavailable. Retry to send the same request.",
  read_only_impersonation:
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
  const [preview, setPreview] = React.useState<
    PlanChangePreviewResult | "loading" | null
  >(null)
  const latest = React.useRef(0)

  async function choose(offer: string) {
    setTarget(offer)
    setKey(crypto.randomUUID())
    const request = ++latest.current
    setPreview("loading")
    const next: PlanChangePreviewResult = await previewPlanChangeAction({
      region,
      teamId,
      targetOffer: offer,
    }).catch(() => ({ kind: "unavailable" as const }))
    if (latest.current === request) setPreview(next)
  }

  const ready =
    preview !== null &&
    preview !== "loading" &&
    preview.kind === "preview" &&
    !("blocked" in preview.preview)

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
      setPreview(null)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="New plan" htmlFor="plan-change-target" required>
        <select
          id="plan-change-target"
          value={target}
          onChange={(e) => void choose(e.target.value)}
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
      <PlanChangePreviewNotice
        result={preview}
        onRetry={() => void choose(target)}
      />
      <p className="text-xs text-muted">
        Plan changes apply only at a billing anniversary. Nothing is refunded or
        prorated.
      </p>
      {result && result.kind !== "saved" ? (
        <Alert variant="destructive">
          <FailureNotice
            message={FAILURES[result.kind]}
            detail={result.detail}
          />
        </Alert>
      ) : null}
      {result?.kind === "saved" ? (
        <Alert variant="success">Plan change scheduled.</Alert>
      ) : null}
      <Button
        type="submit"
        size="sm"
        disabled={pending || !target || !ready || !reason.trim()}
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
        <Alert variant="destructive">
          <FailureNotice
            message={FAILURES[result.kind]}
            detail={result.detail}
          />
        </Alert>
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
