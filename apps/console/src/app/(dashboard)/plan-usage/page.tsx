import { Lightning } from "@phosphor-icons/react/dist/ssr"
import type { Metadata } from "next"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"

export const metadata: Metadata = {
  title: "Plan & Usage",
}

export default function PlanUsagePage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Plan & Usage" />

      <EmptyState
        icon={Lightning}
        title="Free During Preview"
        description="Superserve is free during the preview period. We'll notify you before any pricing changes."
      />
    </div>
  )
}
