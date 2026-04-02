import { Lightning } from "@phosphor-icons/react/dist/ssr"
import type { Metadata } from "next"
import { EmptyState } from "@/components/empty-state"

export const metadata: Metadata = {
  title: "Plan & Usage",
}

export default function PlanUsagePage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center h-14 border-b border-border px-6">
        <h1 className="text-lg font-medium tracking-tight text-foreground">
          Plan & Usage
        </h1>
      </div>

      <EmptyState
        icon={Lightning}
        title="Free During Preview"
        description="Superserve is free during the preview period. We'll notify you before any pricing changes."
      />
    </div>
  )
}
