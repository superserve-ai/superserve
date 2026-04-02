"use client"

import { MagnifyingGlassIcon, TrashIcon } from "@phosphor-icons/react"
import { Button, cn } from "@superserve/ui"

interface FilterTab {
  label: string
  value: string
  count?: number
}

interface TableToolbarProps {
  tabs?: FilterTab[]
  activeTab?: string
  onTabChange?: (value: string) => void
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  selectedCount?: number
  onClearSelection?: () => void
  onDeleteSelected?: () => void
}

export function TableToolbar({
  tabs,
  activeTab,
  onTabChange,
  searchPlaceholder = "Search...",
  searchValue = "",
  onSearchChange,
  selectedCount = 0,
  onClearSelection,
  onDeleteSelected,
}: TableToolbarProps) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2">
      {/* Left side: selection actions or filter tabs */}
      <div className="flex items-center gap-1">
        {selectedCount > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-foreground">
              {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
            >
              Clear
            </button>
            {onDeleteSelected && (
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs"
                onClick={onDeleteSelected}
              >
                <TrashIcon className="size-3" weight="light" />
                Delete
              </Button>
            )}
          </div>
        ) : (
          tabs?.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => onTabChange?.(tab.value)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors cursor-pointer",
                activeTab === tab.value
                  ? "bg-surface-hover text-foreground"
                  : "text-muted hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    "min-w-4 text-center font-mono text-[10px]",
                    activeTab === tab.value ? "text-foreground" : "text-muted",
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 border border-border px-2.5 py-1.5 text-muted focus-within:border-border-focus">
        <MagnifyingGlassIcon className="size-3.5 shrink-0" weight="light" />
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange?.(e.target.value)}
          className="w-40 bg-transparent text-xs text-foreground placeholder:text-muted outline-none"
        />
      </div>
    </div>
  )
}
