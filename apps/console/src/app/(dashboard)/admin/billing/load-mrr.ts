import "server-only"
import { unstable_rethrow } from "next/navigation"

import {
  adminBillingRequest,
  AdminBillingRequestError,
} from "@/lib/admin/billing-api"
import { mrrOverviewSchema, type RegionMRR } from "@/lib/admin/billing-mrr"

export async function loadRegionMRR(region: string): Promise<RegionMRR> {
  try {
    return {
      region,
      overview: await adminBillingRequest({
        region,
        path: "/internal/billing/mrr",
        schema: mrrOverviewSchema,
      }),
    }
  } catch (error) {
    unstable_rethrow(error)
    const kind =
      error instanceof AdminBillingRequestError ? error.kind : "unavailable"
    console.error("admin billing MRR request failed", { region, kind })
    return { region, kind }
  }
}
