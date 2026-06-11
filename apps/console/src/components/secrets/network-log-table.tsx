"use client"

import { GlobeIcon } from "@phosphor-icons/react"
import type { BadgeVariant } from "@superserve/ui"
import {
  Badge,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@superserve/ui"

import { EmptyState } from "@/components/empty-state"
import { StickyHoverTableBody } from "@/components/sticky-hover-table"
import { NETWORK_PAGE_SIZE } from "@/hooks/use-network"
import type { NetworkEvent } from "@/lib/api/types"
import { formatTime } from "@/lib/format"
import { formatBytes } from "@/lib/sandbox-utils"

function statusVariant(status: number): BadgeVariant {
  if (status >= 200 && status < 300) return "success"
  if (status >= 300 && status < 400) return "muted"
  if (status >= 400 && status < 500) return "warning"
  return "destructive"
}

const VERDICT_VARIANT: Record<string, BadgeVariant> = {
  allowed: "success",
  blocked: "destructive",
  failed: "warning",
}

interface NetworkLogTableProps {
  title: string
  events: NetworkEvent[] | undefined
  isPending: boolean
  hasMore?: boolean
}

export function NetworkLogTable({
  title,
  events,
  isPending,
  hasMore,
}: NetworkLogTableProps) {
  return (
    <>
      <div className="flex h-10 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {isPending ? (
        <div className="border-b border-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-6 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="h-3 w-24 animate-pulse bg-muted/20" />
              <div className="h-3 w-32 animate-pulse bg-muted/20" />
              <div className="h-3 w-20 animate-pulse bg-muted/20" />
              <div className="h-3 w-12 animate-pulse bg-muted/20" />
            </div>
          ))}
        </div>
      ) : !events || events.length === 0 ? (
        <div className="border-b border-border py-10">
          <EmptyState
            icon={GlobeIcon}
            title="No network activity yet"
            description="Outbound connections this sandbox makes appear here."
          />
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto border-b border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[20%]">Time</TableHead>
                <TableHead className="w-[24%]">Host</TableHead>
                <TableHead className="w-[32%]">Detail</TableHead>
                <TableHead className="w-[12%]">Result</TableHead>
                <TableHead className="w-[12%] text-right">Size</TableHead>
              </TableRow>
            </TableHeader>
            <StickyHoverTableBody>
              {events.map((event) => (
                <TableRow key={`${event.kind}-${event.id}`}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    <NetworkTime ts={event.ts} />
                  </TableCell>
                  <TableCell
                    className="max-w-0 truncate font-mono text-xs text-muted"
                    title={event.host || event.dst_ip || undefined}
                  >
                    {event.host || event.dst_ip || "—"}
                  </TableCell>
                  <TableCell className="max-w-0 truncate font-mono text-xs">
                    <NetworkDetail event={event} />
                  </TableCell>
                  <TableCell>
                    <NetworkResult event={event} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted tabular-nums">
                    <NetworkMetric event={event} />
                  </TableCell>
                </TableRow>
              ))}
            </StickyHoverTableBody>
          </Table>
          {hasMore && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted">
              Showing the {NETWORK_PAGE_SIZE} most recent events. Use the API
              for the full log.
            </p>
          )}
        </div>
      )}
    </>
  )
}

function NetworkTime({ ts }: { ts: string }) {
  const { relative, absolute } = formatTime(new Date(ts))
  return (
    <>
      <span className="text-foreground/80">{relative}</span>
      <span className="ml-2 text-xs text-muted">{absolute}</span>
    </>
  )
}

function NetworkDetail({ event }: { event: NetworkEvent }) {
  if (event.kind === "request") {
    return (
      <>
        <span className="text-foreground/80">{event.method}</span>{" "}
        <span className="text-muted">{event.path}</span>
      </>
    )
  }
  return <span className="text-muted">connection</span>
}

function NetworkResult({ event }: { event: NetworkEvent }) {
  if (event.kind === "request" && event.status != null) {
    const badge = (
      <Badge variant={statusVariant(event.status)} className="cursor-default">
        {event.status}
      </Badge>
    )
    if (event.error_code) {
      return (
        <Tooltip>
          <TooltipTrigger render={badge}>{event.status}</TooltipTrigger>
          <TooltipPopup className="max-w-xs text-xs">
            {event.error_code}
          </TooltipPopup>
        </Tooltip>
      )
    }
    return badge
  }
  if (event.verdict) {
    const badge = (
      <Badge
        variant={VERDICT_VARIANT[event.verdict] ?? "muted"}
        className="cursor-default capitalize"
      >
        {event.verdict}
      </Badge>
    )
    if (event.match_rule) {
      return (
        <Tooltip>
          <TooltipTrigger render={badge}>{event.verdict}</TooltipTrigger>
          <TooltipPopup className="max-w-xs text-xs">
            {event.match_rule}
          </TooltipPopup>
        </Tooltip>
      )
    }
    return badge
  }
  return <span className="text-muted">—</span>
}

function NetworkMetric({ event }: { event: NetworkEvent }) {
  if (event.kind === "request") {
    return <>{event.latency_ms != null ? `${event.latency_ms}ms` : "—"}</>
  }
  const total = (event.bytes_sent ?? 0) + (event.bytes_recv ?? 0)
  return <>{total > 0 ? formatBytes(total) : "—"}</>
}
