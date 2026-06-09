"use client"

import { cn, Skeleton } from "@superserve/ui"

import type { ProviderShortcut } from "@/lib/api/types"

import { AUTH_TYPE_LABEL } from "./auth-type-label"

interface ProviderPickerProps {
  providers: ProviderShortcut[] | undefined
  isPending: boolean
  value: string | null
  onSelect: (provider: ProviderShortcut) => void
}

export function ProviderPicker({
  providers,
  isPending,
  value,
  onSelect,
}: ProviderPickerProps) {
  if (isPending) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[52px] w-full" />
        ))}
      </div>
    )
  }

  if (!providers?.length) {
    return (
      <p className="text-xs text-muted">No provider shortcuts available.</p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {providers.map((p) => {
        const active = value === p.name
        const hostHint =
          p.hosts.length > 1
            ? `${p.hosts[0]} +${p.hosts.length - 1}`
            : p.hosts[0]
        return (
          <button
            key={p.name}
            type="button"
            onClick={() => onSelect(p)}
            className={cn(
              "cursor-pointer border border-dashed px-3 py-2 text-left transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted hover:border-foreground/50 hover:text-foreground",
            )}
          >
            <span className="block text-xs font-medium">{p.display}</span>
            <span
              className={cn(
                "block truncate font-mono text-[10px]",
                active ? "text-background/70" : "text-muted",
              )}
            >
              {AUTH_TYPE_LABEL[p.auth_type]} · {hostHint}
            </span>
          </button>
        )
      })}
    </div>
  )
}
