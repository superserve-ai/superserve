"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  ProPaymentView,
  proPaymentStep,
} from "@/components/billing/pro-payment-view"
import { PageHeader } from "@/components/page-header"
import {
  useDashboardTeamContext,
  useQueryScope,
} from "@/components/query-provider"
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
import { planCard } from "@/lib/billing/plans"

const CONFIRM_ATTEMPTS = 5

export function ProPayment({
  billingReturn,
  returnTo,
  checkoutTeam,
}: {
  billingReturn?: "success" | "cancel"
  returnTo: string
  checkoutTeam?: string
}) {
  const router = useRouter()
  const scope = useQueryScope()
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
    scope === "self" &&
    !summaryQuery.isError &&
    Boolean(actor && summaryQuery.data?.permissions?.can_manage)
  const canRecover =
    scope === "self" && summaryQuery.data?.permissions?.can_manage !== false
  const plan = summaryQuery.isError ? undefined : summaryQuery.data?.plan
  const paidPlan =
    plan &&
    !["free", "starter", "payg"].includes(plan.key) &&
    plan.status === "active"
      ? plan.name
      : null
  const [confirming, setConfirming] = useState(billingReturn === "success")
  const [paymentTeam, setPaymentTeam] = useState(checkoutTeam)
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const operationTarget = useRef({ active: false })
  const teamMismatch =
    (!!billingReturn || !!paymentTeam) &&
    (!paymentTeam || paymentTeam !== teamKey)
  useEffect(() => {
    const target = { active: true }
    operationTarget.current = target
    return () => {
      target.active = false
    }
  }, [teamKey, scope, actor])

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

  const checkPayment = useCallback(
    (attempts = 1) =>
      run(async () => {
        if (!canRecover || !teamKey || teamMismatch) return
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
    ],
  )

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
        summaryQuery.isError
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
      !team ||
      (!confirming && (plansQuery.isPending || summaryQuery.isPending)),
    plans: summaryQuery.isError ? undefined : plansQuery.data,
    paidPlan,
    conflict,
    confirming,
    teamMismatch,
  })

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Upgrade to Pro" />
      <div className="flex-1 overflow-y-auto">
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
      </div>
    </div>
  )
}
