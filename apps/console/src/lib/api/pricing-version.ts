import { z } from "zod"

import { ApiError, apiClient } from "./client"

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

export async function fetchPublicPlans(previous?: unknown): Promise<unknown> {
  try {
    return await apiClient<unknown>("/billing/plans/public")
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 404 &&
      pricingVersionOf(previous) !== "v2"
    )
      return {}
    throw error
  }
}
