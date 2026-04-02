"use client"

import { ClipboardTextIcon } from "@phosphor-icons/react"
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import { useMemo, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { TableToolbar } from "@/components/table-toolbar"

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

const OUTCOME_COLORS: Record<AuditOutcome, string> = {
  Success: "bg-success",
  Failure: "bg-destructive",
}

function formatTime(date: Date): { relative: string; absolute: string } {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)

  let relative: string
  if (diffMin < 1) relative = "Just now"
  else if (diffMin < 60) relative = `${diffMin}m ago`
  else if (diffHr < 24) relative = `${diffHr}h ago`
  else if (diffDays < 7) relative = `${diffDays}d ago`
  else
    relative = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })

  const absolute = date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

  return { relative, absolute }
}

const MOCK_AUDIT_LOGS: AuditLog[] = [
  {
    id: "1",
    time: new Date(Date.now() - 1 * 60 * 60 * 1000),
    user: "jeetninejak@gmail.com",
    action: "Create",
    target: "sandbox / dc703f84-a11e-43bf-90c...",
    outcome: "Success",
  },
  {
    id: "2",
    time: new Date(Date.now() - 2 * 60 * 60 * 1000),
    user: "jeetninejak@gmail.com",
    action: "Start",
    target: "dc703f84-a11e-43bf-90db-af2f8a4...",
    outcome: "Success",
  },
  {
    id: "3",
    time: new Date(Date.now() - 5 * 60 * 60 * 1000),
    user: "jeetninejak@gmail.com",
    action: "Update",
    target: "api_key / first-project",
    outcome: "Success",
  },
  {
    id: "4",
    time: new Date(Date.now() - 24 * 60 * 60 * 1000),
    user: "jeetninejak@gmail.com",
    action: "Create",
    target: "organization / 5dec2f6f-7e57-4668...",
    outcome: "Success",
  },
  {
    id: "5",
    time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    user: "jeetninejak@gmail.com",
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
      <div className="flex items-center justify-between h-14 border-b border-border px-6">
        <h1 className="text-lg font-medium tracking-tight text-foreground">
          Audit Logs
        </h1>
      </div>

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
                      {(() => {
                        const { relative, absolute } = formatTime(log.time)
                        return (
                          <div>
                            <span className="text-foreground/80">
                              {relative}
                            </span>
                            <span className="ml-2 text-xs text-muted">
                              {absolute}
                            </span>
                          </div>
                        )
                      })()}
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {log.user}
                    </TableCell>
                    <TableCell>{log.action}</TableCell>
                    <TableCell className="max-w-48 truncate text-foreground/80">
                      {log.target}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span
                          className={`size-2.5 ${OUTCOME_COLORS[log.outcome]}`}
                        />
                        {log.outcome}
                      </span>
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
