"use server"

import { cellFor, configuredRegions, DEFAULT_REGION } from "@/lib/cells"

import { publicBillingPlansSchema, type PublicBillingPlans } from "./plans"

export async function getPublicBillingPlansAction(
  region: string = DEFAULT_REGION,
): Promise<PublicBillingPlans> {
  const cell = configuredRegions().includes(region)
    ? cellFor(region)
    : cellFor(DEFAULT_REGION)
  const response = await fetch(
    new URL("/billing/plans/public", cell.apiBaseUrl),
    { next: { revalidate: 300 }, signal: AbortSignal.timeout(2000) },
  )
  if (!response.ok) throw new Error("Plans are unavailable")
  return publicBillingPlansSchema.parse(await response.json())
}
