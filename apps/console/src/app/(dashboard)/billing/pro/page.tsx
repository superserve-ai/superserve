import type { Metadata } from "next"

import { safeReturnPath } from "@/lib/billing/return-path"
import { recordCheckoutReturnForUser } from "@/lib/posthog/checkout"

import { ProPayment } from "./pro-payment"

export const metadata: Metadata = {
  title: "Upgrade your plan",
}

export default async function ProPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{
    billing?: string | string[]
    return?: string | string[]
    team?: string | string[]
  }>
}) {
  const { billing, return: returnTo, team: checkoutTeam } = await searchParams
  const billingReturn =
    billing === "success" || billing === "cancel" ? billing : undefined
  if (billingReturn && typeof checkoutTeam === "string")
    await recordCheckoutReturnForUser({
      surface: "billing_pro",
      outcome: billingReturn,
      teamKey: checkoutTeam,
    })
  return (
    <ProPayment
      billingReturn={billingReturn}
      returnTo={
        typeof returnTo === "string" ? safeReturnPath(returnTo) : "/sandboxes/"
      }
      checkoutTeam={typeof checkoutTeam === "string" ? checkoutTeam : undefined}
    />
  )
}
