"use client"

import { Button } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"
import {
  checkoutLocator,
  isSignupCheckoutOffer,
  type PlanPickerReason,
  signupCheckoutReturnPath,
  signupCheckoutPath,
} from "@/lib/billing/signup-checkout-paths"

const PLANS = [
  { offer: "developer", label: "Developer" },
  { offer: "pro_monthly", label: "Pro" },
] as const

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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <DitherBackground />
      <div className="relative w-full max-w-sm border border-dashed border-border bg-surface p-6">
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
            <div className="mt-5 flex gap-2">
              {PLANS.map(({ offer, label }) => (
                <form
                  key={offer}
                  method="post"
                  action={signupCheckoutPath(offer, locator)}
                >
                  <Button
                    type="submit"
                    size="sm"
                    variant={
                      !preselected || preselected === offer
                        ? "default"
                        : "outline"
                    }
                  >
                    {label}
                  </Button>
                </form>
              ))}
            </div>
          )}
          <Link
            href="https://superserve.ai/pricing"
            className="mt-3 text-xs underline"
          >
            Compare plans
          </Link>
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
