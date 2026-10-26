"use client"

import { useIsMutating, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { CheckoutContextRecovery } from "@/components/billing/checkout-context-recovery"
import { PendingStarterPayment } from "@/components/billing/pending-starter-payment"
import {
  ProPaymentView,
  proPaymentStep,
} from "@/components/billing/pro-payment-view"
import { PageHeader } from "@/components/page-header"
import {
  useDashboardTeamContext,
  useQueryScope,
} from "@/components/query-provider"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useBillingSummary } from "@/hooks/use-billing-summary"
import { usePublicBillingPlans } from "@/hooks/use-public-billing-plans"
import { useTeams } from "@/hooks/use-teams"
import { useUser } from "@/hooks/use-user"
import { ApiError } from "@/lib/api/client"
import {
  isStripeCheckoutUrl,
  recoverProPayment,
  startProCheckout,
  resumeProCheckout,
} from "@/lib/api/plan-checkout"
import {
  recoverStarterCheckout,
  type PendingStarterCheckout,
} from "@/lib/api/starter-checkout-recovery"
import {
  checkoutEntryPath,
  checkoutRecoveryPath,
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
  billingReturn,
  returnTo,
  checkoutTeam,
}: ProPaymentProps) {
  const router = useRouter()
  const params = useSearchParams()
  const callbackPath = `/billing/pro/?${params.toString()}`
  const returning = params.has("billing") || params.has("team")
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
  const plansQuery = usePublicBillingPlans(team?.region, !!team)
  const pro = planCard(plansQuery.data, "pro")
  const summaryQuery = useBillingSummary(!!team)
  const canContinue =
    ready &&
    scope === "self" &&
    !summaryQuery.isError &&
    Boolean(actor && summaryQuery.data?.permissions?.can_manage)
  const canRecover =
    ready &&
    scope === "self" &&
    summaryQuery.data?.permissions?.can_manage !== false
  const plan = summaryQuery.isError ? undefined : summaryQuery.data?.plan
  const paidPlan =
    plan &&
    !["free", "starter", "payg"].includes(plan.key) &&
    plan.status === "active"
      ? plan.name
      : null
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const operationTarget = useRef({ active: false })
  const teamMismatch =
    (!!starter && starter.actor !== actor) ||
    ((returning || !!billingReturn || !!expectedTeam) &&
      (!expectedTeam ||
        expectedTeam !== teamKey ||
        ((params.has("billing") || params.has("team")) &&
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
      const results = await Promise.all([refetchSummary(), refetchPlans()])
      if (!target.active) return
      if (results.some((result) => result.isError))
        throw new Error(
          "Unable to refresh your plan. Check payment status again before continuing.",
        )
    },
    [refetchSummary, refetchPlans],
  )

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
        setPaymentTeam(teamKey)
        const target = operationTarget.current
        for (let attempt = 0; attempt < attempts; attempt++) {
          if (!target.active) return
          const outcome = await recoverProPayment(teamKey)
          if (!target.active) return
          if (isStripeCheckoutUrl(outcome)) {
            window.location.assign(outcome)
            return
          }
          if (outcome === "active") {
            router.replace(returnTo)
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
      router,
      run,
      teamKey,
      returnTo,
      teamMismatch,
      billingReturn,
      canRecover,
      actor,
      teamMutating,
      refreshEntry,
    ],
  )

  const actOnStarter = (cancel: boolean) =>
    void run(async () => {
      if (
        !starter ||
        starter.actor !== actor ||
        starter.team !== teamKey ||
        !canContinue ||
        teamMismatch ||
        teamMutating ||
        queryClientRef.current.isMutating({ mutationKey: ["switch-team"] })
      )
        return
      const target = operationTarget.current
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
    if (billingReturn === "success" && teamKey && !teamMismatch)
      void checkPayment(CONFIRM_ATTEMPTS)
  }, [billingReturn, teamKey, teamMismatch, checkPayment])

  const onContinue = () =>
    void run(async () => {
      if (
        !actor ||
        !canContinue ||
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

  const step = proPaymentStep({
    loading:
      !ready ||
      !team ||
      (!confirming && (plansQuery.isPending || summaryQuery.isPending)),
    plans: summaryQuery.isError ? undefined : plansQuery.data,
    paidPlan,
    conflict: conflict || starterCheckRequired,
    confirming,
    teamMismatch,
  })

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Upgrade to Pro" />
      <div className="flex-1 overflow-y-auto">
        {step === "team_mismatch" ||
        (!ready && (returning || !!billingReturn || !!paymentTeam)) ? (
          <CheckoutContextRecovery
            callbackPath={recoveryPath}
            contextPending={!ready}
            allowSwitch={scope === "self"}
          />
        ) : starter && starter.actor === actor && starter.team === teamKey ? (
          <PendingStarterPayment
            purchase={starter.purchase}
            busy={busy || teamMutating}
            canManage={canContinue}
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
            busy={busy}
            canContinue={canContinue}
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
