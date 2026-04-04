"use client"

import { ClipboardTextIcon } from "@phosphor-icons/react"
import {
  Badge,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableSkeleton } from "@/components/table-skeleton"
import { TableToolbar } from "@/components/table-toolbar"
import { apiClient } from "@/lib/api/client"
import { auditLogKeys } from "@/lib/api/query-keys"
import { formatTime } from "@/lib/format"

type AuditAction = "Create" | "Start" | "Update" | "Pause"
type AuditOutcome = "Success" | "Failure"

interface AuditLog {
  id: string
  time: string
  user: string
  action: AuditAction
  target: string
  outcome: AuditOutcome
}

const OUTCOME_BADGE_VARIANT: Record<AuditOutcome, "success" | "destructive"> = {
  Success: "success",
  Failure: "destructive",
}

const ACTION_TABS = [
  { label: "All", value: "all" },
  { label: "Create", value: "Create" },
  { label: "Start", value: "Start" },
  { label: "Update", value: "Update" },
  { label: "Pause", value: "Pause" },
]

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
  const [actionFilter, setActionFilter] = useState("all")
  const [search, setSearch] = useState("")

  const {
    data: logs,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: auditLogKeys.all,
    queryFn: () => apiClient<AuditLog[]>("/v1/audit-logs"),
  })

  const filtered = useMemo(() => {
    return (logs ?? []).filter((log) => {
      if (actionFilter !== "all" && log.action !== actionFilter) return false
      if (
        search &&
        !log.user.toLowerCase().includes(search.toLowerCase()) &&
        !log.target.toLowerCase().includes(search.toLowerCase())
      )
        return false
      return true
    })
  }, [logs, actionFilter, search])

  const tabs = ACTION_TABS.map((tab) => ({
    ...tab,
    count:
      tab.value === "all"
        ? (logs?.length ?? 0)
        : (logs?.filter((l) => l.action === tab.value).length ?? 0),
  }))

  const isEmpty = (logs?.length ?? 0) === 0

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Audit Logs" />
        <TableSkeleton columns={5} />
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
            activeTab={actionFilter}
            onTabChange={setActionFilter}
            searchPlaceholder="Search by user or target..."
            searchValue={search}
            onSearchChange={setSearch}
          />

          <div className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[22%]">Time</TableHead>
                  <TableHead className="w-[22%]">User</TableHead>
                  <TableHead className="w-[12%]">Action</TableHead>
                  <TableHead className="w-[30%]">Target</TableHead>
                  <TableHead className="w-[14%]">Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <StickyHoverTableBody>
                {filtered.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap">
                      <TimeCell date={new Date(log.time)} />
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {log.user}
                    </TableCell>
                    <TableCell>{log.action}</TableCell>
                    <TableCell className="max-w-48 truncate text-foreground/80">
                      {log.target}
                    </TableCell>
                    <TableCell>
                      <Badge variant={OUTCOME_BADGE_VARIANT[log.outcome]} dot>
                        {log.outcome}
                      </Badge>
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
