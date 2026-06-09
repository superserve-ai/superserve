"use client"

import { ShieldCheckIcon } from "@phosphor-icons/react"
import type { BadgeVariant } from "@superserve/ui"
import {
  Badge,
  Button,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@superserve/ui"
import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import type { AuditStatusFilter, ProxyAuditEvent } from "@/lib/api/types"
import { formatTime } from "@/lib/format"

const STATUS_FILTERS: { value: AuditStatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "2xx", label: "2xx" },
  { value: "3xx", label: "3xx" },
  { value: "4xx", label: "4xx" },
  { value: "5xx", label: "5xx" },
  { value: "errors", label: "Errors" },
]

function statusVariant(status: number): BadgeVariant {
  if (status >= 200 && status < 300) return "success"
  if (status >= 300 && status < 400) return "muted"
  if (status >= 400 && status < 500) return "warning"
  return "destructive"
}

interface AuditLogTableProps {
  title: string
  events: ProxyAuditEvent[] | undefined
  isPending: boolean
  statusFilter: AuditStatusFilter
  onStatusFilterChange: (filter: AuditStatusFilter) => void
  showSandboxColumn?: boolean
  emptyDescription?: string
  hasMore?: boolean
  isFetchingMore?: boolean
  onLoadMore?: () => void
}

export function AuditLogTable({
  title,
  events,
  isPending,
  statusFilter,
  onStatusFilterChange,
  showSandboxColumn,
  emptyDescription = "Requests made with an attached secret appear here.",
  hasMore,
  isFetchingMore,
  onLoadMore,
}: AuditLogTableProps) {
  return (
    <>
      <div className="flex h-10 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Select
          value={statusFilter}
          onValueChange={(v) => onStatusFilterChange(v as AuditStatusFilter)}
        >
          <SelectTrigger
            className="h-7 w-24 text-xs"
            aria-label="Filter by status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {isPending ? (
        <div className="border-b border-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-6 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="h-3 w-24 animate-pulse bg-muted/20" />
              <div className="h-3 w-10 animate-pulse bg-muted/20" />
              <div className="h-3 w-32 animate-pulse bg-muted/20" />
              <div className="h-3 w-20 animate-pulse bg-muted/20" />
            </div>
          ))}
        </div>
      ) : !events || events.length === 0 ? (
        <div className="border-b border-border py-10">
          <EmptyState
            icon={ShieldCheckIcon}
            title={statusFilter ? "No matching requests" : "No requests yet"}
            description={
              statusFilter
                ? "No requests match this status filter."
                : emptyDescription
            }
          />
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto border-b border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[20%]">Time</TableHead>
                {showSandboxColumn && (
                  <TableHead className="w-[14%]">Sandbox</TableHead>
                )}
                <TableHead className="w-[8%]">Method</TableHead>
                <TableHead className="w-[18%]">Host</TableHead>
                <TableHead className="w-[24%]">Path</TableHead>
                <TableHead className="w-[8%]">Status</TableHead>
                <TableHead className="w-[8%] text-right">Latency</TableHead>
              </TableRow>
            </TableHeader>
            <StickyHoverTableBody>
              {events.map((event) => {
                const { relative, absolute } = formatTime(new Date(event.ts))
                return (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <span className="text-foreground/80">{relative}</span>
                      <span className="ml-2 text-xs text-muted">
                        {absolute}
                      </span>
                    </TableCell>
                    {showSandboxColumn && (
                      <TableCell className="max-w-0 truncate">
                        {event.sandbox_name ? (
                          <Link
                            href={`/sandboxes/${event.sandbox_id}`}
                            className="text-foreground/80 underline-offset-2 hover:underline"
                          >
                            {event.sandbox_name}
                          </Link>
                        ) : (
                          <span className="text-muted">(deleted sandbox)</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs text-foreground/80">
                      {event.method}
                    </TableCell>
                    <TableCell
                      className="max-w-0 truncate font-mono text-xs text-muted"
                      title={event.host}
                    >
                      {event.host}
                    </TableCell>
                    <TableCell
                      className="max-w-0 truncate font-mono text-xs text-muted"
                      title={event.path}
                    >
                      {event.path}
                    </TableCell>
                    <TableCell>
                      {event.error_code ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Badge
                                variant={statusVariant(event.status)}
                                className="cursor-default"
                              />
                            }
                          >
                            {event.status}
                          </TooltipTrigger>
                          <TooltipPopup className="max-w-xs text-xs">
                            {event.error_code}
                          </TooltipPopup>
                        </Tooltip>
                      ) : (
                        <Badge variant={statusVariant(event.status)}>
                          {event.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted tabular-nums">
                      {event.latency_ms != null ? `${event.latency_ms}ms` : "—"}
                    </TableCell>
                  </TableRow>
                )
              })}
            </StickyHoverTableBody>
          </Table>
          {hasMore && onLoadMore && (
            <div className="flex justify-center border-t border-border py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onLoadMore}
                disabled={isFetchingMore}
              >
                {isFetchingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
