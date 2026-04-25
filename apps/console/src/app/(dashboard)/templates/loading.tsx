import { PageHeader } from "@/components/page-header"
import { TableSkeleton } from "@/components/table-skeleton"

export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Templates" />
      <TableSkeleton columns={6} tabs={3} />
    </div>
  )
}
