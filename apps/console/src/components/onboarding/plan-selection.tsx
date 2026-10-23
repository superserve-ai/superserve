"use client"

import { Button } from "@superserve/ui"
import posthog from "posthog-js"
import { useCallback, useEffect, useRef, useState } from "react"

import { createStripeCheckoutSession } from "@/lib/api/billing-stripe"
import { FALLBACK_PLAN_CATALOG, type PlanCatalog } from "@/lib/api/plan-catalog"
import {
  commitFreePlan,
  isStripeCheckoutUrl,
  recoverProPayment,
  startProCheckout,
} from "@/lib/api/plan-checkout"
import {
  offerCadence,
  purchaseOffer,
  type SignupPlanContext,
} from "@/lib/api/signup-plan"
import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"
import { initialPlanSelection } from "@/lib/auth/plan-preselection"
import type { RequestedOffer } from "@/lib/auth/requested-offer"

import { PlanSelectionView, type PlanCadence } from "./plan-selection-view"
import { ReviewedPlanView, type ReviewedPlan } from "./reviewed-plan-view"

/** The plan an approved account chose at signup, if it named one. */
function reviewedChoice(
  offer: RequestedOffer | undefined,
): { plan: ReviewedPlan; cadence: PlanCadence } | undefined {
  if (offer === "enterprise") return { plan: "enterprise", cadence: "monthly" }
  const cadence = offerCadence(offer)
  if (!cadence) return undefined
  return { plan: offer!.startsWith("starter_") ? "starter" : "pro", cadence }
}

export function PlanSelection({
  initial,
  billingReturn,
  catalog = FALLBACK_PLAN_CATALOG,
}: {
  initial: SignupPlanContext
  billingReturn?: string
  catalog?: PlanCatalog
}) {
  const defaults = initialPlanSelection(initial.requestedOffer)
  const chosen = initial.reviewed
    ? reviewedChoice(initial.requestedOffer)
    : undefined
  const [context, setContext] = useState(initial)
  const [selection, setSelection] = useState(defaults.selection)
  const [cadence, setCadence] = useState<PlanCadence>(
    chosen?.cadence ?? defaults.cadence,
  )
  const [reviewedPlan, setReviewedPlan] = useState<ReviewedPlan | null>(
    chosen?.plan ?? null,
  )
  const [reviewedMode, setReviewedMode] = useState<"confirm" | "plans">(
    chosen ? "confirm" : "plans",
  )
  const autoContinued = useRef(false)
  const [freeBilling, setFreeBilling] = useState(
    initial.offer === "free" && Boolean(billingReturn),
  )
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const completionSent = useRef(false)
  const navigating = useRef(false)
  const step =
    context.state === "pending"
      ? "payment-pending"
      : freeBilling
        ? "free-billing"
        : "plans"

  const track = useCallback(
    (action: string, selected?: string) => {
      try {
        posthog.capture("signup_plan_action", {
          action,
          requested_offer: initial.requestedOffer ?? "not_specified",
          selected_offer: selected,
          billing_cadence: offerCadence(selected),
        })
      } catch {
        /* Analytics never controls onboarding. */
      }
    },
    [initial.requestedOffer],
  )

  const navigate = useCallback((url: string) => {
    window.location.assign(url)
    navigating.current = true
    inFlight.current = true
    setBusy(true)
  }, [])

  const finish = useCallback(
    (offer: string | null, salesFallback = false) => {
      if (!completionSent.current) {
        track("completed", offer ?? "free")
        completionSent.current = true
      }
      navigate(salesFallback ? "/sandboxes?contact_sales=1" : "/sandboxes")
    },
    [track, navigate],
  )

  const refresh = useCallback(async () => {
    const next = await getSignupPlanAction(
      initial.teamKey,
      initial.userId,
      billingReturn,
    )
    if (next.userId !== initial.userId || next.teamKey !== initial.teamKey)
      throw new Error("Your account changed. Reload to continue.")
    if (mounted.current) {
      setContext(next)
      setUncertain(false)
    }
    return next
  }, [initial.teamKey, initial.userId, billingReturn])

  const run = useCallback(
    async (operation: () => Promise<void>) => {
      if (inFlight.current) return
      inFlight.current = true
      setBusy(true)
      setError(null)
      try {
        await operation()
      } catch (cause) {
        if (mounted.current) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to finish setup. Please retry.",
          )
          // A lost response is not proof that a purchase or plan commitment failed.
          try {
            await refresh()
          } catch {
            setUncertain(true)
          }
        }
      } finally {
        if (!navigating.current) {
          inFlight.current = false
          if (mounted.current) setBusy(false)
        }
      }
    },
    [refresh],
  )

  const checkPayment = useCallback(
    (restart = false) =>
      run(async () => {
        const latest = await refresh()
        if (latest.state === "pending") {
          await recoverProPayment(initial.teamKey, restart)
          const recovered = await refresh()
          if (recovered.state === "committed") finish(recovered.offer)
          else if (recovered.state === "selecting") {
            setFreeBilling(false)
            track("payment_retryable")
          }
        } else if (latest.state === "committed" || latest.state === "legacy") {
          if (latest.offer !== "free" || !freeBilling) finish(latest.offer)
        }
      }),
    [run, refresh, initial.teamKey, finish, freeBilling, track],
  )

  useEffect(() => {
    mounted.current = true
    track("viewed")
    if (billingReturn) track("checkout_returned")
    return () => {
      mounted.current = false
    }
  }, [billingReturn, track])

  useEffect(() => {
    if (context.state !== "pending") return
    void checkPayment()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkPayment()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [context.state, checkPayment])

  useEffect(() => {
    const onFocus = () => {
      void checkPayment()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      navigating.current = false
      inFlight.current = false
      void checkPayment()
    }
    window.addEventListener("focus", onFocus)
    window.addEventListener("pageshow", onPageShow)
    return () => {
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("pageshow", onPageShow)
    }
  }, [checkPayment])

  useEffect(() => {
    if (context.state === "yc_claim") {
      navigate("/yc/claim/")
      return
    }
    if (
      context.state === "legacy" ||
      (context.state === "committed" &&
        (context.offer !== "free" ||
          !freeBilling ||
          billingReturn === "success"))
    )
      finish(context.offer)
  }, [
    context.state,
    context.offer,
    freeBilling,
    billingReturn,
    finish,
    navigate,
  ])

  const checkoutReturnUrl = () => {
    const url = new URL("/onboarding/plan/", window.location.origin)
    url.searchParams.set("team", initial.teamKey)
    url.searchParams.set("account", initial.userId)
    return url
  }

  const confirmSelecting = async () => {
    const latest = await refresh()
    if (latest.state !== "selecting") return false
    return true
  }

  // Reviewed signups already chose a plan: Starter/Pro go to checkout and
  // Enterprise starts on the default plan while staff set custom terms.
  const continueReviewed = (plan: ReviewedPlan, planCadence = cadence) =>
    void run(async () => {
      if (!(await confirmSelecting())) return
      setReviewedPlan(plan)
      if (plan === "enterprise") {
        await commitFreePlan(initial.teamKey)
        track("enterprise_selected", "enterprise")
        finish("free")
        return
      }
      const offer = purchaseOffer(plan, planCadence)
      track("continue_to_payment", offer)
      const url = await startProCheckout(
        initial.teamKey,
        offer,
        checkoutReturnUrl().toString(),
      )
      if (url) navigate(url)
      else await refresh()
    })

  useEffect(() => {
    // A checkout return (including cancel) shows the plan instead of
    // reopening payment; so does any later visit after the first attempt.
    if (
      !chosen ||
      autoContinued.current ||
      billingReturn ||
      context.state !== "selecting"
    )
      return
    autoContinued.current = true
    continueReviewed(chosen.plan, chosen.cadence)
  })

  if (context.state === "yc_claim")
    return <main className="p-10">Opening your YC claim…</main>

  if (uncertain)
    return (
      <main className="min-h-dvh p-10">
        <h1 className="text-2xl">We couldn’t confirm your plan</h1>
        <p role="alert" className="my-4">
          {error ??
            "Check again before choosing a plan. Your previous request may still complete."}
        </p>
        <Button disabled={busy} onClick={() => void checkPayment()}>
          Check again
        </Button>
        <Button
          variant="outline"
          className="ml-3"
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
      </main>
    )

  if (initial.reviewed && step === "plans")
    return (
      <ReviewedPlanView
        mode={reviewedMode}
        plan={reviewedPlan}
        cadence={cadence}
        catalog={catalog}
        busy={busy}
        error={error}
        onCadence={(value) => {
          setCadence(value)
          track("cadence_changed", value)
        }}
        onContinue={(plan) => continueReviewed(plan)}
        onChangePlan={() => {
          setReviewedMode("plans")
          track("change_plan")
        }}
      />
    )

  return (
    <PlanSelectionView
      paymentPlan={context.offer?.startsWith("starter_") ? "Starter" : "Pro"}
      step={step}
      selection={selection}
      cadence={cadence}
      busy={busy}
      error={error}
      onCadence={(value) => {
        setCadence(value)
        setSelection("pro")
        track("cadence_changed", `pro_${value}`)
      }}
      onFree={() =>
        void run(async () => {
          if (await confirmSelecting()) {
            setSelection("free")
            setFreeBilling(true)
            track("free_selected", "free")
          }
        })
      }
      onPro={() =>
        void run(async () => {
          if (!(await confirmSelecting())) return
          const offer = `pro_${cadence}` as const
          setSelection("pro")
          track("continue_to_payment", offer)
          const url = await startProCheckout(
            initial.teamKey,
            offer,
            checkoutReturnUrl().toString(),
          )
          if (url) navigate(url)
          else await refresh()
        })
      }
      onEnterprise={() => {
        if (inFlight.current) return
        // Reserve the tab during the user gesture; navigate only after Free is committed.
        const tab = window.open("about:blank", "_blank")
        if (tab) tab.opener = null
        void run(async () => {
          try {
            if (!(await confirmSelecting())) {
              tab?.close()
              return
            }
            await commitFreePlan(initial.teamKey)
            if (tab) tab.location.href = "https://www.superserve.ai/meet/"
            track("contact_sales", "enterprise")
            finish("free", !tab)
          } catch (cause) {
            tab?.close()
            throw cause
          }
        })
      }}
      onAddCard={() =>
        void run(async () => {
          const latest = await refresh()
          if (
            latest.state === "pending" ||
            (latest.offer && latest.offer !== "free") ||
            latest.state === "legacy"
          )
            return
          await commitFreePlan(initial.teamKey)
          track("add_payment_method", "free")
          const url = checkoutReturnUrl()
          const success = new URL(url)
          success.searchParams.set("billing", "success")
          const cancel = new URL(url)
          cancel.searchParams.set("billing", "cancel")
          const session = await createStripeCheckoutSession({
            intentScope: `${initial.userId}:${initial.teamKey}`,
            expectedTeam: initial.teamKey,
            successUrl: success.toString(),
            cancelUrl: cancel.toString(),
          })
          if (!isStripeCheckoutUrl(session.url))
            throw new Error(
              "Unable to open billing. Please try again or skip for now.",
            )
          navigate(session.url)
        })
      }
      onSkip={() =>
        void run(async () => {
          await commitFreePlan(initial.teamKey)
          track("skip_billing", "free")
          finish("free")
        })
      }
      onBack={() =>
        void run(async () => {
          if (await confirmSelecting()) setFreeBilling(false)
          else
            setError(
              "Your Free plan is already selected. You can add billing or skip for now.",
            )
        })
      }
      onCheckPayment={() => void checkPayment()}
      onCancelPayment={() => void checkPayment(true)}
    />
  )
}
