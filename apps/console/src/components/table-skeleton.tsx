"use client"

import { cn } from "@superserve/ui"

interface TableSkeletonProps {
  columns: number
  rows?: number
  tabs?: number
}

export function TableSkeleton({
  columns,
  rows = 5,
  tabs = 0,
}: TableSkeletonProps) {
  return (
    <div className="flex-1">
      {/* Toolbar skeleton */}
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-1">
          {tabs > 0 ? (
            Array.from({ length: tabs }).map((_, i) => (
              <div
                key={`tab-${i}`}
                className={cn(
                  "h-6 animate-pulse bg-surface-hover",
                  i === 0 ? "w-12" : "w-14",
                )}
              />
            ))
          ) : (
            <div className="h-6 w-20" />
          )}
        </div>
        <div className="h-8 w-48 animate-pulse bg-surface-hover" />
      </div>

      {/* Table header skeleton */}
      <div className="flex h-10 items-center gap-4 border-b border-border px-4">
        {Array.from({ length: columns }).map((_, i) => (
          <div
            key={`header-${i}`}
            className={cn(
              "h-2.5 animate-pulse bg-surface-hover",
              i === 0 ? "w-5" : "w-16",
              i > 0 && "flex-1 max-w-20",
            )}
          />
        ))}
      </div>

      {/* Row skeletons */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={`row-${rowIndex}`}
          className="flex items-center gap-4 border-b border-border px-4 py-3"
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div
              key={`cell-${rowIndex}-${colIndex}`}
              className={cn(
                "h-3 animate-pulse bg-surface-hover",
                colIndex === 0 ? "w-5" : "flex-1",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
