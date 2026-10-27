"use client"

import { Button, Field, Input, Spinner, Switch, useToast } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { useLayoutEffect, useRef, useState } from "react"

import { CheckoutContextRecovery } from "@/components/billing/checkout-context-recovery"
import { ServerStarterRecovery } from "@/components/billing/server-starter-recovery"
import { PageHeader } from "@/components/page-header"
import { useQueryScope } from "@/components/query-provider"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { usePendingStarterCheckout } from "@/hooks/use-pending-starter-checkout"
import {
  usePrepaidCredit,
  useRetainedPrepaidOperations,
} from "@/hooks/use-prepaid-credit"
import { useUser } from "@/hooks/use-user"
import {
  type PrepaidCreditSummary,
  type PrepaidPurchase,
  type PrepaidOperation,
  setPrepaidAutoRecharge,
  startPrepaidCheckout,
  validPrepaidCents,
  validNewPrepaidCents,
} from "@/lib/api/prepaid"
import { billingKeys } from "@/lib/api/query-keys"
import {
  checkoutEntryPath,
  checkoutRecoveryPath,
  genericBillingReturnState,
} from "@/lib/billing/checkout-return"

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
  pending: "Payment not confirmed",
  paid: "Paid, adding credit",
  credited: "Credited",
  failed: "Failed",
}

export function BuyCreditPageClient({
  allowEntry = true,
  allowRecharge = allowEntry,
  allowDisableRecharge = true,
  allowRecovery = true,
}: {
  allowEntry?: boolean
  allowRecharge?: boolean
  allowDisableRecharge?: boolean
  allowRecovery?: boolean
} = {}) {
  const params = useSearchParams()
  const genericFlowPending =
    genericBillingReturnState(new URLSearchParams(params.toString())) !== null
  const purchase = params.get("purchase")
  const { teamKey, ready } = useBillingContext()
  const { user, loading: actorLoading, error: actorError } = useUser()
  const actor = !actorLoading && !actorError ? user?.id : undefined
  const returnTeam = params.get("team")
  const callbackPath = `/plan-usage/buy-credit/?${params.toString()}`
  const returning =
    params.has("billing") ||
    params.has("purchase") ||
    params.has("team") ||
    params.has("purchase_id") ||
    (params.has("billing_flow") && !genericFlowPending)
  const returnMismatch =
    ready &&
    returning &&
    (!(checkoutRecoveryPath(callbackPath) ?? checkoutEntryPath(callbackPath)) ||
      returnTeam !== teamKey)
  const contextMatched = ready && !returnMismatch && !genericFlowPending
  const {
    data: credit,
    isLoading,
    error,
    refetch,
  } = usePrepaidCredit(contextMatched)
  const data = contextMatched && !error ? credit : undefined
  const returnedPurchase = data?.purchases.find(
    (item) => item.id === params.get("purchase_id"),
  )
  const summaryQuery = useBillingSummary(contextMatched)
  const summary = summaryQuery.isError ? undefined : summaryQuery.data
  const scope = useQueryScope()
  const canManage =
    ready && Boolean(summary?.permissions?.can_manage) && scope === "self"
  const canRecover = canManage && allowRecovery
  const retained = useRetainedPrepaidOperations(data?.purchases)
  const queryClient = useQueryClient()
  const existingStarter = usePendingStarterCheckout({
    team: teamKey,
    actor,
    enabled: contextMatched && canRecover,
    refresh: async () => {
      await queryClient.invalidateQueries(
        { queryKey: billingKeys.all },
        { throwOnError: true },
      )
    },
  })

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={allowEntry ? "Buy credit" : "Credit balance"} />
      <div className="flex flex-col gap-6 overflow-y-auto p-4">
        {returning && !contextMatched ? (
          <CheckoutContextRecovery
            callbackPath={callbackPath}
            contextPending={!ready || genericFlowPending}
            allowSwitch={scope === "self"}
          />
        ) : null}
        {contextMatched && purchase === "success" && !error && (
          <p className="border border-dashed border-border p-3 text-sm text-foreground">
            {returnedPurchase?.state === "credited"
              ? "Payment confirmed. Credit has been added."
              : returnedPurchase?.state === "paid"
                ? "Payment confirmed. Credit is being added."
                : returnedPurchase?.state === "failed"
                  ? "This payment failed. Check recent purchases for details."
                  : "Checking payment status. Credit appears after payment is confirmed."}
          </p>
        )}
        {contextMatched && purchase === "cancel" && (
          <p className="border border-dashed border-border p-3 text-sm text-muted">
            You left checkout. Payment is not confirmed; resume the original
            purchase or check its status before starting another.
          </p>
        )}
        {(!ready || isLoading || genericFlowPending) && <Spinner />}
        {actorError ? (
          <p role="alert" className="text-sm text-destructive">
            Unable to verify your account. Sign in again before starting a
            payment.
          </p>
        ) : null}
        {contextMatched && error && (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>Credit balance and payment status are unavailable.</p>
            <Button onClick={() => void refetch()}>Check status</Button>
          </div>
        )}
        {data && (
          <>
            <BalanceCard data={data} showTerms={allowEntry} />
            {allowEntry && data.checkout_idempotency_supported !== true ? (
              <p className="text-sm text-muted">
                Credit purchases are temporarily unavailable. Please try again
                later.
              </p>
            ) : null}
            <ServerStarterRecovery
              recovery={existingStarter}
              canManage={canRecover}
            />
            {allowEntry ? (
              <PurchaseCard
                key={`${scope}:${teamKey}:${user?.id}`}
                actor={actor}
                checkCanStart={existingStarter.canStart}
                canManage={
                  canRecover &&
                  !existingStarter.blocksEntry &&
                  data.checkout_idempotency_supported === true
                }
              />
            ) : (
              <p className="text-sm text-muted">
                Credit purchases are temporarily unavailable.
              </p>
            )}
            {!existingStarter.blocksEntry && retained.length > 0 ? (
              <div className="space-y-3">
                <h2 className="text-sm font-medium">
                  Resume a previous purchase
                </h2>
                {retained.map((operation) => (
                  <PurchaseCard
                    key={`${scope}:${teamKey}:${user?.id}:${operation.id}`}
                    canManage={
                      canRecover &&
                      !existingStarter.blocksEntry &&
                      data.checkout_idempotency_supported === true
                    }
                    actor={actor}
                    resume={operation}
                  />
                ))}
              </div>
            ) : null}
            {!allowRecharge ? (
              <p className="text-sm text-muted">
                Auto-recharge changes are temporarily unavailable.
                {allowDisableRecharge &&
                  " You can still turn auto-recharge off."}
              </p>
            ) : null}
            <AutoRechargeCard
              key={[
                allowRecharge,
                data.auto_recharge.enabled,
                data.auto_recharge.threshold_cents,
                data.auto_recharge.amount_cents,
                data.auto_recharge.disabled_at,
              ].join(":")}
              data={data}
              canManage={canManage}
              allowEntry={allowRecharge}
              allowDisable={allowDisableRecharge}
            />
            <PurchaseHistory purchases={data.purchases} />
          </>
        )}
      </div>
    </div>
  )
}

function BalanceCard({
  data,
  showTerms,
}: {
  data: PrepaidCreditSummary
  showTerms: boolean
}) {
  return (
    <section className="border border-dashed border-border p-4">
      <p className="font-mono text-xs text-muted uppercase">Credit balance</p>
      <p className="mt-1 text-2xl font-medium text-foreground">
        {formatDollars(data.balance_cents)}
      </p>
      {showTerms && (
        <p className="mt-1 text-sm text-muted">
          Purchased credit never expires and pays for usage at normal rates.
          Prepaid plans pause sandboxes at $0.
        </p>
      )}
    </section>
  )
}

export function requestedAmount(value: string | null): {
  preset: number
  custom: string
} {
  const cents = value === null ? NaN : Number(value)
  if (!validNewPrepaidCents(cents)) return { preset: 2500, custom: "" }
  if (PRESET_CENTS.includes(cents)) return { preset: cents, custom: "" }
  return { preset: 2500, custom: String(cents / 100) }
}

function PurchaseCard({
  canManage,
  resume,
  checkCanStart,
  actor,
}: {
  actor: string | undefined
  checkCanStart?: () => boolean
  canManage: boolean
  resume?: PrepaidOperation
}) {
  const { teamKey, ready } = useBillingContext()
  const target = useRef(teamKey)
  useLayoutEffect(() => {
    target.current = ready ? teamKey : null
    return () => {
      target.current = null
    }
  }, [teamKey, ready])
  const inFlight = useRef(false)
  const [status, setStatus] = useState<string | null>(null)
  const { addToast } = useToast()
  const queryClient = useQueryClient()
  const initial = requestedAmount(useSearchParams().get("amount"))
  const [selected, setSelected] = useState(initial.preset)
  const [custom, setCustom] = useState(initial.custom)
  const [submitting, setSubmitting] = useState(false)
  const customCents = custom ? dollarsToCents(custom) : null
  const amount = resume?.amount ?? (custom ? customCents : selected)
  const valid =
    amount !== null &&
    (resume ? validPrepaidCents(amount) : validNewPrepaidCents(amount))

  const buy = async () => {
    if (
      !actor ||
      !teamKey ||
      !ready ||
      !canManage ||
      (checkCanStart && !checkCanStart()) ||
      !valid ||
      amount === null ||
      inFlight.current
    )
      return
    const originalTeam = teamKey
    inFlight.current = true
    setSubmitting(true)
    try {
      const result = await startPrepaidCheckout(
        teamKey,
        amount,
        window.location.href.split("?")[0],
        actor,
        resume?.id,
      )
      if (target.current !== originalTeam) return
      if (result.url && result.state === "pending")
        window.location.assign(result.url)
      else {
        void queryClient.invalidateQueries({ queryKey: billingKeys.all })
        setStatus(
          result.state === "credited"
            ? "Credit confirmed. You can make another purchase."
            : result.state === "failed"
              ? "This purchase failed. You can start a new purchase."
              : "Checking the existing purchase. Retry to check the same payment; credit appears after confirmation.",
        )
        setSubmitting(false)
      }
    } catch (err) {
      if (target.current !== originalTeam) return
      setStatus(
        "Payment status is uncertain. Retry to check the same purchase.",
      )
      addToast(
        err instanceof Error ? err.message : "Unable to open payment",
        "error",
      )
      setSubmitting(false)
    } finally {
      inFlight.current = false
    }
  }

  return (
    <section className="flex flex-col gap-4 border border-dashed border-border p-4">
      <h2 className="font-mono text-xs text-muted uppercase">
        {resume
          ? `Previous ${formatDollars(resume.amount)} purchase`
          : "Add credit"}
      </h2>
      {status ? (
        <p role="alert" className="text-sm text-muted">
          {status}
        </p>
      ) : null}
      {!resume ? (
        <>
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
            description="Any amount in $5 steps, from $5 to $10,000."
            error={
              custom && !valid
                ? "Enter a multiple of $5 between $5 and $10,000."
                : undefined
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
        </>
      ) : null}
      <div>
        <Button
          disabled={!canManage || !actor || !ready || !valid || submitting}
          onClick={buy}
        >
          {submitting
            ? "Opening payment…"
            : resume
              ? "Check previous purchase"
              : `Buy ${valid && amount !== null ? formatDollars(amount) : ""} credit`}
        </Button>
      </div>
    </section>
  )
}

function AutoRechargeCard({
  data,
  canManage,
  allowEntry,
  allowDisable,
}: {
  data: PrepaidCreditSummary
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
      validNewPrepaidCents(thresholdCents) &&
      validNewPrepaidCents(amountCents))

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

  const canEnable = allowEntry && data.has_saved_card
  return (
    <section className="flex flex-col gap-4 border border-dashed border-border p-4">
      <h2 className="font-mono text-xs text-muted uppercase">Auto-recharge</h2>
      {current.disabled_reason && !current.enabled && (
        <p className="border border-dashed border-destructive p-3 text-sm text-foreground">
          Auto-recharge was turned off: {current.disabled_reason}.
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
          Buy credit once to save a card, then you can turn on auto-recharge.
        </p>
      )}
      {enabled && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="When credit falls below (USD)"
            error={
              thresholdCents === null || !validNewPrepaidCents(thresholdCents)
                ? "Enter a multiple of $5 between $5 and $10,000."
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
              amountCents === null || !validNewPrepaidCents(amountCents)
                ? "Enter a multiple of $5 between $5 and $10,000."
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
        turns auto-recharge off and we email your billing contacts.
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
