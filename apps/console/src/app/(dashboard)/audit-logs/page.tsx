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
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableToolbar } from "@/components/table-toolbar"
import { formatTime } from "@/lib/format"

type AuditAction = "Create" | "Start" | "Update"
type AuditOutcome = "Success" | "Failure"

interface AuditLog {
  id: string
  time: Date
  user: string
  action: AuditAction
  target: string
  outcome: AuditOutcome
}

const OUTCOME_BADGE_VARIANT: Record<AuditOutcome, "success" | "destructive"> = {
  Success: "success",
  Failure: "destructive",
}

const MOCK_AUDIT_LOGS: AuditLog[] = [
  {
    id: "1",
    time: new Date(Date.now() - 1 * 60 * 60 * 1000),
    user: "user@example.com",
    action: "Create",
    target: "sandbox / dc703f84-a11e-43bf-90c...",
    outcome: "Success",
  },
  {
    id: "2",
    time: new Date(Date.now() - 2 * 60 * 60 * 1000),
    user: "user@example.com",
    action: "Start",
    target: "dc703f84-a11e-43bf-90db-af2f8a4...",
    outcome: "Success",
  },
  {
    id: "3",
    time: new Date(Date.now() - 5 * 60 * 60 * 1000),
    user: "user@example.com",
    action: "Update",
    target: "api_key / first-project",
    outcome: "Success",
  },
  {
    id: "4",
    time: new Date(Date.now() - 24 * 60 * 60 * 1000),
    user: "user@example.com",
    action: "Create",
    target: "organization / 5dec2f6f-7e57-4668...",
    outcome: "Success",
  },
  {
    id: "5",
    time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    user: "user@example.com",
    action: "Start",
    target: "sandbox / dc703f84-a11e-43bf-90c...",
    outcome: "Failure",
  },
]

const ACTION_TABS = [
  { label: "All", value: "all" },
  { label: "Create", value: "Create" },
  { label: "Start", value: "Start" },
  { label: "Update", value: "Update" },
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
  const [logs] = useState<AuditLog[]>(MOCK_AUDIT_LOGS)
  const [actionFilter, setActionFilter] = useState("all")
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    return logs.filter((log) => {
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
        ? logs.length
        : logs.filter((l) => l.action === tab.value).length,
  }))

  const isEmpty = logs.length === 0

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
                      <TimeCell date={log.time} />
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
