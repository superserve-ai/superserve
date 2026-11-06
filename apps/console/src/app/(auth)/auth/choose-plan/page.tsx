"use client"

import { Button, cn } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

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
  used_up:
    "Your free trial is used up. Your sandboxes are paused and nothing is deleted. Choose a plan to continue.",
  unavailable:
    "The free trial isn't available for this account. Choose a plan to run sandboxes.",
  check_unavailable:
    "We couldn't confirm the free trial for this account because a required check didn't complete. Choose a plan to run sandboxes.",
  unknown: MESSAGES.trial_ended,
}

// Says which trial state the team is in only once its summary confirms it.
// Until that is known nothing is shown, so the copy never flips. A summary the
// console cannot read, or one with no trial reason, keeps the neutral message,
// so neither a load failure nor an unexplained block is shown as a denial.
function TrialEndedMessage({ locator }: { locator: CheckoutLocator | null }) {
  const account = locator?.account
  const team = locator?.team
  const key = account && team ? `${account}/${team}` : null
  // Tagged with the team it was read for, so a previous team's result is never
  // shown while another team's balance loads.
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
    }
  }, [account, team, key])
  if (key === null) return MESSAGES.trial_ended
  if (read?.key !== key) return null
  return read.outcome ? TRIAL_COPY[read.outcome] : MESSAGES.trial_ended
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
  useEffect(() => {
    if (settling) router.replace(settling)
  }, [settling, router])
  if (settling) return null
  const selected = searchParams.get("offer")
  const preselected =
    selected === "starter"
      ? "developer"
      : isSignupCheckoutOffer(selected)
        ? selected
        : null

  const picking = locator !== null && reason !== "checkout_elsewhere"

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
              <TrialEndedMessage locator={locator} />
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
