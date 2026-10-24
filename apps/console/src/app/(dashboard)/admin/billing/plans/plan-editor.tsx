"use client"

import { Button, Field, Input, Textarea } from "@superserve/ui"
import { useEffect, useState, useTransition } from "react"

import type { PlanDraft, SchedulePreview } from "@/lib/admin/billing-catalog"
import {
  createDraftAction,
  previewScheduleAction,
  updateDraftAction,
  type FanOutResult,
} from "@/lib/admin/billing-catalog-actions"
import {
  formatUsdCents,
  type PlanGrant,
  type PlanKind,
  type PricingVersion,
} from "@/lib/billing/plans"

export function centsFromDollars(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null
  return Math.round(Number(value) * 100)
}

function wholeFrom(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value) : null
}

function dollars(cents: number | null): string {
  return cents === null ? "" : String(cents / 100)
}

function text(value: number | null): string {
  return value === null ? "" : String(value)
}

interface GrantForm {
  start: string
  repeat: string
  every: string
  amount: string
  expires: string
}

interface AllowanceForm {
  basis: "usage" | "compute"
  amount: string
  hours: string
  vcpu: string
  memory_gib: string
  period: "day_window" | "month"
  on_exhausted: "pause" | "payg"
}

interface DraftForm {
  pricing_version: PricingVersion
  family: string
  kind: PlanKind
  public: boolean
  display_name: string
  price_label: string
  tagline: string
  features: string
  sort_order: string
  display_only: boolean
  self_serve: boolean
  monthly_fee: string
  annual_fee: string
  grants: GrantForm[]
  matching: { percent: string; cap: string } | null
  allowance: AllowanceForm | null
  limits: Record<keyof PlanDraft["limits"], string>
}

const KINDS: [PlanKind, string][] = [
  ["subscription", "Subscription"],
  ["prepaid", "Prepaid credit"],
  ["free", "Free"],
  ["legacy_payg", "Legacy pay as you go"],
  ["custom", "Custom (staff assigned)"],
]

const LIMITS = [
  ["max_concurrent", "Running sandboxes"],
  ["max_vcpu", "vCPU per sandbox"],
  ["max_memory_mib", "Memory MiB"],
  ["max_disk_mib", "Disk MiB"],
  ["max_templates", "Templates"],
] as const

const NO_LIMITS: PlanDraft["limits"] = {
  max_concurrent: null,
  max_vcpu: null,
  max_memory_mib: null,
  max_disk_mib: null,
  max_templates: null,
}

const NEW_ALLOWANCE: AllowanceForm = {
  basis: "usage",
  amount: "",
  hours: "2",
  vcpu: "1",
  memory_gib: "1",
  period: "month",
  on_exhausted: "payg",
}

function formFrom(draft: PlanDraft): DraftForm {
  return {
    pricing_version: draft.pricing_version,
    family: draft.family,
    kind: draft.kind,
    public: draft.public,
    display_name: draft.display_name,
    price_label: draft.price_label,
    tagline: draft.tagline,
    features: draft.features.join("\n"),
    sort_order: String(draft.sort_order),
    display_only: draft.display_only,
    self_serve: draft.self_serve,
    monthly_fee: dollars(draft.monthly_fee_cents),
    annual_fee: dollars(draft.annual_fee_cents),
    grants: draft.credit_schedule.map((g) => ({
      start: String(g.start_months + 1),
      repeat: text(g.repeat),
      every: String(g.every_months),
      amount: dollars(g.amount_cents),
      expires: String(g.expires_after_months),
    })),
    matching: draft.matching
      ? {
          percent: String(draft.matching.matching_bps / 100),
          cap: dollars(draft.matching.cap_cents),
        }
      : null,
    allowance: draft.allowance
      ? {
          basis: draft.allowance.compute ? "compute" : "usage",
          amount: draft.allowance.compute
            ? ""
            : dollars(draft.allowance.amount_cents),
          hours: draft.allowance.compute
            ? String(draft.allowance.compute.seconds / 3600)
            : NEW_ALLOWANCE.hours,
          vcpu: String(draft.allowance.compute?.vcpu ?? NEW_ALLOWANCE.vcpu),
          memory_gib: String(
            draft.allowance.compute?.memory_gib ?? NEW_ALLOWANCE.memory_gib,
          ),
          period: draft.allowance.period,
          on_exhausted: draft.allowance.on_exhausted,
        }
      : null,
    limits: {
      max_concurrent: text(draft.limits.max_concurrent),
      max_vcpu: text(draft.limits.max_vcpu),
      max_memory_mib: text(draft.limits.max_memory_mib),
      max_disk_mib: text(draft.limits.max_disk_mib),
      max_templates: text(draft.limits.max_templates),
    },
  }
}

function allowanceFrom(form: AllowanceForm): PlanDraft["allowance"] | string {
  if (form.basis === "usage") {
    const cents = centsFromDollars(form.amount)
    if (!cents) return "The included usage needs a dollar amount."
    return {
      amount_cents: cents,
      period: form.period,
      on_exhausted: form.on_exhausted,
    }
  }
  const hours = /^\d+(\.\d+)?$/.test(form.hours.trim())
    ? Number(form.hours)
    : null
  const vcpu = wholeFrom(form.vcpu)
  const memory = wholeFrom(form.memory_gib)
  const seconds = hours === null ? 0 : Math.round(hours * 3600)
  if (!seconds || !vcpu || !memory)
    return "The compute allowance needs hours, whole vCPUs and whole GiB."
  return {
    amount_cents: 0,
    period: form.period,
    on_exhausted: form.on_exhausted,
    compute: { seconds, vcpu, memory_gib: memory },
  }
}

function scheduleFrom(grants: GrantForm[]): PlanGrant[] | string {
  const schedule: PlanGrant[] = []
  for (const [index, g] of grants.entries()) {
    const start = wholeFrom(g.start)
    const repeat = g.repeat.trim() === "" ? null : wholeFrom(g.repeat)
    const every = wholeFrom(g.every)
    const amount = centsFromDollars(g.amount)
    const expires = wholeFrom(g.expires)
    if (
      !start ||
      (g.repeat.trim() !== "" && !repeat) ||
      !every ||
      !amount ||
      !expires
    )
      return `Grant ${index + 1}: enter whole months, a whole repeat count (or leave it blank for ongoing) and a dollar amount.`
    schedule.push({
      start_months: start - 1,
      repeat,
      every_months: every,
      amount_cents: amount,
      expires_after_months: expires,
    })
  }
  return schedule
}

function draftFrom(form: DraftForm): PlanDraft | string {
  const optionalCents = (value: string, label: string) => {
    if (value.trim() === "") return null
    const cents = centsFromDollars(value)
    if (cents === null) throw new Error(`${label} must be a dollar amount`)
    return cents
  }
  const optionalWhole = (value: string, label: string) => {
    if (value.trim() === "") return null
    const n = wholeFrom(value)
    if (n === null) throw new Error(`${label} must be a whole number`)
    return n
  }
  try {
    const schedule = form.display_only ? [] : scheduleFrom(form.grants)
    if (typeof schedule === "string") return schedule
    let matching: PlanDraft["matching"] = null
    if (form.matching && !form.display_only) {
      const bps = /^\d+(\.\d{1,2})?$/.test(form.matching.percent.trim())
        ? Math.round(Number(form.matching.percent) * 100)
        : null
      const cap = centsFromDollars(form.matching.cap)
      if (!bps || bps > 10000 || !cap)
        return "Matching needs a percent between 0.01 and 100 and a dollar cap."
      matching = { matching_bps: bps, cap_cents: cap }
    }
    let allowance: PlanDraft["allowance"] = null
    if (form.allowance && !form.display_only) {
      const parsed = allowanceFrom(form.allowance)
      if (typeof parsed === "string") return parsed
      allowance = parsed
    }
    return {
      pricing_version: form.pricing_version,
      family: form.family.trim(),
      kind: form.kind,
      public: form.public,
      display_name: form.display_name.trim(),
      price_label: form.price_label.trim(),
      tagline: form.tagline.trim(),
      features: form.features
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      sort_order: optionalWhole(form.sort_order, "Card order") ?? 0,
      display_only: form.display_only,
      self_serve: form.self_serve && !form.display_only,
      monthly_fee_cents: form.display_only
        ? null
        : optionalCents(form.monthly_fee, "Monthly fee"),
      annual_fee_cents: form.display_only
        ? null
        : optionalCents(form.annual_fee, "Annual fee"),
      credit_schedule: schedule,
      matching,
      allowance,
      limits: form.display_only
        ? NO_LIMITS
        : (Object.fromEntries(
            LIMITS.map(([key, label]) => [
              key,
              optionalWhole(form.limits[key], label),
            ]),
          ) as PlanDraft["limits"]),
    }
  } catch (cause) {
    return cause instanceof Error ? cause.message : "Check the fields"
  }
}

function addMonths(anchor: string, months: number): string {
  const date = new Date(`${anchor}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ""
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate()
  date.setUTCDate(Math.min(day, last))
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

const NEW_GRANT: GrantForm = {
  start: "1",
  repeat: "",
  every: "1",
  amount: "1000",
  expires: "1",
}

function SchedulePreviewPanel({
  region,
  schedule,
}: {
  region: string
  schedule: PlanGrant[] | string
}) {
  const [anchor, setAnchor] = useState(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [preview, setPreview] = useState<SchedulePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = typeof schedule === "string" ? null : JSON.stringify(schedule)
  useEffect(() => {
    if (key === null) return
    let active = true
    const timer = window.setTimeout(() => {
      void previewScheduleAction(region, JSON.parse(key)).then((result) => {
        if (!active) return
        if (result.ok) {
          setPreview(result.value)
          setError(null)
        } else {
          setError(result.error)
        }
      })
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [region, key])
  const shownError = typeof schedule === "string" ? schedule : error
  return (
    <aside
      aria-label="Expanded credit schedule"
      className="space-y-3 border border-dashed border-border p-4"
    >
      <h3 className="font-mono text-xs text-muted uppercase">
        Expanded schedule
      </h3>
      <Field label="Example anchor" htmlFor="preview-anchor">
        <Input
          id="preview-anchor"
          type="date"
          value={anchor}
          onChange={(event) => setAnchor(event.target.value)}
        />
      </Field>
      {shownError ? (
        <p role="alert" className="text-sm text-destructive">
          {shownError}
        </p>
      ) : preview ? (
        <>
          <p className="text-sm">{preview.summary}</p>
          {preview.issues.length ? (
            <ol className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs tabular-nums">
              {preview.issues.map((issue, index) => (
                <li
                  key={`${issue.month_offset}-${index}`}
                  className="grid grid-cols-[6rem_1fr_1fr] gap-2"
                >
                  <span>Month {issue.month_offset + 1}</span>
                  <span>{formatUsdCents(issue.amount_cents)} grant</span>
                  <span className="text-muted">
                    expires{" "}
                    {addMonths(
                      anchor,
                      issue.month_offset + issue.expires_after_months,
                    )}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No grants.</p>
          )}
          <p className="text-xs text-muted">
            Ongoing grants are shown for the first {preview.months} months.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">Loading…</p>
      )}
    </aside>
  )
}

export function PlanEditor({
  previewRegion,
  initial,
  versionId,
  busy,
  onCancel,
  onSaved,
}: {
  previewRegion: string
  initial: PlanDraft
  versionId?: string
  busy: boolean
  onCancel: () => void
  onSaved: (result: FanOutResult) => void
}) {
  const [form, setForm] = useState(() => formFrom(initial))
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  const set = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))
  const setGrant = (index: number, grant: Partial<GrantForm>) =>
    set(
      "grants",
      form.grants.map((g, i) => (i === index ? { ...g, ...grant } : g)),
    )
  const schedule = form.display_only ? [] : scheduleFrom(form.grants)

  return (
    <section
      aria-label={versionId ? "Edit draft" : "New draft"}
      className="grid gap-6 border border-dashed border-brand p-4 lg:grid-cols-[1fr_22rem]"
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          const draft = draftFrom(form)
          if (typeof draft === "string") {
            setError(draft)
            return
          }
          if (!reason.trim()) {
            setError(
              "Give a reason for this change; it is recorded in the catalog audit.",
            )
            return
          }
          startSaving(async () => {
            const result = versionId
              ? await updateDraftAction(versionId, draft, reason.trim())
              : await createDraftAction(draft, reason.trim())
            const failed = Object.entries(result.errors)
            setError(
              failed.length
                ? failed.map(([region, e]) => `${region}: ${e}`).join("; ")
                : null,
            )
            onSaved(result)
          })
        }}
      >
        <h2 className="text-lg font-medium">
          {versionId
            ? `Edit ${form.family} draft`
            : initial.family
              ? `New ${initial.family} version`
              : "New plan"}
        </h2>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Pricing model" htmlFor="plan-pricing">
            <select
              id="plan-pricing"
              className="block w-full border border-dashed border-border bg-transparent p-2 text-sm"
              value={form.pricing_version}
              disabled={initial.family !== ""}
              onChange={(event) =>
                set("pricing_version", event.target.value as PricingVersion)
              }
            >
              <option value="legacy">Legacy</option>
              <option value="v2">v2</option>
            </select>
          </Field>
          <Field label="Kind" htmlFor="plan-kind">
            <select
              id="plan-kind"
              className="block w-full border border-dashed border-border bg-transparent p-2 text-sm"
              value={form.kind}
              onChange={(event) => set("kind", event.target.value as PlanKind)}
            >
              {KINDS.map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price label" htmlFor="plan-price-label">
            <Input
              id="plan-price-label"
              placeholder="$250/month"
              value={form.price_label}
              onChange={(event) => set("price_label", event.target.value)}
            />
          </Field>
          <Field label="Family" htmlFor="plan-family">
            <Input
              id="plan-family"
              value={form.family}
              disabled={initial.family !== ""}
              onChange={(event) =>
                set("family", event.target.value.toLowerCase())
              }
            />
          </Field>
          <Field label="Display name" htmlFor="plan-name">
            <Input
              id="plan-name"
              value={form.display_name}
              onChange={(event) => set("display_name", event.target.value)}
            />
          </Field>
          <Field label="Card order" htmlFor="plan-order">
            <Input
              id="plan-order"
              inputMode="numeric"
              value={form.sort_order}
              onChange={(event) => set("sort_order", event.target.value)}
            />
          </Field>
        </div>
        <Field label="Tagline" htmlFor="plan-tagline">
          <Input
            id="plan-tagline"
            value={form.tagline}
            onChange={(event) => set("tagline", event.target.value)}
          />
        </Field>
        <Field
          label="Feature bullets"
          htmlFor="plan-features"
          description="One per line"
        >
          <Textarea
            id="plan-features"
            rows={3}
            value={form.features}
            onChange={(event) => set("features", event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-brand"
              checked={form.public}
              onChange={(event) => set("public", event.target.checked)}
            />
            Show on public plan cards (leave off for customer-specific deals)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-brand"
              checked={form.display_only}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  display_only: event.target.checked,
                  kind: event.target.checked ? "custom" : current.kind,
                }))
              }
            />
            Display only (Custom pricing, contact sales)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-brand"
              disabled={form.display_only}
              checked={form.self_serve && !form.display_only}
              onChange={(event) => set("self_serve", event.target.checked)}
            />
            Sold through self-serve checkout
          </label>
        </div>
        {form.display_only ? null : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Monthly fee (USD)" htmlFor="plan-monthly">
                <Input
                  id="plan-monthly"
                  inputMode="decimal"
                  value={form.monthly_fee}
                  onChange={(event) => set("monthly_fee", event.target.value)}
                />
              </Field>
              <Field label="Annual fee (USD)" htmlFor="plan-annual">
                <Input
                  id="plan-annual"
                  inputMode="decimal"
                  value={form.annual_fee}
                  onChange={(event) => set("annual_fee", event.target.value)}
                />
              </Field>
            </div>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Credit schedule</legend>
              <p className="text-xs text-muted">
                Leave both fees empty for a staff-assigned arrangement of
                credits and/or matching with no subscription fee (use a family
                such as custom_example). Self-serve checkout sells only public
                subscription plans with a fee, one ongoing monthly grant
                expiring after a month, and no matching rule.
              </p>
              {form.grants.map((grant, index) => (
                <div
                  key={index}
                  className="grid grid-cols-2 items-end gap-2 border border-dashed border-border p-3 sm:grid-cols-6"
                >
                  <Field label="First month" htmlFor={`grant-${index}-start`}>
                    <Input
                      id={`grant-${index}-start`}
                      inputMode="numeric"
                      value={grant.start}
                      onChange={(event) =>
                        setGrant(index, { start: event.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="Times"
                    htmlFor={`grant-${index}-repeat`}
                    description="Blank = ongoing"
                  >
                    <Input
                      id={`grant-${index}-repeat`}
                      inputMode="numeric"
                      value={grant.repeat}
                      onChange={(event) =>
                        setGrant(index, { repeat: event.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="Every (months)"
                    htmlFor={`grant-${index}-every`}
                  >
                    <Input
                      id={`grant-${index}-every`}
                      inputMode="numeric"
                      value={grant.every}
                      onChange={(event) =>
                        setGrant(index, { every: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Amount (USD)" htmlFor={`grant-${index}-amount`}>
                    <Input
                      id={`grant-${index}-amount`}
                      inputMode="decimal"
                      value={grant.amount}
                      onChange={(event) =>
                        setGrant(index, { amount: event.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="Expires after (months)"
                    htmlFor={`grant-${index}-expires`}
                  >
                    <Input
                      id={`grant-${index}-expires`}
                      inputMode="numeric"
                      value={grant.expires}
                      onChange={(event) =>
                        setGrant(index, { expires: event.target.value })
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      set(
                        "grants",
                        form.grants.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set("grants", [...form.grants, NEW_GRANT])}
              >
                Add grant
              </Button>
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Matching credit</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={form.matching !== null}
                  onChange={(event) =>
                    set(
                      "matching",
                      event.target.checked
                        ? { percent: "100", cap: "80000" }
                        : null,
                    )
                  }
                />
                Match customer-paid usage (staff-assigned plans only)
              </label>
              {form.matching ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Percent matched" htmlFor="matching-percent">
                    <Input
                      id="matching-percent"
                      inputMode="decimal"
                      value={form.matching.percent}
                      onChange={(event) =>
                        set("matching", {
                          ...form.matching!,
                          percent: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Cap (USD)" htmlFor="matching-cap">
                    <Input
                      id="matching-cap"
                      inputMode="decimal"
                      value={form.matching.cap}
                      onChange={(event) =>
                        set("matching", {
                          ...form.matching!,
                          cap: event.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
              ) : null}
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Usage allowance</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={form.allowance !== null}
                  onChange={(event) =>
                    set(
                      "allowance",
                      event.target.checked ? NEW_ALLOWANCE : null,
                    )
                  }
                />
                Include usage in the plan
              </label>
              {form.allowance ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Measured as" htmlFor="allowance-basis">
                    <select
                      id="allowance-basis"
                      className="block w-full border border-dashed border-border bg-transparent p-2 text-sm"
                      value={form.allowance.basis}
                      onChange={(event) =>
                        set("allowance", {
                          ...form.allowance!,
                          basis: event.target.value as AllowanceForm["basis"],
                        })
                      }
                    >
                      <option value="usage">Dollars of usage</option>
                      <option value="compute">
                        Compute time, priced at the rate card
                      </option>
                    </select>
                  </Field>
                  <Field label="Every" htmlFor="allowance-period">
                    <select
                      id="allowance-period"
                      className="block w-full border border-dashed border-border bg-transparent p-2 text-sm"
                      value={form.allowance.period}
                      onChange={(event) =>
                        set("allowance", {
                          ...form.allowance!,
                          period: event.target.value as AllowanceForm["period"],
                        })
                      }
                    >
                      <option value="month">Month</option>
                      <option value="day_window">
                        24 hours from first start
                      </option>
                    </select>
                  </Field>
                  <Field label="When used up" htmlFor="allowance-exhausted">
                    <select
                      id="allowance-exhausted"
                      className="block w-full border border-dashed border-border bg-transparent p-2 text-sm"
                      value={form.allowance.on_exhausted}
                      onChange={(event) =>
                        set("allowance", {
                          ...form.allowance!,
                          on_exhausted: event.target
                            .value as AllowanceForm["on_exhausted"],
                        })
                      }
                    >
                      <option value="payg">Pay as you go</option>
                      <option value="pause">Pause sandboxes</option>
                    </select>
                  </Field>
                  {form.allowance.basis === "usage" ? (
                    <Field label="Amount (USD)" htmlFor="allowance-amount">
                      <Input
                        id="allowance-amount"
                        inputMode="decimal"
                        value={form.allowance.amount}
                        onChange={(event) =>
                          set("allowance", {
                            ...form.allowance!,
                            amount: event.target.value,
                          })
                        }
                      />
                    </Field>
                  ) : (
                    (
                      [
                        ["hours", "Hours"],
                        ["vcpu", "vCPU"],
                        ["memory_gib", "Memory GiB"],
                      ] as const
                    ).map(([key, label]) => (
                      <Field
                        key={key}
                        label={label}
                        htmlFor={`allowance-${key}`}
                      >
                        <Input
                          id={`allowance-${key}`}
                          inputMode="decimal"
                          value={form.allowance![key]}
                          onChange={(event) =>
                            set("allowance", {
                              ...form.allowance!,
                              [key]: event.target.value,
                            })
                          }
                        />
                      </Field>
                    ))
                  )}
                </div>
              ) : null}
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-5">
              <legend className="mb-2 text-sm font-medium">Limits</legend>
              {LIMITS.map(([key, label]) => (
                <Field key={key} label={label} htmlFor={`limit-${key}`}>
                  <Input
                    id={`limit-${key}`}
                    inputMode="numeric"
                    value={form.limits[key]}
                    onChange={(event) =>
                      set("limits", {
                        ...form.limits,
                        [key]: event.target.value,
                      })
                    }
                  />
                </Field>
              ))}
            </fieldset>
          </>
        )}
        <Field
          label="Reason for this change"
          htmlFor="plan-reason"
          description="Recorded with your name in the catalog audit."
        >
          <Input
            id="plan-reason"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="flex gap-3">
          <Button type="submit" disabled={busy || saving}>
            {saving ? "Saving…" : "Save draft"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
      <SchedulePreviewPanel region={previewRegion} schedule={schedule} />
    </section>
  )
}
