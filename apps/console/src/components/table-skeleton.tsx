"use client"

import { cn } from "@superserve/ui"

interface TableSkeletonProps {
  columns: number
  rows?: number
}

export function TableSkeleton({ columns, rows = 5 }: TableSkeletonProps) {
  return (
    <div className="flex-1">
      {/* Header skeleton */}
      <div className="flex items-center gap-4 border-b border-border px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <div
            key={`header-${i}`}
            className={cn(
              "h-3 animate-pulse rounded bg-surface-hover",
              i === 0 ? "w-8" : "flex-1",
            )}
          />
        ))}
      </div>
      {/* Row skeletons */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={`row-${rowIndex}`}
          className="flex items-center gap-4 border-b border-border px-4 py-4"
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div
              key={`cell-${rowIndex}-${colIndex}`}
              className={cn(
                "h-3 animate-pulse rounded bg-surface-hover",
                colIndex === 0 ? "w-8" : "flex-1",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
