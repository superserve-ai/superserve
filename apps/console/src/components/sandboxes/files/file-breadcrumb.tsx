"use client"

import { CaretRightIcon, HouseIcon } from "@phosphor-icons/react"

import { pathSegments } from "@/lib/api/files"

interface FileBreadcrumbProps {
  path: string
  onNavigate: (path: string) => void
}

/**
 * Clickable path breadcrumb: root icon + each path segment. The final segment
 * is the current directory (not clickable); earlier segments navigate up.
 */
export function FileBreadcrumb({ path, onNavigate }: FileBreadcrumbProps) {
  const segments = pathSegments(path)

  return (
    <nav
      aria-label="File path"
      className="flex min-w-0 items-center gap-1 overflow-x-auto font-mono text-xs"
    >
      <button
        type="button"
        onClick={() => onNavigate("/")}
        aria-label="Root"
        className="shrink-0 text-muted hover:text-foreground"
      >
        <HouseIcon className="size-3.5" weight="light" />
      </button>
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1
        return (
          <span key={seg.path} className="flex shrink-0 items-center gap-1">
            <CaretRightIcon className="size-3 text-muted" weight="light" />
            <button
              type="button"
              onClick={() => onNavigate(seg.path)}
              disabled={isLast}
              className={
                isLast ? "text-foreground" : "text-muted hover:text-foreground"
              }
            >
              {seg.name}
            </button>
          </span>
        )
      })}
    </nav>
  )
}
