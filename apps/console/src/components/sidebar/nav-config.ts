import type { Icon } from "@phosphor-icons/react"
import {
  BookOpenIcon,
  CameraIcon,
  ChartBarIcon,
  ClipboardTextIcon,
  CurrencyDollarIcon,
  CubeIcon,
  GearIcon,
  KeyIcon,
  LifebuoyIcon,
  StackIcon,
  UserCheckIcon,
  LockKeyIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "@phosphor-icons/react"

export interface NavItem {
  label: string
  href: string
  icon: Icon
  /** Resting icon color for non-active items; the active item is always mint. */
  iconClassName?: string
  external?: boolean
}

export const userManagementNavItem: NavItem = {
  label: "Team",
  href: "/team",
  icon: UsersIcon,
}

export const adminNavItem: NavItem = {
  label: "Admin",
  href: "/admin",
  icon: ShieldCheckIcon,
}

export const pendingSignupsNavItem: NavItem = {
  label: "Pending Signups",
  href: "/admin/signups",
  icon: UserCheckIcon,
}

export const adminBillingNavItem: NavItem = {
  label: "Billing Admin",
  href: "/admin/billing",
  icon: CurrencyDollarIcon,
}

export const mainNavItems: NavItem[] = [
  {
    label: "Sandboxes",
    href: "/sandboxes",
    icon: CubeIcon,
    iconClassName: "text-info",
  },
  {
    label: "Templates",
    href: "/templates",
    icon: StackIcon,
    iconClassName: "text-ecosystem",
  },
  {
    label: "Secrets",
    href: "/secrets",
    icon: LockKeyIcon,
    iconClassName: "text-warning",
  },
  {
    label: "Snapshots",
    href: "/snapshots",
    icon: CameraIcon,
    iconClassName: "text-ecosystem",
  },
  { label: "Audit Logs", href: "/audit-logs", icon: ClipboardTextIcon },
  {
    label: "API Keys",
    href: "/api-keys",
    icon: KeyIcon,
    iconClassName: "text-warning",
  },
  { label: "Billing & Usage", href: "/billing-usage", icon: ChartBarIcon },
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
    href: "https://docs.superserve.ai?utm_source=console&utm_medium=nav",
    icon: BookOpenIcon,
    external: true,
  },
]
