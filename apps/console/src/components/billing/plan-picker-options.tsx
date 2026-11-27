"use client"

import { CheckIcon } from "@phosphor-icons/react"
import {
  Button,
  cn,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Spinner as UiSpinner,
} from "@superserve/ui"
import Link from "next/link"
import { type FormEvent, useEffect, useState } from "react"

import { Spinner } from "@/components/icons"
import { useSignOut } from "@/hooks/use-sign-out"
import { useSubmitOnce } from "@/hooks/use-submit-once"
import { ENTERPRISE_MEETING_URL } from "@/lib/api/billing-v2"
import {
  listTeamsAction,
  setActiveTeamAction,
  type TeamSummary,
} from "@/lib/api/teams-actions"
import {
  canManageTeamBillingAction,
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
import { regionLabel } from "@/lib/format"

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

const SUPPORT_EMAIL = "support@superserve.ai"

function EnterpriseOption({
  card,
  className,
}: {
  card: PlanCard
  className?: string
}) {
  return (
    <section
      aria-label={`${card.name} plan`}
      className={cn(
        "flex flex-col border border-dashed border-border bg-background p-6 text-left",
        className,
      )}
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
        render={
          <Link
            href={ENTERPRISE_MEETING_URL}
            target="_blank"
            rel="noopener noreferrer"
          />
        }
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
  submitting,
  onSubmit,
}: {
  plan: PickerPlan
  card: PickerCard
  locator: CheckoutLocator
  highlighted: boolean
  submitting: SignupCheckoutOffer | null
  onSubmit: (offer: SignupCheckoutOffer) => (event: FormEvent) => void
}) {
  return (
    <form
      method="post"
      action={signupCheckoutPath(plan.offer, locator)}
      onSubmit={onSubmit(plan.offer)}
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
        disabled={submitting !== null}
      >
        {submitting === plan.offer ? (
          <>
            <UiSpinner size="sm" />
            Opening checkout…
          </>
        ) : (
          `Choose ${plan.label}`
        )}
      </Button>
    </form>
  )
}

// Option values pair region with id, as in the sidebar team switcher: the
// same team id can exist in two cells.
function teamKey(team: { id: string; region: string }) {
  return `${team.region}:${team.id}`
}

// The user's other teams, so someone who can't buy a plan for this team can
// carry on in one of theirs. One dropdown keeps the page short however many
// teams there are. Nothing shows while they load or can't be read.
function OtherTeams({ locator }: { locator: CheckoutLocator }) {
  const [teams, setTeams] = useState<TeamSummary[]>()
  const [picked, setPicked] = useState<string>()
  const [switching, setSwitching] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    listTeamsAction()
      .then(
        (directory) =>
          live &&
          setTeams(
            directory.teams
              .filter((team) => teamKey(team) !== locator.team)
              .toSorted(
                (a, b) =>
                  a.name.localeCompare(b.name) ||
                  a.region.localeCompare(b.region),
              ),
          ),
      )
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [locator.team])
  if (!teams?.length) return null
  // Region badges only add signal when the teams span regions.
  const multiRegion = new Set(teams.map((team) => team.region)).size > 1
  const teamLabel = (team: TeamSummary) =>
    multiRegion ? `${team.name} · ${regionLabel(team.region)}` : team.name
  const selected = teams.find((team) => teamKey(team) === picked) ?? teams[0]!
  const open = async () => {
    setSwitching(true)
    setFailed(false)
    try {
      await setActiveTeamAction(selected.id, selected.region)
      window.location.assign("/sandboxes")
    } catch {
      setSwitching(false)
      setFailed(true)
    }
  }
  return (
    <div className="flex w-80 max-w-full flex-col items-center gap-2">
      <p className="text-center text-sm text-muted">Or open another team:</p>
      <div className="flex w-full gap-2">
        <Select
          value={teamKey(selected)}
          onValueChange={(value) => setPicked(value as string)}
          disabled={switching}
        >
          <SelectTrigger aria-label="Team to open" className="h-8 min-w-0">
            {/* Base UI's Value renders the raw option value by default. */}
            <SelectValue className="truncate">
              {() => teamLabel(selected)}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup dropdown>
            {teams.map((team) => (
              <SelectItem key={teamKey(team)} value={teamKey(team)}>
                {teamLabel(team)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={switching}
          onClick={() => void open()}
        >
          {switching ? <UiSpinner size="sm" /> : null}
          Open team
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="text-center text-sm text-muted">
          We couldn&apos;t open that team. Please try again.
        </p>
      ) : null}
    </div>
  )
}

export function PlanPickerOptions({
  preselected,
  locator,
  adminRequired = false,
}: {
  preselected: SignupCheckoutOffer | null
  locator: CheckoutLocator
  // Checkout already refused this user for lacking billing access.
  adminRequired?: boolean
}) {
  const { account, team } = locator
  const key = `${account}:${team}`
  // Offers are kept with the team they were read for, so a picker that moves
  // to another team never shows the previous team's prices on its forms.
  const [loaded, setLoaded] = useState<{
    key: string
    catalog: TeamCatalog | null
    canManage: boolean | null
  }>()
  useEffect(() => {
    let live = true
    // Either read failing leaves the picker as it was: plans, offered to all.
    const settle = <T,>(read: () => Promise<T>) =>
      Promise.resolve()
        .then(read)
        .catch(() => null)
    void Promise.all([
      settle(() => getTeamCatalogAction({ account, team })),
      settle(() => canManageTeamBillingAction({ account, team })),
    ]).then(
      ([catalog, canManage]) => live && setLoaded({ key, catalog, canManage }),
    )
    return () => {
      live = false
    }
  }, [account, team, key])
  const current = loaded?.key === key ? loaded : undefined
  const catalog = current?.catalog
  const { submitting, onSubmit } = useSubmitOnce<SignupCheckoutOffer>()
  const signOut = useSignOut()

  if (current === undefined)
    return (
      <div className="mt-5 flex items-center justify-center gap-2">
        <Spinner className="border-primary" />
        <span className="text-sm text-muted">Loading plans…</span>
      </div>
    )
  // Only billing administrators can buy; anyone else would only be refused.
  if (adminRequired || current.canManage === false)
    return (
      <div className="mt-5 flex flex-col items-center gap-4">
        {adminRequired ? null : (
          <p className="max-w-sm text-center text-sm text-muted">
            Only your team&apos;s billing administrators can choose a plan. Ask
            one of them to upgrade this team.
          </p>
        )}
        <OtherTeams locator={locator} />
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    )
  const plans = pickerPlans(catalog?.offers)
  const asked = preselected === "starter" ? "developer" : preselected
  const chosen =
    asked && !plans.some((plan) => plan.offer === asked)
      ? (plans[0]?.offer ?? null)
      : asked
  const highlighted = (offer: SignupCheckoutOffer) =>
    !chosen || chosen === offer
  const enterprise = catalog?.cards.find((card) => card.kind === "custom")
  // Nothing is sellable to this team now, so offer every other way forward.
  if (plans.length === 0)
    return (
      <div className="mt-5 flex w-full flex-col items-center gap-4">
        <p className="max-w-sm text-center text-xs text-muted">
          No plans are available for this team right now. Contact{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-foreground underline underline-offset-4 hover:text-primary"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          to choose a plan.
        </p>
        {enterprise ? (
          <EnterpriseOption card={enterprise} className="w-full max-w-sm" />
        ) : null}
        <OtherTeams locator={locator} />
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
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
            onSubmit={onSubmit(offer)}
          >
            <Button
              type="submit"
              size="sm"
              variant={highlighted(offer) ? "default" : "outline"}
              disabled={submitting !== null}
            >
              {submitting === offer ? <UiSpinner size="sm" /> : null}
              {label}
            </Button>
          </form>
        ))}
      </div>
    )
  return (
    <div
      className={cn(
        "mt-8 grid w-full grid-cols-1 gap-4 md:grid-cols-2",
        listed.length + (enterprise ? 1 : 0) > 2
          ? "lg:grid-cols-3"
          : "max-w-3xl",
      )}
    >
      {listed.map((plan) => (
        <PlanOption
          key={plan.offer}
          plan={plan}
          card={pickerCard(plan.catalog, catalog?.cards ?? [])}
          locator={locator}
          highlighted={highlighted(plan.offer)}
          submitting={submitting}
          onSubmit={onSubmit}
        />
      ))}
      {enterprise ? (
        <EnterpriseOption
          card={enterprise}
          className={
            listed.length % 2 === 0 ? "md:col-span-2 lg:col-span-1" : undefined
          }
        />
      ) : null}
    </div>
  )
}
