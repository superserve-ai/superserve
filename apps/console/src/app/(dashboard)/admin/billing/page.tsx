import { notFound } from "next/navigation"

import {
  adminBillingRequest,
  requireAdminBilling,
} from "@/lib/admin/billing-api"
import { combineMRR, mrrOverviewSchema } from "@/lib/admin/billing-mrr"
import { configuredRegions } from "@/lib/cells"

import { MRROverviewView } from "./mrr-overview"

export default async function AdminBillingOverviewPage() {
  await requireAdminBilling().catch(() => notFound())
  const results = await Promise.all(
    configuredRegions().map(async (region) => ({
      region,
      overview: await adminBillingRequest({
        region,
        path: "/internal/billing/mrr",
        schema: mrrOverviewSchema,
      }).catch(() => null),
    })),
  )
  return <MRROverviewView mrr={combineMRR(results)} />
}
