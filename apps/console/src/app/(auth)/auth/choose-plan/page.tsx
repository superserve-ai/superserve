"use client"

import { Button, cn } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import posthog from "posthog-js"
import { Suspense, useEffect } from "react"

import { PlanPickerOptions } from "@/components/billing/plan-picker-options"
import { CornerBrackets } from "@/components/corner-brackets"
import {
  checkoutLocator,
  isSignupCheckoutOffer,
  paymentSettlingPath,
  type PlanPickerReason,
  signupCheckoutReturnPath,
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
  trial_ended:
    "Your free trial is used up or isn't available for this account. Your sandboxes are paused and nothing is deleted. Choose a plan to continue.",
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
  useEffect(() => {
    if (settling) router.replace(settling)
  }, [settling, router])
  // New teams start on a trial, so this picker, not /onboarding/plan, is where
  // most customers first see plans. $pageview alone does not say why.
  useEffect(() => {
    if (settling) return
    try {
      posthog.capture(PLAN_PICKER_EVENTS.VIEWED, {
        reason,
        requested_offer: preselected ?? "not_specified",
        plans_offered: picking,
      })
    } catch {
      /* Analytics never controls the picker. */
    }
  }, [settling, reason, preselected, picking])
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
            {MESSAGES[reason]}
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
