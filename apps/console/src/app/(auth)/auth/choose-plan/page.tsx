"use client"

import { Button, cn } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

import { PlanPickerOptions } from "@/components/billing/plan-picker-options"
import { CornerBrackets } from "@/components/corner-brackets"
import {
  checkoutLocator,
  isSignupCheckoutOffer,
  type PlanPickerReason,
  signupCheckoutReturnPath,
} from "@/lib/billing/signup-checkout-paths"

const MESSAGES: Record<PlanPickerReason, string> = {
  upgrade: "Choose a plan to keep your sandboxes running.",
  payment_confirming:
    "We're still confirming your payment. This usually takes a few seconds.",
  checkout_elsewhere:
    "This checkout belongs to a different account or team than the one you're signed in to now. Switch back to it, then try again.",
  trial_ended:
    "Your free trial is used up or isn't available for this account. Your sandboxes are paused and nothing is deleted. Choose a plan to continue.",
  payment_failed:
    "We couldn't confirm a card for your plan. Choose a plan to try again.",
  plan_unavailable: "That plan is no longer available. Choose another plan.",
  checkout_canceled: "Checkout was cancelled. Choose a plan when you're ready.",
  checkout_unavailable: "We couldn't open checkout. Please try again.",
}

function ChoosePlanContent() {
  const searchParams = useSearchParams()
  const raw = searchParams.get("reason")
  const reason: PlanPickerReason =
    raw && Object.hasOwn(MESSAGES, raw) ? (raw as PlanPickerReason) : "upgrade"
  const locator = checkoutLocator(searchParams)
  const selected = searchParams.get("offer")
  const preselected =
    selected === "starter"
      ? "developer"
      : isSignupCheckoutOffer(selected)
        ? selected
        : null

  const picking =
    locator !== null &&
    reason !== "payment_confirming" &&
    reason !== "checkout_elsewhere"

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div
        className={cn(
          "relative w-full border border-dashed border-border bg-surface p-6",
          picking ? "max-w-3xl sm:p-8" : "max-w-sm",
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
          {reason === "payment_confirming" ||
          reason === "checkout_elsewhere" ? (
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
            <PlanPickerOptions preselected={preselected} locator={locator} />
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
