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
}

function DashboardContent({ children, isStaff }: DashboardContentProps) {
  const { isCollapsed } = useSidebar()
  usePostHogIdentify()
  useFaviconStatus()

  return (
    <div className="flex h-screen">
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
  )
}

interface DashboardShellProps {
  children: React.ReactNode
  isStaff: boolean
}

export function DashboardShell({ children, isStaff }: DashboardShellProps) {
  return (
    <SidebarProvider>
      <TooltipProvider>
        <DashboardContent isStaff={isStaff}>{children}</DashboardContent>
      </TooltipProvider>
    </SidebarProvider>
  )
}
