import { TagIcon } from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "@/components/empty-state"

export default function AdminBillingPlansPage() {
  return (
    <EmptyState
      icon={TagIcon}
      title="Plans & pricing"
      description="The plan catalog will appear here."
    />
  )
}
