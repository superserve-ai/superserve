import { PageHeader } from "@/components/page-header"

export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Template" />
      <div className="flex-1 animate-pulse" />
    </div>
  )
}
