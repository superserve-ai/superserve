"use server"

import { cellFor, DEFAULT_REGION } from "@/lib/cells"

import {
  publicBillingPlansSchema,
  type PricingVersion,
  type PublicBillingPlans,
} from "./plans"

export async function getPublicBillingPlansAction(
  region: string = DEFAULT_REGION,
): Promise<PublicBillingPlans> {
  const cell = cellFor(region)
  const response = await fetch(
    new URL("/billing/plans/public", cell.apiBaseUrl),
    { next: { revalidate: 60 }, signal: AbortSignal.timeout(2000) },
  )
  if (!response.ok) throw new Error("Plans are unavailable")
  return publicBillingPlansSchema.parse(await response.json())
}

export async function getPricingVersionAction(
  region: string = DEFAULT_REGION,
): Promise<PricingVersion> {
  try {
    return (await getPublicBillingPlansAction(region)).pricing_version
  } catch {
    return "legacy"
  }
}
