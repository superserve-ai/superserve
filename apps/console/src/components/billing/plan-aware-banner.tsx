import { Button, cn } from "@superserve/ui"
import Link from "next/link"

import {
  balanceKnown,
  BUY_CREDIT_PATH,
  formatCents,
  fundedByCredit,
  isLowBalance,
  type PrepaidBalance,
  type TeamPlan,
  TOPOFF_SETTINGS_PATH,
  UPGRADE_PATH,
} from "@/lib/api/billing-v2"
import type { BillingOffer } from "@/lib/billing/plans"

export interface UpgradeChoice {
  name: string
  href: string
}

export interface PlanAwareBannerProps {
  plan: TeamPlan
  upgradeChoices?: readonly UpgradeChoice[]
  offers?: readonly BillingOffer[]
  fundingState?: string | null
  prepaid: PrepaidBalance | null
  canManage: boolean
  canUpgrade?: boolean
  canBuyCredit?: boolean
  canConfigureRecharge?: boolean
}

export function BannerShell({
  tone,
  label,
  children,
  action,
}: {
  tone: "info" | "warning" | "danger"
  label: string
  children: React.ReactNode
  action: React.ReactNode
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-dashed px-4 py-3 text-sm",
        tone === "info" && "border-border bg-surface text-foreground",
        tone === "warning" &&
          "border-yellow-500/40 bg-yellow-100 text-yellow-950 dark:bg-yellow-950 dark:text-yellow-100",
        tone === "danger" &&
          "border-red-500/40 bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100",
      )}
    >
      <p className="min-w-0 flex-1 basis-72">{children}</p>
      {action}
    </section>
  )
}

export function ManageAction({
  canManage,
  children,
}: {
  canManage: boolean
  children: React.ReactNode
}) {
  return canManage ? (
    <div className="flex flex-wrap items-center gap-4">{children}</div>
  ) : (
    <p>Contact your team&apos;s billing administrator.</p>
  )
}

function LowCreditBanner({
  prepaid,
  canManage,
  canConfigureRecharge,
}: {
  prepaid: PrepaidBalance
  canManage: boolean
  canConfigureRecharge: boolean
}) {
  return (
    <BannerShell
      tone={prepaid.balance_cents <= 0 ? "danger" : "warning"}
      label="Credit balance"
      action={
        canConfigureRecharge && (
          <ManageAction canManage={canManage}>
            <Button size="sm" render={<Link href={TOPOFF_SETTINGS_PATH} />}>
              {prepaid.auto_recharge.disabled_reason
                ? "Turn Auto Topoff back on"
                : "Turn on Auto Topoff"}
            </Button>
          </ManageAction>
        )
      }
    >
      Your credit balance is too low. Buy usage to continue running sandboxes.
    </BannerShell>
  )
}

export function PlanAwareBanner({
  plan,
  upgradeChoices = [],
  offers,
  fundingState,
  prepaid,
  canManage,
  canUpgrade = true,
  canBuyCredit = true,
  canConfigureRecharge = true,
}: PlanAwareBannerProps) {
  if (plan.kind === "free") {
    const running = plan.limits.max_concurrent
    const choices = canUpgrade ? upgradeChoices : []
    return (
      <BannerShell
        tone="info"
        label="Free plan"
        action={
          <ManageAction canManage={canManage}>
            {!canUpgrade ? null : choices.length ? (
              choices.map((choice, index) => (
                <Button
                  key={choice.href}
                  size="sm"
                  variant={index === 0 ? "default" : "outline"}
                  render={<Link href={choice.href} />}
                >
                  Get {choice.name}
                </Button>
              ))
            ) : (
              <Button size="sm" render={<Link href={UPGRADE_PATH} />}>
                Upgrade
              </Button>
            )}
          </ManageAction>
        }
      >
        You can run {running ?? "the default number of"} sandbox
        {running === 1 ? "" : "es"} at a time on Free.{" "}
        {choices.length
          ? `Upgrade to ${choices.map((choice) => choice.name).join(" or ")} for bigger sandboxes and more usage.`
          : "Upgrade for bigger sandboxes and more usage."}
      </BannerShell>
    )
  }

  if (prepaid && !balanceKnown(prepaid)) return null

  if (plan.kind === "subscription" && fundedByCredit(plan, offers)) {
    const settled = fundingState !== "unknown" && fundingState !== "auto_topoff"
    return prepaid &&
      settled &&
      !prepaid.auto_recharge.enabled &&
      prepaid.low_balance === true ? (
      <LowCreditBanner
        prepaid={prepaid}
        canManage={canManage}
        canConfigureRecharge={canConfigureRecharge}
      />
    ) : null
  }

  if (plan.kind === "prepaid" && prepaid && isLowBalance(prepaid)) {
    const empty = prepaid.balance_cents <= 0
    return (
      <BannerShell
        tone={empty ? "danger" : "warning"}
        label={`${plan.name} balance`}
        action={
          <ManageAction canManage={canManage}>
            {canBuyCredit ? (
              <Button size="sm" render={<Link href={BUY_CREDIT_PATH} />}>
                Buy credit
              </Button>
            ) : null}
            {canConfigureRecharge && !prepaid.auto_recharge.enabled && (
              <Link
                href={BUY_CREDIT_PATH}
                className="self-center underline underline-offset-4"
              >
                {prepaid.auto_recharge.disabled_reason
                  ? "Turn auto-recharge back on"
                  : "Set up auto-recharge"}
              </Link>
            )}
          </ManageAction>
        }
      >
        {empty ? (
          <>
            Your {plan.name} balance has run out. Running sandboxes are paused
            {prepaid.auto_recharge.in_flight
              ? " while a top-up is being processed."
              : " until you add credit."}
          </>
        ) : (
          <>
            Your {plan.name} balance is{" "}
            <strong>{formatCents(prepaid.balance_cents)}</strong>. Running
            sandboxes pause when it reaches $0.
          </>
        )}
      </BannerShell>
    )
  }

  return null
}
