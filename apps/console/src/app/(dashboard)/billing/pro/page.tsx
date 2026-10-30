import type { Metadata } from "next"

import { safeReturnPath } from "@/lib/billing/return-path"

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
  return (
    <ProPayment
      billingReturn={
        billing === "success" || billing === "cancel" ? billing : undefined
      }
      returnTo={
        typeof returnTo === "string" ? safeReturnPath(returnTo) : "/sandboxes/"
      }
      checkoutTeam={typeof checkoutTeam === "string" ? checkoutTeam : undefined}
    />
  )
}
