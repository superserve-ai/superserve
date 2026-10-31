"use client"

import { Button, Field, Input, Switch, useToast } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { useBillingCapabilities } from "@/hooks/use-billing-capabilities"
import { useBillingContext } from "@/hooks/use-billing-context"
import { usePrepaidCredit } from "@/hooks/use-prepaid-credit"
import {
  type PrepaidCreditSummary,
  setPrepaidAutoRecharge,
  validPurchaseCents,
  validThresholdCents,
} from "@/lib/api/prepaid"
import { billingKeys } from "@/lib/api/query-keys"
import type { PlanTopoff } from "@/lib/billing/plans"

const AUTO_TOPOFF_ANCHOR = "auto-topoff"

export const AMOUNT_ERROR = "Enter a multiple of $5, from $5 to $10,000."
const THRESHOLD_ERROR = "Enter whole dollars, from $1 to $10,000."

export function centsToDollars(cents: number | null | undefined): string {
  return typeof cents === "number" ? String(cents / 100) : ""
}

export function dollarsToCents(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null
  return Math.round(Number(value.trim()) * 100)
}

export function AutoTopoffCard({
  data,
  topoff,
  canManage,
  allowEntry,
  allowDisable,
}: {
  data: PrepaidCreditSummary
  topoff: PlanTopoff
  canManage: boolean
  allowEntry: boolean
  allowDisable: boolean
}) {
  const { teamKey, cacheScope } = useBillingContext()
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const current = data.auto_recharge
  const [enabled, setEnabled] = useState(current.enabled)
  const [threshold, setThreshold] = useState(
    centsToDollars(current.threshold_cents ?? topoff?.threshold_cents),
  )
  const [amount, setAmount] = useState(
    centsToDollars(current.amount_cents ?? topoff?.amount_cents),
  )
  const [saving, setSaving] = useState(false)
  const thresholdCents = dollarsToCents(threshold)
  const amountCents = dollarsToCents(amount)
  const valid =
    !enabled ||
    (thresholdCents !== null &&
      amountCents !== null &&
      validThresholdCents(thresholdCents) &&
      validPurchaseCents(amountCents))

  const actionAllowed = enabled ? allowEntry : allowDisable
  const save = async () => {
    if (!teamKey || !canManage || !valid || saving || !actionAllowed) return
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
      // The plan, balance, summary and capabilities all reflect Auto Reload.
      void queryClient.invalidateQueries({ queryKey: billingKeys.all })
      addToast(enabled ? "Auto Reload is on" : "Auto Reload is off", "success")
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Unable to save Auto Reload",
        "error",
      )
    } finally {
      setSaving(false)
    }
  }

  const canEnable = allowEntry && data.has_saved_card
  return (
    <section className="flex flex-col gap-4 border border-dashed border-border p-4">
      <h2 className="font-mono text-xs text-muted uppercase">Auto Reload</h2>
      {current.disabled_reason && !current.enabled && (
        <p className="border border-dashed border-destructive p-3 text-sm text-foreground">
          Auto Reload was turned off: {current.disabled_reason}.
          {allowEntry && " Check your card, then turn it back on."}
        </p>
      )}
      <Switch
        label="Charge my saved card automatically when credit runs low"
        checked={enabled}
        disabled={!canManage || (enabled ? !allowDisable : !canEnable)}
        onCheckedChange={setEnabled}
      />
      {allowEntry && !canEnable && (
        <p className="text-sm text-muted">
          Buy credit once to save a card, then you can turn on Auto Reload.
        </p>
      )}
      {enabled && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="When credit falls below (USD)"
            error={
              thresholdCents === null || !validThresholdCents(thresholdCents)
                ? THRESHOLD_ERROR
                : undefined
            }
          >
            <Input
              inputMode="decimal"
              value={threshold}
              disabled={!canManage || !allowEntry}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </Field>
          <Field
            label="Add this much credit (USD)"
            error={
              amountCents === null || !validPurchaseCents(amountCents)
                ? AMOUNT_ERROR
                : undefined
            }
          >
            <Input
              inputMode="decimal"
              value={amount}
              disabled={!canManage || !allowEntry}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>
      )}
      <p className="text-sm text-muted">
        At most one charge runs at a time and at most 10 a day. A declined card
        turns Auto Reload off and we email your billing contacts.
      </p>
      <div>
        <Button
          variant="outline"
          disabled={!canManage || !valid || saving || !actionAllowed}
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  )
}

// Auto Reload for a plan funded by credit, managed from Settings.
export function AutoTopoffSettings({
  topoff,
  canManage,
}: {
  topoff: PlanTopoff
  canManage: boolean
}) {
  const capabilities = useBillingCapabilities()
  const { teamKey } = useBillingContext()
  const credit = usePrepaidCredit()
  const data = credit.isError ? undefined : credit.data
  const loaded = !!data
  // Links land here before the settings have loaded, so scroll once they do.
  useEffect(() => {
    if (loaded && window.location.hash === `#${AUTO_TOPOFF_ANCHOR}`)
      document.getElementById(AUTO_TOPOFF_ANCHOR)?.scrollIntoView()
  }, [loaded])
  if (!data)
    return (
      <p className="px-5 pb-5 text-sm text-muted sm:px-6">
        {credit.isError
          ? "Auto Reload settings couldn't be loaded."
          : "Loading Auto Reload…"}
      </p>
    )
  const allowEntry = capabilities.data?.fresh_entry.auto_recharge === true
  const allowDisable =
    !capabilities.isPending &&
    capabilities.data?.actions?.disable_auto_recharge !== false
  return (
    <div id={AUTO_TOPOFF_ANCHOR} className="px-5 pb-5 sm:px-6">
      <AutoTopoffCard
        key={[
          teamKey,
          allowEntry,
          data.auto_recharge.enabled,
          data.auto_recharge.threshold_cents,
          data.auto_recharge.amount_cents,
          data.auto_recharge.disabled_at,
        ].join(":")}
        data={data}
        topoff={topoff}
        canManage={canManage}
        allowEntry={allowEntry}
        allowDisable={allowDisable}
      />
    </div>
  )
}
