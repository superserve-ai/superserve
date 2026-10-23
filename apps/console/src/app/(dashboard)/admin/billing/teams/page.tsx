import { UsersIcon } from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "@/components/empty-state"

export default function AdminBillingTeamsPage() {
  return (
    <EmptyState
      icon={UsersIcon}
      title="Team billing"
      description="Team plans and billing details will appear here."
    />
  )
}
