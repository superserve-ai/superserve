"use client"

import { CheckIcon } from "@phosphor-icons/react"
import { Button, cn } from "@superserve/ui"
import Link from "next/link"
import { useEffect, useState } from "react"

import { ENTERPRISE_MEETING_URL } from "@/lib/api/billing-v2"
import {
  getTeamCatalogAction,
  type TeamCatalog,
} from "@/lib/billing/plan-offers-actions"
import {
  type PickerCard,
  pickerCard,
  type PickerPlan,
  pickerPlans,
} from "@/lib/billing/plan-picker"
import {
  type BillingOffer,
  type PlanCard,
  planConcurrency,
} from "@/lib/billing/plans"
import {
  type CheckoutLocator,
  type SignupCheckoutOffer,
  signupCheckoutPath,
} from "@/lib/billing/signup-checkout-paths"

function Limit({ children }: { children: string }) {
  return (
    <li className="flex gap-2 text-sm leading-relaxed text-foreground">
      <CheckIcon
        aria-hidden
        weight="light"
        className="mt-1 size-3.5 shrink-0 text-brand"
      />
      {children}
    </li>
  )
}

function EnterpriseOption({ card }: { card: PlanCard }) {
  return (
    <section
      aria-label={`${card.name} plan`}
      className="flex flex-col border border-dashed border-border bg-background p-6 text-left"
    >
      <h2 className="text-2xl leading-none font-medium tracking-tight text-foreground">
        {card.name}
      </h2>
      <p className="mt-6 text-3xl leading-none font-medium tracking-tight text-brand">
        {card.price_label}
      </p>
      <ul className="mt-5 mb-8 flex flex-col gap-3 border-t border-dashed border-border pt-5">
        <Limit>{planConcurrency(card.limits) ?? "Custom limits"}</Limit>
      </ul>
      <Button
        variant="outline"
        className="mt-auto h-11 w-full"
        render={<Link href={ENTERPRISE_MEETING_URL} />}
      >
        Book a meeting
      </Button>
    </section>
  )
}

function PlanOption({
  plan,
  card,
  locator,
  highlighted,
}: {
  plan: PickerPlan
  card: PickerCard
  locator: CheckoutLocator
  highlighted: boolean
}) {
  return (
    <form
      method="post"
      action={signupCheckoutPath(plan.offer, locator)}
      aria-label={`${plan.label} plan`}
      data-highlighted={highlighted}
      className={cn(
        "flex flex-col border border-dashed bg-background p-6 text-left",
        highlighted ? "border-brand/70" : "border-border",
      )}
    >
      <h2 className="text-2xl leading-none font-medium tracking-tight text-foreground">
        {plan.label}
      </h2>
      <p className="mt-6 text-3xl leading-none font-medium tracking-tight text-brand">
        {card.price}
        <span className="ml-1 font-mono text-[11px] tracking-[0.12em] text-muted uppercase">
          / {card.interval}
        </span>
      </p>
      {card.included ? (
        <p className="mt-3 font-mono text-[11px] tracking-[0.12em] text-muted uppercase">
          {card.included}
        </p>
      ) : null}
      {card.tagline ? (
        <p className="mt-5 text-sm leading-relaxed text-muted">
          {card.tagline}
        </p>
      ) : null}
      {card.limits.length ? (
        <ul className="mt-5 mb-8 flex flex-col gap-3 border-t border-dashed border-border pt-5">
          {card.limits.map((limit) => (
            <Limit key={limit}>{limit}</Limit>
          ))}
        </ul>
      ) : null}
      <Button
        type="submit"
        variant={highlighted ? "default" : "outline"}
        className="mt-auto h-11 w-full"
      >
        Choose {plan.label}
      </Button>
    </form>
  )
}

export function PlanPickerOptions({
  preselected,
  locator,
}: {
  preselected: SignupCheckoutOffer | null
  locator: CheckoutLocator
}) {
  const { account, team } = locator
  const key = `${account}:${team}`
  // Offers are kept with the team they were read for, so a picker that moves
  // to another team never shows the previous team's prices on its forms.
  const [loaded, setLoaded] = useState<{
    key: string
    catalog: TeamCatalog | null
  }>()
  useEffect(() => {
    let live = true
    getTeamCatalogAction({ account, team }).then(
      (catalog) => live && setLoaded({ key, catalog }),
      () => live && setLoaded({ key, catalog: null }),
    )
    return () => {
      live = false
    }
  }, [account, team, key])
  const catalog = loaded?.key === key ? loaded.catalog : undefined

  if (catalog === undefined)
    return (
      <div className="mt-5 h-5 w-5 animate-spin border-2 border-primary border-t-transparent" />
    )
  const plans = pickerPlans(catalog?.offers)
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
          <form
            key={offer}
            method="post"
            action={signupCheckoutPath(offer, locator)}
          >
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
  const enterprise = catalog?.cards.find((card) => card.kind === "custom")
  return (
    <div
      className={cn(
        "mt-8 grid w-full grid-cols-1 gap-4 md:grid-cols-2",
        enterprise && "lg:grid-cols-3",
      )}
    >
      {listed.map((plan) => (
        <PlanOption
          key={plan.offer}
          plan={plan}
          card={pickerCard(plan.catalog, catalog?.cards ?? [])}
          locator={locator}
          highlighted={highlighted(plan.offer)}
        />
      ))}
      {enterprise ? <EnterpriseOption card={enterprise} /> : null}
    </div>
  )
}
