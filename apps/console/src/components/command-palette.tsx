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
import { AnimatePresence, motion } from "motion/react"
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
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null)
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
    <AnimatePresence>
      {open && (
        <Command.Dialog
          open={open}
          onOpenChange={setOpen}
          label="Command palette"
          className="fixed inset-0 z-50"
          forceMount
        >
          <motion.div
            className="fixed inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg border border-dashed border-border bg-surface shadow-lg"
            initial={{ opacity: 0, x: "-50%", scale: 0.96 }}
            animate={{ opacity: 1, x: "-50%", scale: 1 }}
            exit={{ opacity: 0, x: "-50%", scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
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
            <Command.List
              className="max-h-72 overflow-y-auto p-1.5"
              onMouseLeave={() => setHoveredLabel(null)}
            >
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
                    onMouseEnter={() => setHoveredLabel(item.label)}
                    className="relative flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-foreground"
                  >
                    {hoveredLabel === item.label && (
                      <motion.span
                        className="absolute inset-0 rounded-sm bg-foreground/5"
                        layoutId="cmd-hover"
                        transition={{
                          type: "spring",
                          bounce: 0.15,
                          duration: 0.4,
                        }}
                      />
                    )}
                    <item.icon
                      className="relative size-4 shrink-0"
                      weight="light"
                    />
                    <span className="relative">{item.label}</span>
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
                    onMouseEnter={() => setHoveredLabel(item.label)}
                    className="relative flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-foreground"
                  >
                    {hoveredLabel === item.label && (
                      <motion.span
                        className="absolute inset-0 rounded-sm bg-foreground/5"
                        layoutId="cmd-hover"
                        transition={{
                          type: "spring",
                          bounce: 0.15,
                          duration: 0.4,
                        }}
                      />
                    )}
                    <item.icon
                      className="relative size-4 shrink-0"
                      weight="light"
                    />
                    <span className="relative">{item.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </motion.div>
        </Command.Dialog>
      )}
    </AnimatePresence>
  )
}
