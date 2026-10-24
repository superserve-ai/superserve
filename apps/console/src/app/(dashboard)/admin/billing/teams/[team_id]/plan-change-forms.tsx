"use client"

import { Alert, Button, Field, Textarea } from "@superserve/ui"
import * as React from "react"

import {
  BILLING_REASON_LIMIT,
  withinBillingTextLimit,
} from "@/lib/admin/billing-text"
import type {
  CatalogPlan,
  PlanChangeTarget,
  PlanLimits,
} from "@/lib/admin/team-billing"

import { describeLimits, formatDay } from "../format"
import type { ActionFailure, PlanChangeActionResult } from "./actions"
import {
  assignTeamPlanAction,
  requestPlanChangeAction,
  undoPlanChangeAction,
} from "./actions"
import { FailureNotice } from "./failure-notice"

const FAILURES: Record<ActionFailure["kind"], string> = {
  forbidden: "You do not have permission to change billing.",
  not_found: "The team or plan change no longer exists.",
  conflict:
    "The team's plan does not allow this change. Reload to see the current state.",
  invalid: "Check the plan and reason and try again.",
  unavailable: "Billing is unavailable. Retry to send the same request.",
  read_only_impersonation:
    "Billing changes are disabled while viewing another team. Stop viewing it first.",
}

const selectClass =
  "flex h-9 w-full border border-input bg-background px-3 text-sm text-foreground focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none"

function Outcome({
  result,
  saved,
}: {
  result: PlanChangeActionResult | null
  saved: string
}) {
  if (result === null) return null
  if (result.kind === "saved") return <Alert variant="success">{saved}</Alert>
  return (
    <Alert variant="destructive">
      <FailureNotice message={FAILURES[result.kind]} detail={result.detail} />
    </Alert>
  )
}

function PlanReasonField({
  id,
  label = "Reason",
  value,
  disabled,
  onChange,
  placeholder,
}: {
  id: string
  label?: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
  placeholder?: string
}) {
  const error = withinBillingTextLimit(value, BILLING_REASON_LIMIT)
    ? undefined
    : "Use at most 2,000 characters."
  return (
    <Field label={label} htmlFor={id} required>
      <Textarea
        id={id}
        value={value}
        maxLength={BILLING_REASON_LIMIT * 2}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        error={error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </Field>
  )
}

function useWrite() {
  const [key, setKey] = React.useState(() => crypto.randomUUID())
  const [pending, setPending] = React.useState(false)
  const [result, setResult] = React.useState<PlanChangeActionResult | null>(
    null,
  )
  async function send(
    action: (key: string) => Promise<PlanChangeActionResult>,
  ) {
    setPending(true)
    const outcome = await action(key).catch(() => ({
      kind: "unavailable" as const,
    }))
    setPending(false)
    setResult(outcome)
    if (outcome.kind === "saved") setKey(crypto.randomUUID())
    return outcome
  }
  const unknown = result?.kind === "unavailable"
  return {
    pending,
    result,
    send,
    locked: pending || unknown,
    unknown,
    startOver: () => {
      setKey(crypto.randomUUID())
      setResult(null)
    },
  }
}

function SubmitRow({
  write,
  label,
  disabled,
  variant,
}: {
  write: ReturnType<typeof useWrite>
  label: string
  disabled: boolean
  variant?: "outline"
}) {
  return (
    <div className="flex gap-2">
      <Button
        type="submit"
        size="sm"
        variant={variant}
        disabled={write.pending || disabled}
      >
        {write.unknown ? "Retry same request" : label}
      </Button>
      {write.unknown ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={write.startOver}
          disabled={write.pending}
        >
          Start a new request
        </Button>
      ) : null}
    </div>
  )
}

export interface PlanChangeOption {
  target: PlanChangeTarget
  label: string
  timing: string
}

export function PlanChangeForm({
  region,
  teamId,
  options,
  freeLimits,
}: {
  region: string
  teamId: string
  options: PlanChangeOption[]
  freeLimits: Partial<PlanLimits> | null
}) {
  const [target, setTarget] = React.useState<PlanChangeTarget | "">("")
  const [reason, setReason] = React.useState("")
  const [saved, setSaved] = React.useState("Plan change requested.")
  const write = useWrite()
  const option = options.find((o) => o.target === target)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!target) return
    const outcome = await write.send((idempotencyKey) =>
      requestPlanChangeAction({
        region,
        teamId,
        idempotencyKey,
        targetPlan: target,
        reason,
      }),
    )
    if (outcome.kind === "saved") {
      setSaved(
        outcome.effectiveAt
          ? `Plan change requested. It takes effect ${formatDay(outcome.effectiveAt)}.`
          : "Plan change requested.",
      )
      setTarget("")
      setReason("")
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Move to" htmlFor="plan-change-target" required>
        <select
          id="plan-change-target"
          value={target}
          disabled={write.locked}
          onChange={(e) => {
            setTarget(e.target.value as PlanChangeTarget)
            write.startOver()
          }}
          className={selectClass}
        >
          <option value="" disabled>
            Choose a plan
          </option>
          {options.map((o) => (
            <option key={o.target} value={o.target}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <PlanReasonField
        id="plan-change-reason"
        value={reason}
        disabled={write.locked}
        onChange={(value) => {
          setReason(value)
          write.startOver()
        }}
        placeholder="Why this team is changing plans"
      />
      {target === "free" ? (
        <Alert variant="warning">
          <span className="block font-medium">
            All running compute will be paused, and these will be the team's new
            limits:
          </span>
          <span className="block">
            {freeLimits ? describeLimits(freeLimits) : "Free plan limits"}
          </span>
        </Alert>
      ) : null}
      <p className="text-xs text-muted">
        {option?.timing ??
          "Upgrades happen through checkout or a credit purchase."}
      </p>
      <Outcome result={write.result} saved={saved} />
      <SubmitRow
        write={write}
        label="Request change"
        disabled={
          !target ||
          !reason.trim() ||
          !withinBillingTextLimit(reason, BILLING_REASON_LIMIT)
        }
      />
    </form>
  )
}

export function UndoPlanChangeForm({
  region,
  teamId,
  changeId,
}: {
  region: string
  teamId: string
  changeId: string
}) {
  const [reason, setReason] = React.useState("")
  const write = useWrite()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await write.send(() =>
      undoPlanChangeAction({ region, teamId, changeId, reason }),
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <PlanReasonField
        id="plan-change-undo"
        label="Undo reason"
        value={reason}
        disabled={write.locked || write.result?.kind === "saved"}
        onChange={setReason}
      />
      <Outcome result={write.result} saved="Plan change undone." />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={
          write.pending ||
          !reason.trim() ||
          !withinBillingTextLimit(reason, BILLING_REASON_LIMIT) ||
          write.result?.kind === "saved"
        }
      >
        {write.unknown ? "Retry undo" : "Undo change"}
      </Button>
    </form>
  )
}

export function AssignPlanForm({
  region,
  teamId,
  plans,
}: {
  region: string
  teamId: string
  plans: CatalogPlan[]
}) {
  const [versionId, setVersionId] = React.useState("")
  const [reason, setReason] = React.useState("")
  const write = useWrite()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const outcome = await write.send((idempotencyKey) =>
      assignTeamPlanAction({
        region,
        teamId,
        idempotencyKey,
        versionId,
        reason,
      }),
    )
    if (outcome.kind === "saved") {
      setVersionId("")
      setReason("")
    }
  }

  if (plans.length === 0)
    return (
      <p className="text-sm text-muted">
        No custom plan without fees is published. Create one in the plan catalog
        first.
      </p>
    )

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Plan" htmlFor="plan-assign-version" required>
        <select
          id="plan-assign-version"
          value={versionId}
          disabled={write.locked}
          onChange={(e) => {
            setVersionId(e.target.value)
            write.startOver()
          }}
          className={selectClass}
        >
          <option value="" disabled>
            Choose a custom plan
          </option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name} v{p.version} — {describeLimits(p.limits)}
            </option>
          ))}
        </select>
      </Field>
      <PlanReasonField
        id="plan-assign-reason"
        value={reason}
        disabled={write.locked}
        onChange={(value) => {
          setReason(value)
          write.startOver()
        }}
        placeholder="For example, the signed Enterprise agreement"
      />
      <p className="text-xs text-muted">
        Applies immediately and replaces the team's current plan and limits.
      </p>
      <Outcome result={write.result} saved="Plan assigned." />
      <SubmitRow
        write={write}
        label="Assign plan"
        disabled={
          !versionId ||
          !reason.trim() ||
          !withinBillingTextLimit(reason, BILLING_REASON_LIMIT)
        }
      />
    </form>
  )
}
