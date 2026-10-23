import { ChartLineUpIcon } from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "@/components/empty-state"

export default function AdminBillingOverviewPage() {
  return (
    <EmptyState
      icon={ChartLineUpIcon}
      title="Billing overview"
      description="Recurring revenue by plan will appear here."
    />
  )
}
