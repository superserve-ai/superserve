"use client"

import { MagnifyingGlassIcon, TrashIcon } from "@phosphor-icons/react"
import { Button, cn } from "@superserve/ui"
import { motion } from "motion/react"
import { useState } from "react"
import { CornerBrackets } from "./corner-brackets"

interface FilterTab {
  label: string
  value: string
  count?: number
}

interface TableToolbarProps {
  id?: string
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
  id = "toolbar",
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
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)

  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2">
      {/* Left side: selection actions or filter tabs */}
      <nav
        className="flex items-center gap-1"
        onMouseLeave={() => setHoveredTab(null)}
      >
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
          tabs?.map((tab) => {
            const isActive = activeTab === tab.value
            const isHovered = hoveredTab === tab.value

            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onTabChange?.(tab.value)}
                onMouseEnter={() => setHoveredTab(tab.value)}
                className={cn(
                  "relative inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors cursor-pointer",
                  isActive
                    ? "text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {isHovered && (
                  <motion.span
                    className="absolute inset-0 bg-foreground/4"
                    layoutId={`${id}-hover`}
                    transition={{
                      type: "spring",
                      bounce: 0.15,
                      duration: 0.4,
                    }}
                  />
                )}
                {isActive && !hoveredTab && (
                  <span className="absolute inset-0 bg-foreground/4" />
                )}
                {isActive && (
                  <motion.span
                    className="absolute inset-0 pointer-events-none"
                    layoutId={`${id}-active`}
                    transition={{
                      type: "spring",
                      bounce: 0.15,
                      duration: 0.5,
                    }}
                  >
                    <CornerBrackets size="sm" />
                  </motion.span>
                )}
                <span className="relative">{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={cn(
                      "relative min-w-4 text-center font-mono text-[10px]",
                      isActive ? "text-foreground" : "text-muted",
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })
        )}
      </nav>

      {/* Search */}
      <div className="flex items-center gap-2 border border-border px-2.5 py-1.5 text-muted focus-within:border-border-focus">
        <MagnifyingGlassIcon className="size-3.5 shrink-0" weight="light" />
        <input
          type="text"
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange?.(e.target.value)}
          className="w-40 bg-transparent text-xs text-foreground placeholder:text-muted outline-none"
        />
      </div>
    </div>
  )
}
