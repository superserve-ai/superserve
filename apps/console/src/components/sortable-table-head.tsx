"use client"

import {
  CaretDownIcon,
  CaretUpDownIcon,
  CaretUpIcon,
} from "@phosphor-icons/react"
import { cn, TableHead } from "@superserve/ui"

import type { SortDirection } from "@/lib/api/types"

interface SortableTableHeadProps<C extends string> {
  /** Sort column value sent to the API (e.g. "name", "created_at"). */
  column: C
  label: string
  activeSort: string
  order: SortDirection
  onSort: (column: C) => void
  className?: string
}

export function SortableTableHead<C extends string>({
  column,
  label,
  activeSort,
  order,
  onSort,
  className,
}: SortableTableHeadProps<C>) {
  const isActive = activeSort === column

  return (
    <TableHead
      className={cn("p-0", className)}
      // Only the sorted column carries aria-sort, so screen readers announce
      // one sort state per table.
      aria-sort={
        isActive ? (order === "asc" ? "ascending" : "descending") : undefined
      }
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-label={`Sort by ${label}`}
        className={cn(
          "group inline-flex h-10 w-full cursor-pointer items-center gap-1 px-4 font-mono text-xs font-medium tracking-wider uppercase transition-colors focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none focus-visible:ring-inset",
          isActive ? "text-foreground" : "text-muted hover:text-foreground",
        )}
      >
        {label}
        {isActive ? (
          order === "asc" ? (
            <CaretUpIcon
              className="size-3.5 text-brand"
              weight="light"
              aria-hidden
            />
          ) : (
            <CaretDownIcon
              className="size-3.5 text-brand"
              weight="light"
              aria-hidden
            />
          )
        ) : (
          // Visible at rest so sortable columns are discoverable without hover.
          <CaretUpDownIcon
            className="size-3.5 text-control transition-colors group-hover:text-foreground group-focus-visible:text-foreground"
            weight="light"
            aria-hidden
          />
        )}
      </button>
    </TableHead>
  )
}
