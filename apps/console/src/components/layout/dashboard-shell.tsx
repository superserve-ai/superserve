"use client"

import { cn, TooltipProvider } from "@superserve/ui"
import { Sidebar } from "@/components/sidebar/sidebar"
import {
  SidebarProvider,
  useSidebar,
} from "@/components/sidebar/sidebar-context"
import { usePostHogIdentify } from "@/hooks/use-posthog-identify"

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar()
  usePostHogIdentify()

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main
        className={cn(
          "flex-1 flex flex-col overflow-hidden transition-all duration-200",
          isCollapsed ? "ml-16" : "ml-64",
        )}
      >
        {children}
      </main>
    </div>
  )
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <TooltipProvider>
        <DashboardContent>{children}</DashboardContent>
      </TooltipProvider>
    </SidebarProvider>
  )
}
