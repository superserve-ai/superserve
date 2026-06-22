"use client"

import { CaretDownIcon } from "@phosphor-icons/react"
import {
  Badge,
  cn,
  TableCell,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@superserve/ui"
import { motion } from "motion/react"

import { AnimatedTableRow } from "@/components/animated-table-row"
import type { ActivityResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"
import { ACTIVITY_STATUS_VARIANT, formatDuration } from "@/lib/sandbox-utils"

import { ActivityDetail } from "./activity-detail"

interface ActivitySummaryRowProps {
  log: ActivityResponse
  isOpen: boolean
  onToggle: () => void
}

export function ActivitySummaryRow({
  log,
  isOpen,
  onToggle,
}: ActivitySummaryRowProps) {
  const { relative, absolute } = formatTime(new Date(log.created_at))

  return (
    <AnimatedTableRow onClick={onToggle} className="cursor-pointer">
      <TableCell className="whitespace-nowrap">
        <div className="flex items-center gap-2 tabular-nums">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={isOpen ? "Collapse details" : "Expand details"}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            className="-m-1 cursor-pointer p-1 text-muted transition-colors hover:text-foreground"
          >
            <CaretDownIcon
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                isOpen ? "" : "-rotate-90",
              )}
              weight="light"
            />
          </button>
          <span className="text-foreground/80">{relative}</span>
          <span className="text-xs text-muted">{absolute}</span>
        </div>
      </TableCell>
      <TableCell className="font-mono text-foreground/80">
        {log.sandbox_name ?? log.secret_name ?? "-"}
      </TableCell>
      <TableCell className="text-muted capitalize">{log.category}</TableCell>
      <TableCell className="text-foreground/80">{log.action}</TableCell>
      <TableCell className="font-mono text-xs text-muted tabular-nums">
        {formatDuration(log.duration_ms)}
      </TableCell>
      <TableCell>
        {log.status ? (
          log.error ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Badge
                    variant={ACTIVITY_STATUS_VARIANT[log.status] ?? "muted"}
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
            <Badge variant={ACTIVITY_STATUS_VARIANT[log.status] ?? "muted"} dot>
              {log.status}
            </Badge>
          )
        ) : (
          <span className="text-muted">-</span>
        )}
      </TableCell>
    </AnimatedTableRow>
  )
}

// Plain motion.tr (NO `layout`) so the inner height animation never fights a
// layout projection. `data-detail-row` tells StickyHoverTableBody to keep the
// hover indicator on summary rows only.
export function ActivityDetailRow({ log }: { log: ActivityResponse }) {
  return (
    <motion.tr data-detail-row="true">
      <TableCell colSpan={6} className="p-0">
        <motion.div
          className="overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { type: "spring", bounce: 0.15, duration: 0.4 },
            opacity: { duration: 0.15, ease: "easeInOut" },
          }}
        >
          <ActivityDetail log={log} />
        </motion.div>
      </TableCell>
    </motion.tr>
  )
}
