"use client"

import type { Icon } from "@phosphor-icons/react"
import {
  CameraIcon,
  ChartBarIcon,
  ClipboardTextIcon,
  CubeIcon,
  GearIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  RocketLaunchIcon,
} from "@phosphor-icons/react"
import { Command } from "cmdk"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

interface CommandPaletteProps {
  onCreateSandbox?: () => void
}

interface CommandItem {
  label: string
  icon: Icon
  onSelect: () => void
}

export function CommandPalette({ onCreateSandbox }: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const navigate = useCallback(
    (path: string) => {
      router.push(path)
      setOpen(false)
    },
    [router],
  )

  const navigationItems: CommandItem[] = [
    {
      label: "Sandboxes",
      icon: CubeIcon,
      onSelect: () => navigate("/sandboxes"),
    },
    {
      label: "Snapshots",
      icon: CameraIcon,
      onSelect: () => navigate("/snapshots"),
    },
    {
      label: "Audit Logs",
      icon: ClipboardTextIcon,
      onSelect: () => navigate("/audit-logs"),
    },
    {
      label: "API Keys",
      icon: KeyIcon,
      onSelect: () => navigate("/api-keys"),
    },
    {
      label: "Plan & Usage",
      icon: ChartBarIcon,
      onSelect: () => navigate("/plan-usage"),
    },
    {
      label: "Settings",
      icon: GearIcon,
      onSelect: () => navigate("/settings"),
    },
    {
      label: "Get Started",
      icon: RocketLaunchIcon,
      onSelect: () => navigate("/get-started"),
    },
  ]

  const actionItems: CommandItem[] = [
    {
      label: "Create Sandbox",
      icon: PlusIcon,
      onSelect: () => {
        setOpen(false)
        onCreateSandbox?.()
      },
    },
    {
      label: "Create API Key",
      icon: KeyIcon,
      onSelect: () => navigate("/api-keys"),
    },
  ]

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="fixed inset-0 z-50"
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />
      <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 border border-dashed border-border bg-surface shadow-lg">
        <div className="flex items-center gap-2.5 border-b border-dashed border-border px-3">
          <MagnifyingGlassIcon
            className="size-4 shrink-0 text-muted"
            weight="light"
          />
          <Command.Input
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-muted"
          />
        </div>
        <Command.List className="max-h-72 overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted">
            No results found.
          </Command.Empty>

          <Command.Group
            heading="Navigation"
            className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted"
          >
            {navigationItems.map((item) => (
              <Command.Item
                key={item.label}
                onSelect={item.onSelect}
                className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-foreground transition-colors data-[selected=true]:bg-foreground/5"
              >
                <item.icon className="size-4 shrink-0" weight="light" />
                <span>{item.label}</span>
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Separator className="mx-2.5 my-1.5 h-px bg-border" />

          <Command.Group
            heading="Actions"
            className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted"
          >
            {actionItems.map((item) => (
              <Command.Item
                key={item.label}
                onSelect={item.onSelect}
                className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-foreground transition-colors data-[selected=true]:bg-foreground/5"
              >
                <item.icon className="size-4 shrink-0" weight="light" />
                <span>{item.label}</span>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  )
}
