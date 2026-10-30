import {
  type BillingOffer,
  formatUsdCents,
  type PlanCard,
  planConcurrency,
  planSandboxSize,
} from "@/lib/billing/plans"
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

export interface PickerCard {
  price: string
  interval: string
  included: string | null
  tagline: string | null
  limits: string[]
}

const SUPPORT_FEATURE = /\bsupport\b/i

export function pickerCard(
  offer: BillingOffer,
  cards: readonly PlanCard[],
): PickerCard {
  const card =
    cards.find(
      (entry) =>
        entry.monthly?.offer_key === offer.offer_key ||
        entry.annual?.offer_key === offer.offer_key,
    ) ?? cards.find((entry) => entry.family === offer.family)
  const size = card ? planSandboxSize(card.limits) : null
  const support = card?.features.find((feature) =>
    SUPPORT_FEATURE.test(feature),
  )
  return {
    price: formatUsdCents(offer.price_cents),
    interval: offer.interval_months === 12 ? "year" : "month",
    included: offer.included_credit_cents
      ? `Includes ${formatUsdCents(offer.included_credit_cents)} of usage each month`
      : null,
    tagline: card?.tagline || null,
    limits: [
      card ? planConcurrency(card.limits) : null,
      size,
      offer.topoff
        ? `Auto Reload adds ${formatUsdCents(offer.topoff.amount_cents)} when your balance drops under ${formatUsdCents(offer.topoff.threshold_cents)}`
        : offer.funding_policy === "postpaid"
          ? "Extra usage billed at the end of each billing period"
          : null,
      support ?? null,
    ].filter((line): line is string => line !== null),
  }
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
