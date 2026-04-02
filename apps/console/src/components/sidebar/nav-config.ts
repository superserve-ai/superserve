import type { Icon } from "@phosphor-icons/react"
import {
  BookOpen,
  Camera,
  ChartBar,
  ClipboardText,
  Cube,
  Gear,
  Key,
  Lifebuoy,
} from "@phosphor-icons/react"

export interface NavItem {
  label: string
  href: string
  icon: Icon
  external?: boolean
}

export const mainNavItems: NavItem[] = [
  { label: "Sandboxes", href: "/sandboxes", icon: Cube },
  { label: "Snapshots", href: "/snapshots", icon: Camera },
  { label: "Audit Logs", href: "/audit-logs", icon: ClipboardText },
  { label: "API Keys", href: "/api-keys", icon: Key },
  { label: "Plan & Usage", href: "/plan-usage", icon: ChartBar },
  { label: "Settings", href: "/settings", icon: Gear },
]

export const bottomNavItems: NavItem[] = [
  {
    label: "Support",
    href: "mailto:support@superserve.ai",
    icon: Lifebuoy,
    external: true,
  },
  {
    label: "Docs",
    href: "https://docs.superserve.ai",
    icon: BookOpen,
    external: true,
  },
]
