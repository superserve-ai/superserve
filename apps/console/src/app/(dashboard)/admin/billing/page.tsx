import { combineMRR } from "@/lib/admin/billing-mrr"
import { configuredRegions } from "@/lib/cells"

import { loadRegionMRR } from "./load-mrr"
import { MRROverviewView } from "./mrr-overview"

export default async function AdminBillingOverviewPage() {
  const results = await Promise.all(configuredRegions().map(loadRegionMRR))
  return <MRROverviewView mrr={combineMRR(results)} />
}
