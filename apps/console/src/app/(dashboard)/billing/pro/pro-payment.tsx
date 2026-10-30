"use client"

import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { CheckoutContextRecovery } from "@/components/billing/checkout-context-recovery"
import {
  SETTLE_POLL_MS,
  SETTLE_TIMEOUT_MS,
} from "@/components/billing/payment-processing"
import { PendingStarterPayment } from "@/components/billing/pending-starter-payment"
import {
  ProPaymentView,
  proPaymentStep,
} from "@/components/billing/pro-payment-view"
import { ServerStarterRecovery } from "@/components/billing/server-starter-recovery"
import { PageHeader } from "@/components/page-header"
import {
  useDashboardTeamContext,
  useQueryScope,
} from "@/components/query-provider"
import { useBillingCapabilities } from "@/hooks/use-billing-capabilities"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { usePendingStarterCheckout } from "@/hooks/use-pending-starter-checkout"
import { useTeams } from "@/hooks/use-teams"
import { useUser } from "@/hooks/use-user"
import { canStartPlan } from "@/lib/api/billing-capabilities"
import {
  checkoutTermsFor,
  proCheckoutResponseSchema,
  upgradeFamily,
} from "@/lib/api/billing-v2"
import { ApiError, apiClient } from "@/lib/api/client"
import {
  isStripeCheckoutUrl,
  paymentActivating,
  recoverProPayment,
  startProCheckout,
  resumeProCheckout,
} from "@/lib/api/plan-checkout"
import { billingKeys } from "@/lib/api/query-keys"
import {
  recoverStarterCheckout,
  type PendingStarterCheckout,
} from "@/lib/api/starter-checkout-recovery"
import {
  checkoutEntryPath,
  checkoutRecoveryPath,
  genericBillingReturnState,
} from "@/lib/billing/checkout-return"
import { findOffer, planCard } from "@/lib/billing/plans"

const STATUS_UNKNOWN = "status_unknown"

function isTransientFailure(cause: unknown) {
  if (cause instanceof ApiError) return cause.status >= 500
  return (
    cause instanceof TypeError ||
    (cause instanceof Error && cause.name === "AbortError")
  )
}

interface ProPaymentProps {
  billingReturn?: "success" | "cancel"
  returnTo: string
  checkoutTeam?: string
}

export function ProPayment(props: ProPaymentProps) {
  const params = useSearchParams()
  return <ProPaymentContext key={params.toString()} {...props} />
}

function ProPaymentContext({
  billingReturn: suppliedBillingReturn,
  returnTo,
  checkoutTeam,
}: ProPaymentProps) {
  const router = useRouter()
  const params = useSearchParams()
  const genericFlowPending =
    genericBillingReturnState(new URLSearchParams(params.toString())) !== null
  const billingReturn = params.has("team") ? suppliedBillingReturn : undefined
  const callbackPath = `/billing/pro/?${params.toString()}`
  const family = upgradeFamily(params.get("plan"))
  const legacyGenericReturn =
    !params.has("team") &&
    genericBillingReturnState(
      new URLSearchParams(params.toString()),
      "billing",
    ) !== null
  const returning =
    params.has("purchase") ||
    params.has("purchase_id") ||
    params.has("team") ||
    (params.has("billing_flow") && !genericFlowPending) ||
    (params.has("billing") && !legacyGenericReturn)
  const queryClient = useQueryClient()
  const queryClientRef = useRef(queryClient)
  queryClientRef.current = queryClient
  const teamMutating = useIsMutating({ mutationKey: ["switch-team"] }) > 0
  const scope = useQueryScope()
  const { ready } = useBillingContext()
  const actor = useUser().user?.id
  const dashboardTeam = useDashboardTeamContext()
  const teamsQuery = useTeams()
  const team = useMemo(() => {
    if (dashboardTeam)
      return { id: dashboardTeam.teamId, region: dashboardTeam.region }
    const match = teamsQuery.data?.teams.find(
      (t) =>
        t.id === teamsQuery.data?.activeTeamId &&
        t.region === teamsQuery.data?.activeRegion,
    )
    return match ? { id: match.id, region: match.region } : null
  }, [dashboardTeam, teamsQuery.data])
  const teamKey = team ? `${team.region}:${team.id}` : null
  const [busy, setBusy] = useState(false)
  const [checkoutTermsRevision, setCheckoutTermsRevision] = useState(0)
  const discardCheckoutTerms = useCallback(() => {
    setCheckoutTermsRevision((revision) => revision + 1)
  }, [])
  const checkoutTermsQuery = useQuery({
    queryKey: [
      "pro-checkout-terms",
      scope,
      actor,
      teamKey,
      checkoutTermsRevision,
    ],
    queryFn: async () =>
      proCheckoutResponseSchema.parse(
        await apiClient<unknown>("/billing/plan", { cache: "no-store" }),
      ),
    enabled:
      ready &&
      !!actor &&
      !!teamKey &&
      scope === "self" &&
      !teamMutating &&
      !busy,
    staleTime: 0,
  })
  const capabilities = useBillingCapabilities()
  const plansQuery = { ...capabilities, data: capabilities.data?.catalog }
  const pro = planCard(plansQuery.data, family)
  const planName = pro?.name ?? (family === "developer" ? "Developer" : "Pro")
  const summaryQuery = useBillingSummary(!!team)
  const canRecover =
    ready &&
    !!actor &&
    scope === "self" &&
    !summaryQuery.isPending &&
    !capabilities.isPending &&
    summaryQuery.data?.permissions?.can_manage !== false &&
    capabilities.data?.actions?.recover_payment !== false
  const canContinue =
    canRecover &&
    canStartPlan(capabilities.data, {
      key: `${family}_monthly`,
      kind: "subscription",
    }) &&
    !summaryQuery.isError &&
    Boolean(actor && summaryQuery.data?.permissions?.can_manage)
  const plan = summaryQuery.isError ? undefined : summaryQuery.data?.plan
  const paidPlan =
    plan &&
    !["free", "starter", "payg"].includes(plan.key) &&
    plan.status === "active"
      ? plan.name
      : null
  const [confirmedPayment, setConfirmedPayment] = useState<{
    team: string
    actor: string
  } | null>(null)
  const paymentCompleted =
    confirmedPayment?.team === teamKey && confirmedPayment?.actor === actor
  const [confirming, setConfirming] = useState(billingReturn === "success")
  const [waitExpired, setWaitExpired] = useState(false)
  const leaving = useRef(false)
  const [returns, setReturns] = useState(0)
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted || !leaving.current) return
      leaving.current = false
      setReturns((value) => value + 1)
    }
    window.addEventListener("pageshow", onPageShow)
    return () => window.removeEventListener("pageshow", onPageShow)
  }, [])
  const [paymentTeam, setPaymentTeam] = useState<string | undefined>()
  const [waitTeam, setWaitTeam] = useState(teamKey)
  if (waitTeam !== teamKey) {
    setWaitTeam(teamKey)
    setWaitExpired(false)
    setConfirming(
      billingReturn === "success" || (!!paymentTeam && paymentTeam === teamKey),
    )
  }
  const [starter, setStarter] = useState<{
    purchase: PendingStarterCheckout
    team: string
    actor: string
  } | null>(null)
  const [starterCheckRequired, setStarterCheckRequired] = useState(false)
  const expectedTeam = checkoutTeam ?? paymentTeam
  const recoveryPath = useMemo(() => {
    if (!paymentTeam || checkoutRecoveryPath(callbackPath)) return callbackPath
    if (returning && !checkoutEntryPath(callbackPath)) return callbackPath
    if (checkoutTeam && checkoutTeam !== paymentTeam) return callbackPath
    // A pending in-page operation has not navigated to its result URL yet.
    // Retain its original target for status recovery, never for a new purchase.
    const status = new URL("/billing/pro/", "https://console.invalid")
    status.searchParams.set("team", paymentTeam)
    status.searchParams.set("return", returnTo)
    status.searchParams.set("billing", "success")
    if (family !== "pro") status.searchParams.set("plan", family)
    return checkoutRecoveryPath(status.pathname + status.search) ?? callbackPath
  }, [returning, paymentTeam, returnTo, callbackPath, checkoutTeam, family])
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const operationTarget = useRef({ active: false })
  const teamMismatch =
    (!!starter && starter.actor !== actor) ||
    ((returning || !!billingReturn || !!expectedTeam) &&
      (!expectedTeam ||
        expectedTeam !== teamKey ||
        (params.has("team") &&
          (!(
            checkoutRecoveryPath(callbackPath) ??
            checkoutEntryPath(callbackPath)
          ) ||
            params.get("team") !== checkoutTeam))))
  useEffect(() => {
    const target = { active: true }
    operationTarget.current = target
    return () => {
      target.active = false
    }
  }, [teamKey, scope, actor, ready, teamMutating])

  const run = useCallback(async (work: () => Promise<void>) => {
    if (inFlight.current) return
    inFlight.current = true
    const target = operationTarget.current
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (cause) {
      if (!target.active) return
      if (cause instanceof ApiError && cause.code === "plan_conflict")
        setConflict(true)
      else
        setError(
          cause instanceof Error ? cause.message : "Something went wrong.",
        )
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [])

  const { refetch: refetchSummary } = summaryQuery
  const { refetch: refetchPlans } = plansQuery
  const refreshEntry = useCallback(
    async (target: { active: boolean }) => {
      // Recovery can expire the accepted operation. Read a new authority snapshot;
      // a failed read must not resurrect its previous frozen quote.
      discardCheckoutTerms()
      const results = await Promise.all([refetchSummary(), refetchPlans()])
      if (!target.active) return
      if (results.some((result) => result.isError))
        throw new Error(
          "Unable to refresh your plan. Check payment status again before continuing.",
        )
    },
    [refetchSummary, refetchPlans, discardCheckoutTerms],
  )

  const refreshCompletedPayment = useCallback(
    async (target: { active: boolean }) => {
      const client = queryClientRef.current
      // A request begun before reconciliation can legitimately contain the old plan.
      await client.cancelQueries({ queryKey: billingKeys.all })
      if (!target.active || client.isMutating({ mutationKey: ["switch-team"] }))
        return
      try {
        await client.invalidateQueries(
          { queryKey: billingKeys.all, refetchType: "active" },
          { cancelRefetch: true, throwOnError: true },
        )
      } catch {
        if (target.active)
          throw new Error(
            "Payment is confirmed, but your plan could not be refreshed. Try again to open the console.",
          )
        return
      }
      if (!target.active || client.isMutating({ mutationKey: ["switch-team"] }))
        return
      router.replace(returnTo)
    },
    [router, returnTo],
  )

  const existingStarter = usePendingStarterCheckout({
    team: teamKey,
    actor,
    enabled:
      canRecover &&
      !teamMismatch &&
      !genericFlowPending &&
      !billingReturn &&
      !paidPlan &&
      !starter,
    refresh: async () => {
      await refreshEntry(operationTarget.current)
    },
  })

  const checkPayment = useCallback(
    () =>
      run(async () => {
        if (
          leaving.current ||
          !canRecover ||
          !teamKey ||
          teamMismatch ||
          teamMutating ||
          queryClientRef.current.isMutating({ mutationKey: ["switch-team"] })
        )
          return
        discardCheckoutTerms()
        setPaymentTeam(teamKey)
        setWaitExpired(false)
        const target = operationTarget.current
        if (paymentCompleted) {
          await refreshCompletedPayment(target)
          return
        }
        const deadline = Date.now() + SETTLE_TIMEOUT_MS
        let replayed = false
        try {
          for (;;) {
            if (!target.active) return
            const outcome = await recoverProPayment(teamKey).catch(
              (cause: unknown) => {
                if (!isTransientFailure(cause)) throw cause
                return STATUS_UNKNOWN
              },
            )
            if (!target.active) return
            if (isStripeCheckoutUrl(outcome)) {
              leaving.current = true
              window.location.assign(outcome)
              return
            }
            if (outcome === "active") {
              if (actor) setConfirmedPayment({ team: teamKey, actor })
              setConfirming(false)
              await refreshCompletedPayment(target)
              return
            }
            let settling =
              outcome === "payment_confirmation_pending" ||
              outcome === STATUS_UNKNOWN
            if (!settling) {
              settling = await paymentActivating().catch(() => true)
              if (!target.active) return
            }
            if (!settling) {
              setStarterCheckRequired(true)
              const existing = await recoverStarterCheckout(teamKey)
              if (!target.active) return
              if (existing.outcome === "pending_starter_checkout" && actor) {
                setStarter({ purchase: existing, team: teamKey, actor })
                setConfirming(false)
                return
              }
              settling = existing.outcome === "payment_confirmation_pending"
              if (!settling) {
                if (existing.outcome !== "no_pending_starter_checkout")
                  throw new Error(
                    "Payment status is unavailable. Please try again.",
                  )
                await refreshEntry(target)
                if (!target.active) return
                setStarter(null)
                setStarterCheckRequired(false)
                setConfirming(false)
                setConflict(false)
                if (!billingReturn) setPaymentTeam(undefined)
                return
              }
            }
            if (
              outcome === "payment_confirmation_pending" &&
              actor &&
              !replayed
            ) {
              replayed = true
              const checkout = await resumeProCheckout(teamKey, actor)
              if (!target.active) return
              if (checkout && isStripeCheckoutUrl(checkout)) {
                leaving.current = true
                window.location.assign(checkout)
                return
              }
            }
            setConfirming(true)
            if (Date.now() >= deadline) {
              setWaitExpired(true)
              return
            }
            await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS))
          }
        } catch (cause) {
          if (!target.active) return
          if (cause instanceof ApiError && cause.code === "plan_conflict")
            setConfirming(false)
          else setWaitExpired(true)
          throw cause
        }
      }),
    [
      run,
      teamKey,
      teamMismatch,
      billingReturn,
      canRecover,
      actor,
      teamMutating,
      refreshEntry,
      discardCheckoutTerms,
      paymentCompleted,
      refreshCompletedPayment,
    ],
  )

  const actOnStarter = (cancel: boolean) =>
    void run(async () => {
      if (
        !starter ||
        starter.actor !== actor ||
        starter.team !== teamKey ||
        !canRecover ||
        teamMismatch ||
        teamMutating ||
        queryClientRef.current.isMutating({ mutationKey: ["switch-team"] })
      )
        return
      const target = operationTarget.current
      discardCheckoutTerms()
      const result = await recoverStarterCheckout(
        starter.team,
        starter.purchase,
        cancel,
      )
      if (!target.active) return
      if (result.outcome === "recovered" && !cancel) {
        window.location.assign(result.url)
        return
      }
      if (result.outcome === "retryable") {
        await refreshEntry(target)
        if (!target.active) return
        setStarter(null)
        setStarterCheckRequired(false)
        setConfirming(false)
        setConflict(false)
        if (!billingReturn) setPaymentTeam(undefined)
        return
      }
      if (cancel && result.outcome === "payment_confirmation_pending") {
        // Expiration may finish asynchronously; recheck without cancelling again.
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          if (!target.active) return
          const observed = await recoverStarterCheckout(starter.team)
          if (!target.active) return
          if (observed.outcome === "no_pending_starter_checkout") {
            await refreshEntry(target)
            if (!target.active) return
            setStarter(null)
            setStarterCheckRequired(false)
            setConfirming(false)
            setConflict(false)
            if (!billingReturn) setPaymentTeam(undefined)
            return
          }
        }
      }
      throw new Error(
        "Payment is not confirmed yet. Your original purchase is retained; check its status before switching plans.",
      )
    })

  useEffect(() => {
    if (
      confirming &&
      !waitExpired &&
      !leaving.current &&
      !busy &&
      !teamMutating &&
      canRecover &&
      !paymentCompleted &&
      teamKey &&
      !teamMismatch &&
      !genericFlowPending
    )
      void checkPayment()
  }, [
    returns,
    confirming,
    waitExpired,
    busy,
    teamMutating,
    canRecover,
    paymentCompleted,
    teamKey,
    teamMismatch,
    genericFlowPending,
    checkPayment,
  ])

  const onContinue = () =>
    void run(async () => {
      if (
        !actor ||
        paymentCompleted ||
        !canContinue ||
        !existingStarter.canStart() ||
        !teamKey ||
        teamMismatch ||
        summaryQuery.isError ||
        starterCheckRequired ||
        !!starter ||
        teamMutating ||
        queryClientRef.current.isMutating({ mutationKey: ["switch-team"] })
      )
        return
      const target = operationTarget.current
      discardCheckoutTerms()
      setPaymentTeam(teamKey)
      const back = new URL("/billing/pro/", window.location.origin)
      back.searchParams.set("return", returnTo)
      back.searchParams.set("team", teamKey)
      if (family !== "pro") back.searchParams.set("plan", family)
      const url = await startProCheckout(
        teamKey,
        `${family}_monthly`,
        back.toString(),
        actor,
      )
      if (!target.active) return
      if (url && isStripeCheckoutUrl(url)) window.location.assign(url)
      else setConfirming(true)
    })

  const step =
    ready && !teamMismatch && paymentCompleted
      ? "completed"
      : proPaymentStep({
          loading:
            genericFlowPending ||
            !ready ||
            !team ||
            (!confirming && (plansQuery.isPending || summaryQuery.isPending)),
          plans: summaryQuery.isError ? undefined : plansQuery.data,
          entryOpen: capabilities.data?.fresh_entry.pro === true,
          family,
          sellable: findOffer(capabilities.data?.offers, `${family}_monthly`)
            ?.sellable,
          paidPlan,
          conflict: conflict || starterCheckRequired,
          confirming,
          teamMismatch,
        })

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Upgrade your plan" />
      <div className="flex-1 overflow-y-auto">
        {existingStarter.visible &&
        existingStarter.busy &&
        !existingStarter.purchase ? (
          <ServerStarterRecovery
            recovery={existingStarter}
            canManage={canRecover}
            onCheckProStatus={() => void checkPayment()}
            choosingPro
          />
        ) : null}
        {step === "team_mismatch" ||
        (!ready && (returning || !!billingReturn || !!paymentTeam)) ? (
          <CheckoutContextRecovery
            callbackPath={recoveryPath}
            contextPending={!ready || genericFlowPending}
            allowSwitch={scope === "self"}
          />
        ) : existingStarter.visible &&
          !confirming &&
          (!existingStarter.busy || !!existingStarter.purchase) ? (
          <ServerStarterRecovery
            recovery={existingStarter}
            canManage={canRecover}
            onCheckProStatus={() => void checkPayment()}
            choosingPro
          />
        ) : starter && starter.actor === actor && starter.team === teamKey ? (
          <PendingStarterPayment
            purchase={starter.purchase}
            busy={busy || teamMutating}
            canManage={canRecover}
            error={error}
            onResume={() => actOnStarter(false)}
            onCancel={() => actOnStarter(true)}
            onCheckPayment={() => void checkPayment()}
          />
        ) : (
          <ProPaymentView
            step={step}
            pro={pro}
            planName={planName}
            paidPlan={paidPlan}
            checkoutTerms={
              ready &&
              actor &&
              scope === "self" &&
              !teamMutating &&
              !teamMismatch &&
              !busy &&
              !checkoutTermsQuery.isError &&
              !checkoutTermsQuery.isFetching
                ? checkoutTermsFor(
                    checkoutTermsQuery.data?.pro_checkout,
                    `${family}_monthly`,
                  )
                : undefined
            }
            busy={busy}
            canContinue={canContinue && !existingStarter.blocksEntry}
            canRecover={canRecover}
            canceled={billingReturn === "cancel"}
            waitExpired={waitExpired}
            error={error}
            onContinue={onContinue}
            onCheckPayment={() => void checkPayment()}
          />
        )}
      </div>
    </div>
  )
}
