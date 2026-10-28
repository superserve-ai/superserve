"use client"

import { Button, cn } from "@superserve/ui"
import { useEffect, useState } from "react"

import { getTeamOffersAction } from "@/lib/billing/plan-offers-actions"
import {
  offerPriceLabel,
  offerTerms,
  type PickerPlan,
  pickerPlans,
} from "@/lib/billing/plan-picker"
import type { BillingOffer } from "@/lib/billing/plans"
import {
  type SignupCheckoutOffer,
  signupCheckoutPath,
} from "@/lib/billing/signup-checkout-paths"

function PlanOption({
  plan,
  highlighted,
}: {
  plan: PickerPlan & { catalog: BillingOffer }
  highlighted: boolean
}) {
  return (
    <form
      method="post"
      action={signupCheckoutPath(plan.offer)}
      aria-label={`${plan.label} plan`}
      className={cn(
        "flex flex-col gap-3 border border-dashed p-4 text-left",
        highlighted ? "border-brand/70" : "border-border",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{plan.label}</p>
        <p className="font-mono text-xs text-foreground">
          {offerPriceLabel(plan.catalog)}
        </p>
      </div>
      <ul className="space-y-1 text-xs text-muted">
        {offerTerms(plan.catalog).map((term) => (
          <li key={term}>{term}</li>
        ))}
      </ul>
      <Button
        type="submit"
        size="sm"
        variant={highlighted ? "default" : "outline"}
      >
        Choose {plan.label}
      </Button>
    </form>
  )
}

export function PlanPickerOptions({
  preselected,
}: {
  preselected: SignupCheckoutOffer | null
}) {
  const [offers, setOffers] = useState<BillingOffer[] | null>()
  useEffect(() => {
    let live = true
    getTeamOffersAction().then(
      (loaded) => live && setOffers(loaded),
      () => live && setOffers(null),
    )
    return () => {
      live = false
    }
  }, [])

  if (offers === undefined)
    return (
      <div className="mt-5 h-5 w-5 animate-spin border-2 border-primary border-t-transparent" />
    )
  const plans = pickerPlans(offers)
  const asked = preselected === "starter" ? "developer" : preselected
  const chosen =
    asked && !plans.some((plan) => plan.offer === asked)
      ? (plans[0]?.offer ?? null)
      : asked
  const highlighted = (offer: SignupCheckoutOffer) =>
    !chosen || chosen === offer
  if (plans.length === 0)
    return (
      <p className="mt-5 text-center text-xs text-muted">
        No plans are available right now. Please try again later.
      </p>
    )
  const listed = plans.filter(
    (plan): plan is PickerPlan & { catalog: BillingOffer } =>
      plan.catalog !== null,
  )
  if (listed.length === 0)
    return (
      <div className="mt-5 flex gap-2">
        {plans.map(({ offer, label }) => (
          <form key={offer} method="post" action={signupCheckoutPath(offer)}>
            <Button
              type="submit"
              size="sm"
              variant={highlighted(offer) ? "default" : "outline"}
            >
              {label}
            </Button>
          </form>
        ))}
      </div>
    )
  return (
    <div className="mt-5 flex w-full flex-col gap-3">
      {listed.map((plan) => (
        <PlanOption
          key={plan.offer}
          plan={plan}
          highlighted={highlighted(plan.offer)}
        />
      ))}
    </div>
  )
}
