"use client"

import { ClipboardTextIcon } from "@phosphor-icons/react"
import { Table, TableHead, TableHeader, TableRow } from "@superserve/ui"
import { useMemo, useState } from "react"

import {
  ActivityDetailRow,
  ActivitySummaryRow,
} from "@/components/audit/activity-row"
import { DateRangeFilter } from "@/components/date-range-filter"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { useActivity } from "@/hooks/use-activity"

const CATEGORY_TABS = [
  { label: "All", value: "all" },
  { label: "Sandbox", value: "sandbox" },
  { label: "Template", value: "template" },
  { label: "Exec", value: "exec" },
  { label: "Errors", value: "_errors" },
]

export default function AuditLogsPage() {
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [dateRange, setDateRange] = useState<{
    start: Date
    end: Date
  } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: activity, isPending, error, refetch } = useActivity()

  const filtered = useMemo(() => {
    return (activity ?? []).filter((a) => {
      if (dateRange) {
        const created = new Date(a.created_at)
        if (created < dateRange.start || created > dateRange.end) return false
      }
      if (categoryFilter === "_errors" && a.status !== "error") return false
      if (
        categoryFilter !== "all" &&
        categoryFilter !== "_errors" &&
        a.category !== categoryFilter
      )
        return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !a.sandbox_name?.toLowerCase().includes(q) &&
          !a.action.toLowerCase().includes(q) &&
          !a.category.toLowerCase().includes(q)
        )
          return false
      }
      return true
    })
  }, [activity, categoryFilter, search, dateRange])

  // oxlint-disable-next-line no-map-spread -- small static array; clarity > micro-perf
  const tabs = CATEGORY_TABS.map((tab) => ({
    ...tab,
    count:
      tab.value === "all"
        ? (activity?.length ?? 0)
        : tab.value === "_errors"
          ? (activity?.filter((a) => a.status === "error").length ?? 0)
          : (activity?.filter((a) => a.category === tab.value).length ?? 0),
  }))

  const isEmpty = (activity?.length ?? 0) === 0

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Audit Logs" />
        <TableSkeleton columns={6} tabs={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Audit Logs" />
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Audit Logs" />

      {isEmpty ? (
        <EmptyState
          icon={ClipboardTextIcon}
          title="No Activity Yet"
          description="Audit logs will appear here once you start using Superserve."
        />
      ) : (
        <>
          <TableToolbar
            tabs={tabs}
            activeTab={categoryFilter}
            onTabChange={setCategoryFilter}
            filters={
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
            }
            searchPlaceholder="Search by sandbox or action..."
            searchValue={search}
            onSearchChange={setSearch}
          />

          <div className="flex-1 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background/70 backdrop-blur-md">
                <TableRow>
                  <TableHead className="w-[20%]">Time</TableHead>
                  <TableHead className="w-[20%]">Sandbox</TableHead>
                  <TableHead className="w-[12%]">Category</TableHead>
                  <TableHead className="w-[15%]">Action</TableHead>
                  <TableHead className="w-[10%]">Duration</TableHead>
                  <TableHead className="w-[12%]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {filtered.flatMap((log) => {
                  const isOpen = expandedId === log.id
                  const rows = [
                    <ActivitySummaryRow
                      key={log.id}
                      log={log}
                      isOpen={isOpen}
                      onToggle={() =>
                        setExpandedId((prev) =>
                          prev === log.id ? null : log.id,
                        )
                      }
                    />,
                  ]
                  if (isOpen) {
                    rows.push(
                      <ActivityDetailRow key={`${log.id}-detail`} log={log} />,
                    )
                  }
                  return rows
                })}
              </StickyHoverTableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
