"use client"

import { cn, TooltipProvider } from "@superserve/ui"

import { CommandPalette } from "@/components/command-palette"
import { Sidebar } from "@/components/sidebar/sidebar"
import {
  SidebarProvider,
  useSidebar,
} from "@/components/sidebar/sidebar-context"
import { useFaviconStatus } from "@/hooks/use-favicon-status"
import { usePostHogIdentify } from "@/hooks/use-posthog-identify"

function DashboardContent({
  banner,
  globalBanner,
  children,
}: {
  banner?: React.ReactNode
  globalBanner?: React.ReactNode
  children: React.ReactNode
}) {
  const { isCollapsed } = useSidebar()
  usePostHogIdentify()
  useFaviconStatus()

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="shrink-0">{globalBanner}</div>
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <CommandPalette />
        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-all duration-200",
            isCollapsed ? "ml-16" : "ml-64",
          )}
        >
          {banner}
          {children}
        </main>
      </div>
    </div>
  )
}

export function DashboardShell({
  banner,
  globalBanner,
  children,
}: {
  banner?: React.ReactNode
  globalBanner?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <TooltipProvider>
        <DashboardContent banner={banner} globalBanner={globalBanner}>
          {children}
        </DashboardContent>
      </TooltipProvider>
    </SidebarProvider>
  )
}
