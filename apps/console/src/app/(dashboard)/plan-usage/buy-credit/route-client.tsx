"use client"

import { Spinner } from "@superserve/ui"

import { usePricingVersion } from "@/hooks/use-pricing-version"

import { PlanUsagePageClient } from "../page-client"
import { BuyCreditPageClient } from "./page-client"

export function BuyCreditRoute() {
  const version = usePricingVersion()
  if (version === undefined) return <Spinner />
  return version === "v2" ? <BuyCreditPageClient /> : <PlanUsagePageClient />
}
