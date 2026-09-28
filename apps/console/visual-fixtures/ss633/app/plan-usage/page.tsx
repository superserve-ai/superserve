"use client"

import { CustomerBillingSection } from "@/components/customer-billing-section"
import { useBillingSummary } from "@/hooks/use-billing-summary"

export default function Page() {
  const summary = useBillingSummary()
  if (!summary.data) return <p>Loading billing summary…</p>
  return (
    <main className="mx-auto max-w-5xl p-8">
      <CustomerBillingSection
        teamId="visual-team"
        teamRegion="use"
        teamName="Visual Fixture Team"
        summary={summary.data}
      />
    </main>
  )
}
