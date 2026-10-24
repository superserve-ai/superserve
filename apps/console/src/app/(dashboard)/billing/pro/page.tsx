import type { Metadata } from "next"

import { safeReturnPath } from "@/lib/billing/return-path"

import { ProPayment } from "./pro-payment"

export const metadata: Metadata = {
  title: "Upgrade to Pro",
}

export default async function ProPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string; return?: string; team?: string }>
}) {
  const { billing, return: returnTo, team: checkoutTeam } = await searchParams
  return (
    <ProPayment
      billingReturn={
        billing === "success" || billing === "cancel" ? billing : undefined
      }
      returnTo={safeReturnPath(returnTo)}
      checkoutTeam={checkoutTeam}
    />
  )
}
