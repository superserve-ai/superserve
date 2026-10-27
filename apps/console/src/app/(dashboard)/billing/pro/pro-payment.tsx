"use client"

import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { CheckoutContextRecovery } from "@/components/billing/checkout-context-recovery"
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
import { proCheckoutResponseSchema } from "@/lib/api/billing-v2"
import { ApiError, apiClient } from "@/lib/api/client"
import {
  isStripeCheckoutUrl,
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
import { planCard } from "@/lib/billing/plans"

const CONFIRM_ATTEMPTS = 5

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
  const pro = planCard(plansQuery.data, "pro")
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
    capabilities.data?.fresh_entry.pro === true &&
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
  const [paymentTeam, setPaymentTeam] = useState<string | undefined>()
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
    return checkoutRecoveryPath(status.pathname + status.search) ?? callbackPath
  }, [returning, paymentTeam, returnTo, callbackPath, checkoutTeam])
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
            "Payment is confirmed, but your plan could not be refreshed. Check again to refresh your plan.",
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
    (attempts = 1) =>
      run(async () => {
        if (
          !canRecover ||
          !teamKey ||
          teamMismatch ||
          teamMutating ||
          queryClientRef.current.isMutating({ mutationKey: ["switch-team"] })
        )
          return
        discardCheckoutTerms()
        setPaymentTeam(teamKey)
        const target = operationTarget.current
        if (paymentCompleted) {
          await refreshCompletedPayment(target)
          return
        }
        for (let attempt = 0; attempt < attempts; attempt++) {
          if (!target.active) return
          const outcome = await recoverProPayment(teamKey)
          if (!target.active) return
          if (isStripeCheckoutUrl(outcome)) {
            window.location.assign(outcome)
            return
          }
          if (outcome === "active") {
            if (actor) setConfirmedPayment({ team: teamKey, actor })
            setConfirming(false)
            await refreshCompletedPayment(target)
            return
          }
          if (
            outcome === "no_pending_pro_purchase" ||
            outcome === "retryable"
          ) {
            setStarterCheckRequired(true)
            const existing = await recoverStarterCheckout(teamKey)
            if (!target.active) return
            if (existing.outcome === "pending_starter_checkout" && actor) {
              setStarter({ purchase: existing, team: teamKey, actor })
              setConfirming(false)
              return
            }
            if (existing.outcome === "payment_confirmation_pending") {
              setConfirming(true)
              return
            }
            if (existing.outcome !== "no_pending_starter_checkout")
              throw new Error(
                "Payment status is unavailable. Please check again.",
              )
            await refreshEntry(target)
            if (!target.active) return
            setStarter(null)
            setStarterCheckRequired(false)
          }
          if (outcome !== "payment_confirmation_pending") {
            setConfirming(false)
            setConflict(false)
            if (!billingReturn) setPaymentTeam(undefined)
            return
          }
          if (actor) {
            const checkout = await resumeProCheckout(teamKey, actor)
            if (!target.active) return
            if (checkout && isStripeCheckoutUrl(checkout)) {
              window.location.assign(checkout)
              return
            }
          }
          setConfirming(true)
          if (attempt + 1 < attempts)
            await new Promise((resolve) => setTimeout(resolve, 2000))
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
      billingReturn === "success" &&
      canRecover &&
      !paymentCompleted &&
      teamKey &&
      !teamMismatch &&
      !genericFlowPending
    )
      void checkPayment(CONFIRM_ATTEMPTS)
  }, [
    billingReturn,
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
      const url = await startProCheckout(
        teamKey,
        "pro_monthly",
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
          paidPlan,
          conflict: conflict || starterCheckRequired,
          confirming,
          teamMismatch,
        })

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Upgrade to Pro" />
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
                ? checkoutTermsQuery.data?.pro_checkout
                : undefined
            }
            busy={busy}
            canContinue={canContinue && !existingStarter.blocksEntry}
            canRecover={canRecover}
            canceled={billingReturn === "cancel"}
            error={error}
            onContinue={onContinue}
            onCheckPayment={() => void checkPayment()}
          />
        )}
      </div>
    </div>
  )
}
