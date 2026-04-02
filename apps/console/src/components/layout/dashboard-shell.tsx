"use client"

import { cn, TooltipProvider } from "@superserve/ui"
import { Sidebar } from "@/components/sidebar/sidebar"
import {
  SidebarProvider,
  useSidebar,
} from "@/components/sidebar/sidebar-context"

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar()

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main
        className={cn(
          "flex-1 overflow-y-auto px-12 py-10 transition-all duration-200",
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
