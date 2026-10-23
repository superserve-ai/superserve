import { z } from "zod"

import { apiClient } from "./client"

export type PricingVersion = "legacy" | "v2"

const publicPlansSchema = z.object({
  pricing_version: z.unknown().optional(),
})

export function pricingVersionOf(body: unknown): PricingVersion {
  const parsed = publicPlansSchema.safeParse(body)
  return parsed.success && parsed.data.pricing_version === "v2"
    ? "v2"
    : "legacy"
}

export function fetchPublicPlans(): Promise<unknown> {
  return apiClient<unknown>("/billing/plans/public")
}
