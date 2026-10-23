"use client"

import { Button, Field, Input, Spinner, Switch, useToast } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { useState } from "react"

import { PageHeader } from "@/components/page-header"
import { useQueryScope } from "@/components/query-provider"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { usePrepaidCredit } from "@/hooks/use-prepaid-credit"
import {
  type PrepaidCreditSummary,
  type PrepaidPurchase,
  setPrepaidAutoRecharge,
  startPrepaidCheckout,
  validPrepaidCents,
} from "@/lib/api/prepaid"
import { billingKeys } from "@/lib/api/query-keys"

const PRESET_CENTS = [500, 2500, 5000, 10000]

export function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

export function dollarsToCents(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null
  return Math.round(Number(value.trim()) * 100)
}

const STATE_LABELS: Record<PrepaidPurchase["state"], string> = {
  pending: "Processing",
  paid: "Paid, adding credit",
  credited: "Credited",
  failed: "Failed",
}

export function BuyCreditPageClient() {
  const params = useSearchParams()
  const purchase = params.get("purchase")
  const { data, isLoading, error } = usePrepaidCredit()
  const { data: summary } = useBillingSummary()
  const scope = useQueryScope()
  const canManage =
    Boolean(summary?.permissions?.can_manage) && scope === "self"

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Buy credit" />
      <div className="flex flex-col gap-6 overflow-y-auto p-4">
        {purchase === "success" && (
          <p className="border border-dashed border-border p-3 text-sm text-foreground">
            Payment received. Your credit appears here within a minute.
          </p>
        )}
        {purchase === "cancel" && (
          <p className="border border-dashed border-border p-3 text-sm text-muted">
            Payment cancelled. No charge was made.
          </p>
        )}
        {isLoading && <Spinner />}
        {error && (
          <p className="text-sm text-destructive">
            Credit balance is unavailable. Please reload.
          </p>
        )}
        {data && (
          <>
            <BalanceCard data={data} />
            <PurchaseCard canManage={canManage} />
            <AutoRechargeCard data={data} canManage={canManage} />
            <PurchaseHistory purchases={data.purchases} />
          </>
        )}
      </div>
    </div>
  )
}

function BalanceCard({ data }: { data: PrepaidCreditSummary }) {
  return (
    <section className="border border-dashed border-border p-4">
      <p className="font-mono text-xs text-muted uppercase">Credit balance</p>
      <p className="mt-1 text-2xl font-medium text-foreground">
        {formatDollars(data.balance_cents)}
      </p>
      <p className="mt-1 text-sm text-muted">
        Credit never expires and pays for usage at normal rates. Sandboxes pause
        when it reaches $0.
      </p>
    </section>
  )
}

export function requestedAmount(value: string | null): {
  preset: number
  custom: string
} {
  const cents = value === null ? NaN : Number(value)
  if (!validPrepaidCents(cents)) return { preset: 2500, custom: "" }
  if (PRESET_CENTS.includes(cents)) return { preset: cents, custom: "" }
  return { preset: 2500, custom: String(cents / 100) }
}

function PurchaseCard({ canManage }: { canManage: boolean }) {
  const { teamKey } = useBillingContext()
  const { addToast } = useToast()
  const initial = requestedAmount(useSearchParams().get("amount"))
  const [selected, setSelected] = useState(initial.preset)
  const [custom, setCustom] = useState(initial.custom)
  const [submitting, setSubmitting] = useState(false)
  const customCents = custom ? dollarsToCents(custom) : null
  const amount = custom ? customCents : selected
  const valid = amount !== null && validPrepaidCents(amount)

  const buy = async () => {
    if (!teamKey || !valid || amount === null || submitting) return
    setSubmitting(true)
    try {
      const url = await startPrepaidCheckout(
        teamKey,
        amount,
        window.location.href.split("?")[0],
      )
      window.location.assign(url)
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Unable to open payment",
        "error",
      )
      setSubmitting(false)
    }
  }

  return (
    <section className="flex flex-col gap-4 border border-dashed border-border p-4">
      <h2 className="font-mono text-xs text-muted uppercase">Add credit</h2>
      <div className="flex flex-wrap gap-2">
        {PRESET_CENTS.map((cents) => (
          <Button
            key={cents}
            variant={!custom && selected === cents ? "default" : "outline"}
            size="sm"
            disabled={!canManage}
            onClick={() => {
              setCustom("")
              setSelected(cents)
            }}
          >
            {formatDollars(cents)}
          </Button>
        ))}
      </div>
      <Field
        label="Other amount (USD)"
        description="Any amount in $5 steps, minimum $5."
        error={
          custom && !valid ? "Enter a multiple of $5, at least $5." : undefined
        }
      >
        <Input
          inputMode="decimal"
          placeholder="e.g. 75"
          value={custom}
          disabled={!canManage}
          onChange={(e) => setCustom(e.target.value)}
        />
      </Field>
      <div>
        <Button disabled={!canManage || !valid || submitting} onClick={buy}>
          {submitting
            ? "Opening payment…"
            : `Buy ${valid && amount !== null ? formatDollars(amount) : ""} credit`}
        </Button>
      </div>
    </section>
  )
}

function AutoRechargeCard({
  data,
  canManage,
}: {
  data: PrepaidCreditSummary
  canManage: boolean
}) {
  const { teamKey, cacheScope } = useBillingContext()
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const current = data.auto_recharge
  const [enabled, setEnabled] = useState(current.enabled)
  const [threshold, setThreshold] = useState(
    String((current.threshold_cents ?? 1000) / 100),
  )
  const [amount, setAmount] = useState(
    String((current.amount_cents ?? 2500) / 100),
  )
  const [saving, setSaving] = useState(false)
  const thresholdCents = dollarsToCents(threshold)
  const amountCents = dollarsToCents(amount)
  const valid =
    !enabled ||
    (thresholdCents !== null &&
      amountCents !== null &&
      validPrepaidCents(thresholdCents) &&
      validPrepaidCents(amountCents))

  const save = async () => {
    if (!teamKey || !valid || saving) return
    setSaving(true)
    try {
      const updated = await setPrepaidAutoRecharge(teamKey, {
        enabled,
        thresholdCents: thresholdCents ?? undefined,
        amountCents: amountCents ?? undefined,
      })
      queryClient.setQueryData(
        billingKeys.prepaid({ cacheScope, teamKey }),
        (previous: PrepaidCreditSummary | undefined) =>
          previous
            ? { ...previous, auto_recharge: updated.auto_recharge }
            : updated,
      )
      addToast(
        enabled ? "Auto-recharge is on" : "Auto-recharge is off",
        "success",
      )
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Unable to save auto-recharge",
        "error",
      )
    } finally {
      setSaving(false)
    }
  }

  const canEnable = data.has_saved_card
  return (
    <section className="flex flex-col gap-4 border border-dashed border-border p-4">
      <h2 className="font-mono text-xs text-muted uppercase">Auto-recharge</h2>
      {current.disabled_reason && !current.enabled && (
        <p className="border border-dashed border-destructive p-3 text-sm text-foreground">
          Auto-recharge was turned off: {current.disabled_reason}. Check your
          card, then turn it back on.
        </p>
      )}
      <Switch
        label="Charge my saved card automatically when credit runs low"
        checked={enabled}
        disabled={!canManage || (!enabled && !canEnable)}
        onCheckedChange={setEnabled}
      />
      {!canEnable && (
        <p className="text-sm text-muted">
          Buy credit once to save a card, then you can turn on auto-recharge.
        </p>
      )}
      {enabled && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="When credit falls below (USD)"
            error={
              thresholdCents === null || !validPrepaidCents(thresholdCents)
                ? "Enter a multiple of $5."
                : undefined
            }
          >
            <Input
              inputMode="decimal"
              value={threshold}
              disabled={!canManage}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </Field>
          <Field
            label="Add this much credit (USD)"
            error={
              amountCents === null || !validPrepaidCents(amountCents)
                ? "Enter a multiple of $5."
                : undefined
            }
          >
            <Input
              inputMode="decimal"
              value={amount}
              disabled={!canManage}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>
      )}
      <p className="text-sm text-muted">
        At most one charge runs at a time and at most 10 a day. A declined card
        turns auto-recharge off and we email your billing contacts.
      </p>
      <div>
        <Button
          variant="outline"
          disabled={!canManage || !valid || saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  )
}

function PurchaseHistory({ purchases }: { purchases: PrepaidPurchase[] }) {
  if (purchases.length === 0) return null
  return (
    <section className="border border-dashed border-border p-4">
      <h2 className="mb-3 font-mono text-xs text-muted uppercase">
        Recent purchases
      </h2>
      <ul className="flex flex-col divide-y divide-dashed divide-border text-sm">
        {purchases.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2">
            <span className="text-foreground">
              {new Date(p.created_at).toLocaleDateString()} ·{" "}
              {p.source === "auto_recharge" ? "Auto-recharge" : "Purchase"}
            </span>
            <span className="text-muted">
              {formatDollars(p.amount_cents)} · {STATE_LABELS[p.state]}
              {p.state === "failed" && p.failure_reason
                ? ` (${p.failure_reason})`
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
