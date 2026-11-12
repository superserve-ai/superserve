"use client"

import { Button, cn } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import posthog, { type CaptureOptions } from "posthog-js"
import { Suspense, useEffect, useRef, useState } from "react"

import { PlanPickerOptions } from "@/components/billing/plan-picker-options"
import { CornerBrackets } from "@/components/corner-brackets"
import { getTrialOutcomeAction } from "@/lib/billing/plan-offers-actions"
import {
  type CheckoutLocator,
  checkoutLocator,
  isSignupCheckoutOffer,
  paymentSettlingPath,
  type PlanPickerReason,
  signupCheckoutReturnPath,
  type TrialOutcome,
} from "@/lib/billing/signup-checkout-paths"
import { PLAN_PICKER_EVENTS } from "@/lib/posthog/events"

const SUPPORT_EMAIL = "support@superserve.ai"

// Reasons where checkout failed, so the customer also gets a way to reach us.
const NEEDS_SUPPORT = new Set<PlanPickerReason>([
  "checkout_unavailable",
  "checkout_refused",
])

const MESSAGES: Record<PlanPickerReason, string> = {
  upgrade: "Choose a plan to keep your sandboxes running.",
  checkout_elsewhere:
    "This checkout belongs to a different account or team than the one you're signed in to now. Switch back to it, then try again.",
  // Neutral: claims nothing about the trial. The copy below says used up,
  // denied or unconfirmed only once the team's summary confirms which.
  trial_ended: "Choose a plan to run sandboxes.",
  payment_failed:
    "We couldn't confirm a card for your plan. Choose a plan to try again.",
  plan_required:
    "Free covers your first team. Choose a plan to run sandboxes in this one.",
  plan_unavailable: "That plan is no longer available. Choose another plan.",
  checkout_canceled: "Checkout was cancelled. Choose a plan when you're ready.",
  checkout_unavailable: "We couldn't open checkout. Please try again.",
  checkout_refused:
    "We couldn't start checkout for this team, and trying again won't fix it.",
  billing_admin_required:
    "Only your team's billing administrators can choose a plan. Ask one of them to upgrade this team.",
}

const TRIAL_COPY: Record<TrialOutcome, string> = {
  ended:
    "Your free trial has ended. Your sandboxes are paused. A sandbox set to auto-delete after a pause can still be deleted. Choose a plan to continue.",
  unavailable:
    "The free trial isn't available for this account. Choose a plan to run sandboxes.",
  check_unavailable:
    "We couldn't confirm the free trial for this account because a required check didn't complete. Choose a plan to run sandboxes.",
  unknown: MESSAGES.trial_ended,
}

// What plan_picker_viewed reports as its reason for a trial_ended picker, so
// a trial that was used up, one the account never got, and one a required
// check could not confirm stay apart in analytics as they do in the copy.
const TRIAL_VIEW_REASON: Record<TrialOutcome, string> = {
  ended: "trial_ended",
  unavailable: "trial_unavailable",
  check_unavailable: "trial_check_unavailable",
  unknown: "trial_reason_unknown",
}

// The team's trial outcome once its summary is read: undefined while it
// loads, null when there is no team to read or the console can't read it.
function useTrialOutcome(
  locator: CheckoutLocator | null,
  enabled: boolean,
): TrialOutcome | null | undefined {
  const account = enabled ? locator?.account : undefined
  const team = enabled ? locator?.team : undefined
  const key = account && team ? `${account}/${team}` : null
  // Tagged with the team it was read for, so a previous team's result is never
  // used while another team's balance loads.
  const [read, setRead] = useState<{
    key: string
    outcome: TrialOutcome | null
  } | null>(null)
  useEffect(() => {
    if (!account || !team || !key) return
    let current = true
    getTrialOutcomeAction({ account, team })
      .then((next) => current && setRead({ key, outcome: next }))
      .catch((): void => {
        if (current) setRead({ key, outcome: null })
      })
    return () => {
      current = false
      // A picker that leaves trial_ended and comes back waits for a fresh read.
      setRead(null)
    }
  }, [account, team, key])
  if (key === null) return null
  return read?.key === key ? read.outcome : undefined
}

// Says which trial state the team is in only once its summary confirms it.
// Until that is known nothing is shown, so the copy never flips. A summary the
// console cannot read, or one with no trial reason, keeps the neutral message,
// so a load failure is never shown as a denial.
function TrialEndedMessage({
  outcome,
}: {
  outcome: TrialOutcome | null | undefined
}) {
  if (outcome === undefined) return null
  return outcome ? TRIAL_COPY[outcome] : MESSAGES.trial_ended
}

interface PickerView {
  reason: string
  requested_offer: string
  plan_options_requested: boolean
}

interface PickerVisit {
  identity: string
  view: PickerView
}

function recordPickerView(
  recorded: { current: string | null },
  { identity, view }: PickerVisit,
  options?: CaptureOptions,
) {
  if (recorded.current === identity) return
  recorded.current = identity
  try {
    if (options) posthog.capture(PLAN_PICKER_EVENTS.VIEWED, view, options)
    else posthog.capture(PLAN_PICKER_EVENTS.VIEWED, view)
  } catch {
    /* Analytics never controls the picker. */
  }
}

// Records plan_picker_viewed once per picker visit; identity names the visit.
// The ref keeps StrictMode's effect replay, and a view that loads after its
// fallback was sent, from recording the visit twice. view is null while the
// visit is still loading; fallback is then recorded if the visit changes,
// closes or the page unloads first, so no visit is lost.
function usePlanPickerView(
  view: PickerView | null,
  fallback: PickerView | null,
  identity: string,
) {
  const recorded = useRef<string | null>(null)
  const pending = useRef<PickerVisit | null>(null)
  const mounted = useRef(false)
  const viewKey = view && JSON.stringify(view)
  const fallbackKey = fallback && JSON.stringify(fallback)
  useEffect(() => {
    const waiting = pending.current
    pending.current = null
    if (waiting && waiting.identity !== identity) {
      recordPickerView(recorded, waiting)
    }
    if (viewKey) {
      recordPickerView(recorded, {
        identity,
        view: JSON.parse(viewKey) as PickerView,
      })
    } else if (fallbackKey) {
      pending.current = {
        identity,
        view: JSON.parse(fallbackKey) as PickerView,
      }
    }
  }, [identity, viewKey, fallbackKey])
  useEffect(() => {
    mounted.current = true
    const flush = (options?: CaptureOptions) => {
      const waiting = pending.current
      pending.current = null
      if (waiting) recordPickerView(recorded, waiting, options)
    }
    // React cleanup does not run when the document unloads.
    const onPageHide = () => flush({ transport: "sendBeacon" })
    window.addEventListener("pagehide", onPageHide)
    return () => {
      window.removeEventListener("pagehide", onPageHide)
      mounted.current = false
      // StrictMode runs this cleanup and mounts again at once, so only a
      // picker that is still unmounted after the timeout has really closed.
      setTimeout(() => {
        if (!mounted.current) flush()
      }, 0)
    }
  }, [])
}

function ChoosePlanContent() {
  const searchParams = useSearchParams()
  const raw = searchParams.get("reason")
  const reason: PlanPickerReason =
    raw && Object.hasOwn(MESSAGES, raw) ? (raw as PlanPickerReason) : "upgrade"
  const locator = checkoutLocator(searchParams)
  const router = useRouter()
  const settling =
    raw === "payment_confirming" && locator
      ? paymentSettlingPath(locator)
      : null
  const selected = searchParams.get("offer")
  const preselected =
    selected === "starter"
      ? "developer"
      : isSignupCheckoutOffer(selected)
        ? selected
        : null

  const picking = locator !== null && reason !== "checkout_elsewhere"
  const trialEnded = reason === "trial_ended" && !settling
  const trialOutcome = useTrialOutcome(locator, trialEnded)
  useEffect(() => {
    if (settling) router.replace(settling)
  }, [settling, router])
  // New teams start on a trial, so this picker, not /onboarding/plan, is where
  // most customers first see plans. $pageview alone does not say why.
  // plan_options_requested says the page asked for plans; billing permissions
  // or an empty catalog can still hide them. A trial_ended picker waits for
  // the team's trial outcome so its reason says which one it is, and records
  // an unknown trial reason if it changes or closes first.
  const shown = {
    requested_offer: preselected ?? "not_specified",
    plan_options_requested: picking,
  }
  usePlanPickerView(
    settling || (trialEnded && trialOutcome === undefined)
      ? null
      : {
          ...shown,
          reason: trialEnded
            ? TRIAL_VIEW_REASON[trialOutcome ?? "unknown"]
            : reason,
        },
    settling ? null : { ...shown, reason: TRIAL_VIEW_REASON.unknown },
    JSON.stringify({ ...shown, reason, team: locator?.team ?? null }),
  )
  if (settling) return null

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div
        className={cn(
          "relative w-full border border-dashed border-border bg-surface p-6",
          picking ? "max-w-5xl sm:p-8" : "max-w-sm",
        )}
      >
        <CornerBrackets size="lg" />
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Image
              src="/logo.svg"
              alt="Superserve"
              width={120}
              height={24}
              className="h-6 w-auto"
            />
          </Link>
        </div>
        <div className="flex flex-col items-center">
          <h1 className="text-center text-sm font-medium text-foreground">
            Choose a plan
          </h1>
          <p className="mt-2 text-center text-xs text-muted">
            {reason === "trial_ended" ? (
              <TrialEndedMessage outcome={trialOutcome} />
            ) : (
              MESSAGES[reason]
            )}
          </p>
          {NEEDS_SUPPORT.has(reason) && (
            <p className="mt-2 text-center text-xs text-muted">
              Need help upgrading? Contact{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-foreground underline underline-offset-4 hover:text-primary"
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          )}
          {reason === "checkout_elsewhere" ? (
            locator ? (
              <Button
                render={
                  <Link
                    href={signupCheckoutReturnPath(
                      locator.account,
                      locator.team,
                    )}
                  />
                }
                size="sm"
                className="mt-5"
              >
                Check again
              </Button>
            ) : (
              <Button
                render={<Link href="/sandboxes" />}
                size="sm"
                className="mt-5"
              >
                Back to console
              </Button>
            )
          ) : !locator ? (
            <Button
              render={<Link href="/sandboxes" />}
              size="sm"
              className="mt-5"
            >
              Back to console
            </Button>
          ) : (
            <PlanPickerOptions
              preselected={preselected}
              locator={locator}
              adminRequired={reason === "billing_admin_required"}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function ChoosePlanPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ChoosePlanContent />
    </Suspense>
  )
}
