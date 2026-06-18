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

interface DashboardContentProps {
  children: React.ReactNode
  isStaff: boolean
  banner?: React.ReactNode
}

function DashboardContent({
  children,
  isStaff,
  banner,
}: DashboardContentProps) {
  const { isCollapsed } = useSidebar()
  usePostHogIdentify()
  useFaviconStatus()

  return (
    <div className="flex h-screen flex-col">
      {banner}
      <div className="relative flex min-h-0 flex-1">
        <Sidebar isStaff={isStaff} />
        <CommandPalette />
        <main
          className={cn(
            "flex flex-1 flex-col overflow-hidden transition-all duration-200",
            isCollapsed ? "ml-16" : "ml-64",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  )
}

interface DashboardShellProps {
  children: React.ReactNode
  isStaff: boolean
  banner?: React.ReactNode
}

export function DashboardShell({
  children,
  isStaff,
  banner,
}: DashboardShellProps) {
  return (
    <SidebarProvider>
      <TooltipProvider>
        <DashboardContent isStaff={isStaff} banner={banner}>
          {children}
        </DashboardContent>
      </TooltipProvider>
    </SidebarProvider>
  )
}
