import type { Metadata } from "next"

import { PlanSelectionLoader } from "@/components/onboarding/plan-selection-loader"

export const metadata: Metadata = {
  title: "Choose your plan | Superserve",
  robots: { index: false, follow: false },
}

export default async function PlanSelectionPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string; team?: string; account?: string }>
}) {
  const params = await searchParams
  return (
    <PlanSelectionLoader
      billingReturn={params.billing}
      expectedTeam={params.team}
      expectedUser={params.account}
    />
  )
}
