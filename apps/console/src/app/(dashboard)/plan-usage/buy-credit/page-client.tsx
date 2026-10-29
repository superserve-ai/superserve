"use client"

import { Button, Field, Input, Spinner, useToast } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLayoutEffect, useRef, useState } from "react"

import {
  AMOUNT_ERROR,
  AutoTopoffCard,
  centsToDollars,
  dollarsToCents,
} from "@/components/billing/auto-topoff-card"
import { CheckoutContextRecovery } from "@/components/billing/checkout-context-recovery"
import { ServerStarterRecovery } from "@/components/billing/server-starter-recovery"
import { PageHeader } from "@/components/page-header"
import { useQueryScope } from "@/components/query-provider"
import { useBillingCapabilities } from "@/hooks/use-billing-capabilities"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { useTeamPlan } from "@/hooks/use-billing-v2"
import { usePendingStarterCheckout } from "@/hooks/use-pending-starter-checkout"
import {
  usePrepaidCredit,
  useRetainedPrepaidOperations,
} from "@/hooks/use-prepaid-credit"
import { useUser } from "@/hooks/use-user"
import {
  fundedByCredit,
  planTopoff,
  TOPOFF_SETTINGS_PATH,
  UPGRADE_PATH,
} from "@/lib/api/billing-v2"
import {
  type PrepaidCreditSummary,
  type PrepaidPurchase,
  type PrepaidOperation,
  startPrepaidCheckout,
  validPrepaidCents,
} from "@/lib/api/prepaid"
import { billingKeys } from "@/lib/api/query-keys"
import {
  checkoutEntryPath,
  checkoutRecoveryPath,
  genericBillingReturnState,
} from "@/lib/billing/checkout-return"

export function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

export { dollarsToCents } from "@/components/billing/auto-topoff-card"

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
  const planQuery = useTeamPlan(contextMatched)
  const plan = planQuery.data
  const offers = useBillingCapabilities().data?.offers
  const topoff = plan ? planTopoff(plan, offers) : null
  // A subscription funded by credit only manages Auto Topoff here; one-off
  // credit purchases are a prepaid plan's.
  const topoffOnly =
    !!plan && plan.kind === "subscription" && fundedByCredit(plan, offers)
  // Starter credit is sold only to teams already on Starter.
  const starterTeam = plan?.kind === "prepaid"
  const purchasable = allowEntry && starterTeam
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
      <PageHeader
        title={purchasable && !topoffOnly ? "Buy credit" : "Credit balance"}
      />
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
            <BalanceCard data={data} showTerms={purchasable && !topoffOnly} />
            {purchasable && data.checkout_idempotency_supported !== true ? (
              <p className="text-sm text-muted">
                Credit purchases are temporarily unavailable. Please try again
                later.
              </p>
            ) : null}
            <ServerStarterRecovery
              recovery={existingStarter}
              canManage={canRecover}
            />
            {topoffOnly ? null : allowEntry && plan === undefined ? (
              planQuery.isError ? (
                <div
                  role="alert"
                  className="space-y-2 text-sm text-destructive"
                >
                  <p>Your plan couldn&apos;t be loaded.</p>
                  <Button onClick={() => void planQuery.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted">Checking your plan…</p>
              )
            ) : purchasable ? (
              <PurchaseCard
                key={`${scope}:${teamKey}:${user?.id}:${topoff?.amount_cents}`}
                actor={actor}
                defaultCents={topoff?.amount_cents}
                checkCanStart={existingStarter.canStart}
                canManage={
                  canRecover &&
                  !existingStarter.blocksEntry &&
                  data.checkout_idempotency_supported === true
                }
              />
            ) : allowEntry ? (
              <p className="text-sm text-muted">
                Your plan doesn&apos;t include credit purchases.{" "}
                <Link
                  href={UPGRADE_PATH}
                  className="underline underline-offset-4"
                >
                  See plans
                </Link>
                .
              </p>
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
            {topoffOnly ? (
              <p className="text-sm text-muted">
                Manage Auto Topoff in{" "}
                <Link
                  href={TOPOFF_SETTINGS_PATH}
                  className="underline underline-offset-4"
                >
                  Settings
                </Link>
                .
              </p>
            ) : plan === undefined ||
              starterTeam ||
              data.auto_recharge.enabled ? (
              <>
                {!allowRecharge ? (
                  <p className="text-sm text-muted">
                    Auto Topoff changes are temporarily unavailable.
                    {allowDisableRecharge &&
                      " You can still turn Auto Topoff off."}
                  </p>
                ) : null}
                <AutoTopoffCard
                  key={[
                    allowRecharge,
                    data.auto_recharge.enabled,
                    data.auto_recharge.threshold_cents,
                    data.auto_recharge.amount_cents,
                    data.auto_recharge.disabled_at,
                    topoff?.amount_cents,
                    topoff?.threshold_cents,
                  ].join(":")}
                  data={data}
                  topoff={topoff}
                  canManage={canManage}
                  allowEntry={allowRecharge}
                  allowDisable={allowDisableRecharge}
                />
              </>
            ) : null}
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

// The amount a link asked for, in cents, else the plan's own top-off amount.
export function requestedAmount(
  value: string | null,
  defaultCents?: number,
): string {
  const cents = value === null ? NaN : Number(value)
  return centsToDollars(validPrepaidCents(cents) ? cents : defaultCents)
}

function PurchaseCard({
  canManage,
  resume,
  checkCanStart,
  actor,
  defaultCents,
}: {
  actor: string | undefined
  checkCanStart?: () => boolean
  canManage: boolean
  resume?: PrepaidOperation
  defaultCents?: number
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
  const [custom, setCustom] = useState(
    requestedAmount(useSearchParams().get("amount"), defaultCents),
  )
  const [submitting, setSubmitting] = useState(false)
  const amount = resume?.amount ?? (custom ? dollarsToCents(custom) : null)
  const valid = amount !== null && validPrepaidCents(amount)

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
        <Field
          label="Amount (USD)"
          error={custom && !valid ? AMOUNT_ERROR : undefined}
        >
          <Input
            inputMode="decimal"
            value={custom}
            disabled={!canManage}
            onChange={(e) => setCustom(e.target.value)}
          />
        </Field>
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
              {p.source === "auto_recharge" ? "Auto Topoff" : "Purchase"}
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
