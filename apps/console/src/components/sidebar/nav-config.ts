import type { Icon } from "@phosphor-icons/react"
import {
  BookOpenIcon,
  // CameraIcon, // TODO: re-enable when Snapshots ships
  ChartBarIcon,
  ClipboardTextIcon,
  CubeIcon,
  GearIcon,
  KeyIcon,
  LifebuoyIcon,
  StackIcon,
} from "@phosphor-icons/react"

export interface NavItem {
  label: string
  href: string
  icon: Icon
  external?: boolean
}

export const mainNavItems: NavItem[] = [
  { label: "Sandboxes", href: "/sandboxes", icon: CubeIcon },
  { label: "Templates", href: "/templates", icon: StackIcon },
  // { label: "Snapshots", href: "/snapshots", icon: CameraIcon }, // TODO: re-enable when Snapshots ships
  { label: "Audit Logs", href: "/audit-logs", icon: ClipboardTextIcon },
  { label: "API Keys", href: "/api-keys", icon: KeyIcon },
  { label: "Plan & Usage", href: "/plan-usage", icon: ChartBarIcon },
  { label: "Settings", href: "/settings", icon: GearIcon },
]

export const bottomNavItems: NavItem[] = [
  {
    label: "Support",
    href: "mailto:support@superserve.ai",
    icon: LifebuoyIcon,
    external: true,
  },
  {
    label: "Docs",
    href: "https://docs.superserve.ai",
    icon: BookOpenIcon,
    external: true,
  },
]
