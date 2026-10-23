"use client"

import { cn } from "@superserve/ui"
import Link from "next/link"
import { usePathname } from "next/navigation"

export const BILLING_TABS = [
  { label: "Overview", href: "/admin/billing" },
  { label: "Teams", href: "/admin/billing/teams" },
  { label: "Plans & pricing", href: "/admin/billing/plans" },
] as const

export function isActiveBillingTab(pathname: string, href: string): boolean {
  const path = pathname.replace(/\/+$/, "")
  if (href === "/admin/billing") return path === href
  return path === href || path.startsWith(`${href}/`)
}

export function BillingNav() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Billing admin"
      className="flex shrink-0 border-b border-dashed border-border px-2"
    >
      {BILLING_TABS.map((tab) => {
        const active = isActiveBillingTab(pathname, tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 font-mono text-xs uppercase transition-colors",
              active
                ? "border-brand text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
