import { type BillingOffer, formatUsdCents } from "@/lib/billing/plans"
import {
  SIGNUP_CHECKOUT_OFFERS,
  type SignupCheckoutOffer,
} from "@/lib/billing/signup-checkout-paths"

export interface PickerPlan {
  offer: SignupCheckoutOffer
  label: string
  catalog: BillingOffer | null
}

// What the picker showed before the catalog listed offers; kept for a
// backend whose offers include neither plan.
const FALLBACK_PLANS: readonly PickerPlan[] = [
  { offer: "developer", label: "Developer", catalog: null },
  { offer: "pro_monthly", label: "Pro", catalog: null },
]

function checkoutOfferFor(offerKey: string): SignupCheckoutOffer | undefined {
  return (Object.keys(SIGNUP_CHECKOUT_OFFERS) as SignupCheckoutOffer[]).find(
    (offer) => SIGNUP_CHECKOUT_OFFERS[offer] === offerKey,
  )
}

// The plans a team can check out from the picker, in catalog order. Offers
// that are not sellable to this team now are left out.
export function pickerPlans(
  offers: readonly BillingOffer[] | null | undefined,
): PickerPlan[] {
  const listed = (offers ?? []).flatMap((catalog) => {
    const offer = checkoutOfferFor(catalog.offer_key)
    return offer ? [{ offer, label: catalog.display_name, catalog }] : []
  })
  if (listed.length === 0) return [...FALLBACK_PLANS]
  return listed.filter((plan) => plan.catalog.sellable)
}

export function pickerPlanLabel(
  offers: readonly BillingOffer[] | null | undefined,
  offer: SignupCheckoutOffer,
): string {
  const key = SIGNUP_CHECKOUT_OFFERS[offer]
  return (
    offers?.find((catalog) => catalog.offer_key === key)?.display_name ??
    FALLBACK_PLANS.find((plan) => SIGNUP_CHECKOUT_OFFERS[plan.offer] === key)
      ?.label ??
    "a plan"
  )
}

export function offerPriceLabel(offer: BillingOffer): string {
  return `${formatUsdCents(offer.price_cents)} / ${offer.interval_months === 12 ? "year" : "month"}`
}

export function offerTerms(offer: BillingOffer): string[] {
  const included = offer.included_credit_cents
  const terms = included
    ? [`${formatUsdCents(included)} of usage included each month`]
    : []
  if (offer.topoff)
    terms.push(
      `Auto Reload adds ${formatUsdCents(offer.topoff.amount_cents)} when credit drops below ${formatUsdCents(offer.topoff.threshold_cents)}. ${offer.topoff.default_enabled ? "On by default; you can turn it off" : "Off by default; you can turn it on"} at checkout.`,
    )
  else if (offer.funding_policy === "postpaid")
    terms.push(
      included
        ? "Usage beyond that is billed at the end of the month"
        : "Usage is billed at the end of the month",
    )
  return terms
}

// Whether the picker still sells offer. Offers that don't list it leave
// today's behaviour, which offers it.
export function pickerOfferSellable(
  offers: readonly BillingOffer[] | null | undefined,
  offer: SignupCheckoutOffer,
): boolean {
  const key = SIGNUP_CHECKOUT_OFFERS[offer]
  return offers?.find((catalog) => catalog.offer_key === key)?.sellable ?? true
}
