"use client"

import { ClipboardTextIcon } from "@phosphor-icons/react"
import {
  Badge,
  type BadgeVariant,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@superserve/ui"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { useActivity } from "@/hooks/use-activity"
import { formatTime } from "@/lib/format"

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  success: "success",
  error: "destructive",
}

const CATEGORY_TABS = [
  { label: "All", value: "all" },
  { label: "Sandbox", value: "sandbox" },
  { label: "Exec", value: "exec" },
  { label: "Errors", value: "_errors" },
]

function formatDuration(ms: number | null): string {
  if (ms === null) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function TimeCell({ date }: { date: Date }) {
  const { relative, absolute } = formatTime(date)
  return (
    <div>
      <span className="text-foreground/80">{relative}</span>
      <span className="ml-2 text-xs text-muted">{absolute}</span>
    </div>
  )
}

export default function AuditLogsPage() {
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [search, setSearch] = useState("")

  const { data: activity, isPending, error, refetch } = useActivity()

  const filtered = useMemo(() => {
    return (activity ?? []).filter((a) => {
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
  }, [activity, categoryFilter, search])

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
            searchPlaceholder="Search by sandbox or action..."
            searchValue={search}
            onSearchChange={setSearch}
          />

          <div className="flex-1 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
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
                {filtered.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap">
                      <TimeCell date={new Date(log.created_at)} />
                    </TableCell>
                    <TableCell className="font-mono text-foreground/80">
                      {log.sandbox_name ?? "-"}
                    </TableCell>
                    <TableCell className="text-muted capitalize">
                      {log.category}
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {log.action}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted">
                      {formatDuration(log.duration_ms)}
                    </TableCell>
                    <TableCell>
                      {log.status ? (
                        log.error ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Badge
                                  variant={
                                    STATUS_VARIANT[log.status] ?? "muted"
                                  }
                                  dot
                                  className="cursor-default"
                                />
                              }
                            >
                              {log.status}
                            </TooltipTrigger>
                            <TooltipPopup className="max-w-xs text-xs">
                              {log.error}
                            </TooltipPopup>
                          </Tooltip>
                        ) : (
                          <Badge
                            variant={STATUS_VARIANT[log.status] ?? "muted"}
                            dot
                          >
                            {log.status}
                          </Badge>
                        )
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </StickyHoverTableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
