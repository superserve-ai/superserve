"use client"

import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@superserve/ui"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { NavItem } from "./nav-config"
import { useSidebar } from "./sidebar-context"

interface SidebarNavProps {
  items: NavItem[]
}

export function SidebarNav({ items }: SidebarNavProps) {
  const pathname = usePathname()
  const { isCollapsed } = useSidebar()

  return (
    <nav className="flex flex-col gap-0.5 px-2.5">
      {items.map((item) => {
        const isActive = !item.external && pathname.startsWith(item.href)
        const Icon = item.icon

        const linkContent = (
          <>
            <Icon className="size-4 shrink-0" weight="light" />
            {!isCollapsed && (
              <span className="text-sm leading-none tracking-tight">
                {item.label}
              </span>
            )}
          </>
        )

        const linkClassName = cn(
          "flex items-center gap-2.5 rounded-sm px-2.5 py-2.5 transition-colors",
          isCollapsed && "justify-center",
          isActive
            ? "bg-surface-hover text-foreground"
            : "text-foreground/70 hover:text-foreground hover:bg-surface-hover",
        )

        const link = item.external ? (
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
          >
            {linkContent}
          </a>
        ) : (
          <Link key={item.href} href={item.href} className={linkClassName}>
            {linkContent}
          </Link>
        )

        if (isCollapsed) {
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          )
        }

        return link
      })}
    </nav>
  )
}
