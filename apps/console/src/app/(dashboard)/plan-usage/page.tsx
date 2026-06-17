import type { Metadata } from "next"

import { PlanUsagePageClient } from "./page-client"

export const metadata: Metadata = {
  title: "Plan & Usage",
}

export default function PlanUsagePage() {
  return <PlanUsagePageClient />
}
