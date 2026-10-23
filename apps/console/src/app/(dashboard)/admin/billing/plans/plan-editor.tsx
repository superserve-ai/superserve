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
import { formatUsdCents, type PlanGrant } from "@/lib/billing/plans"

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

interface DraftForm {
  family: string
  public: boolean
  display_name: string
  tagline: string
  features: string
  sort_order: string
  display_only: boolean
  self_serve: boolean
  monthly_fee: string
  annual_fee: string
  grants: GrantForm[]
  matching: { percent: string; cap: string } | null
  limits: Record<keyof PlanDraft["limits"], string>
}

function formFrom(draft: PlanDraft): DraftForm {
  return {
    family: draft.family,
    public: draft.public,
    display_name: draft.display_name,
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
    limits: {
      max_sandboxes: text(draft.limits.max_sandboxes),
      max_template_vcpu: text(draft.limits.max_template_vcpu),
      max_template_memory_mib: text(draft.limits.max_template_memory_mib),
      max_template_disk_mib: text(draft.limits.max_template_disk_mib),
    },
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
    return {
      family: form.family.trim(),
      public: form.public,
      display_name: form.display_name.trim(),
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
      limits: form.display_only
        ? {
            max_sandboxes: null,
            max_template_vcpu: null,
            max_template_memory_mib: null,
            max_template_disk_mib: null,
          }
        : {
            max_sandboxes: optionalWhole(
              form.limits.max_sandboxes,
              "Concurrent sandboxes",
            ),
            max_template_vcpu: optionalWhole(
              form.limits.max_template_vcpu,
              "vCPU",
            ),
            max_template_memory_mib: optionalWhole(
              form.limits.max_template_memory_mib,
              "Memory",
            ),
            max_template_disk_mib: optionalWhole(
              form.limits.max_template_disk_mib,
              "Disk",
            ),
          },
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
              onChange={(event) => set("display_only", event.target.checked)}
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
                plans with a fee, one ongoing monthly grant expiring after a
                month, and no matching rule.
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
            <fieldset className="grid gap-4 sm:grid-cols-4">
              <legend className="mb-2 text-sm font-medium">Limits</legend>
              {(
                [
                  ["max_sandboxes", "Concurrent sandboxes"],
                  ["max_template_vcpu", "vCPU per sandbox"],
                  ["max_template_memory_mib", "Memory MiB"],
                  ["max_template_disk_mib", "Disk MiB"],
                ] as const
              ).map(([key, label]) => (
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
