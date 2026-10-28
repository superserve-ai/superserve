"use client"

import { Button } from "@superserve/ui"
import posthog from "posthog-js"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  isStripeCheckoutUrl,
  recoverProPayment,
  startProCheckout,
} from "@/lib/api/plan-checkout"
import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"
import { initialPlanSelection } from "@/lib/auth/plan-preselection"

import { PlanSelectionView, type PlanCadence } from "./plan-selection-view"

export function PlanSelection({
  initial,
  billingReturn,
}: {
  initial: SignupPlanContext
  billingReturn?: string
}) {
  const defaults = initialPlanSelection(initial.requestedOffer)
  const [context, setContext] = useState(initial)
  const [cadence, setCadence] = useState<PlanCadence>(defaults.cadence)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const completionSent = useRef(false)
  const navigating = useRef(false)
  const step = context.state === "pending" ? "payment-pending" : "plans"

  const track = useCallback(
    (action: string, selected?: string) => {
      try {
        posthog.capture("signup_plan_action", {
          action,
          requested_offer: initial.requestedOffer ?? "not_specified",
          selected_offer: selected,
          billing_cadence: selected?.startsWith("pro_")
            ? selected.slice(4)
            : undefined,
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
    (offer: string | null) => {
      if (!completionSent.current) {
        track("completed", offer ?? undefined)
        completionSent.current = true
      }
      navigate("/sandboxes")
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
          const outcome = await recoverProPayment(initial.teamKey, restart)
          if (isStripeCheckoutUrl(outcome)) {
            navigate(outcome)
            return
          }
          const recovered = await refresh()
          if (recovered.state === "committed") finish(recovered.offer)
          else if (recovered.state === "selecting") track("payment_retryable")
        } else if (latest.state === "committed" || latest.state === "legacy") {
          finish(latest.offer)
        }
      }),
    [run, refresh, initial.teamKey, finish, track, navigate],
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
    if (context.state === "legacy" || context.state === "committed")
      finish(context.offer)
  }, [context.state, context.offer, finish, navigate])

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

  return (
    <PlanSelectionView
      step={step}
      cadence={cadence}
      busy={busy}
      error={error}
      onCadence={(value) => {
        setCadence(value)
        track("cadence_changed", `pro_${value}`)
      }}
      onPro={() =>
        void run(async () => {
          if (!(await confirmSelecting())) return
          const offer = `pro_${cadence}` as const
          track("continue_to_payment", offer)
          const url = await startProCheckout(
            initial.teamKey,
            offer,
            checkoutReturnUrl().toString(),
            initial.userId,
          )
          if (url) navigate(url)
          else await refresh()
        })
      }
      onEnterprise={() => {
        window.open(
          "https://www.superserve.ai/meet/",
          "_blank",
          "noopener,noreferrer",
        )
        track("contact_sales", "enterprise")
      }}
      onCheckPayment={() => void checkPayment()}
      onCancelPayment={() => void checkPayment(true)}
    />
  )
}
