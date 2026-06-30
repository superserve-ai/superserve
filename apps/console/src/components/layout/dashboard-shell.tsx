"use client"

import { cn, TooltipProvider } from "@superserve/ui"

import {
  type ImpersonationState,
  ImpersonationStateProvider,
} from "@/components/admin/impersonation-context"
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
  canImpersonateUsers: boolean
  banner?: React.ReactNode
}

function DashboardContent({
  children,
  canImpersonateUsers,
  banner,
}: DashboardContentProps) {
  const { isCollapsed } = useSidebar()
  usePostHogIdentify()
  useFaviconStatus()

  return (
    <div className="flex h-screen flex-col">
      {banner}
      <div className="relative flex min-h-0 flex-1">
        <Sidebar canImpersonateUsers={canImpersonateUsers} />
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
  canImpersonateUsers: boolean
  impersonation: ImpersonationState
  banner?: React.ReactNode
}

export function DashboardShell({
  children,
  canImpersonateUsers,
  impersonation,
  banner,
}: DashboardShellProps) {
  return (
    <SidebarProvider>
      <TooltipProvider>
        <ImpersonationStateProvider value={impersonation}>
          <DashboardContent
            canImpersonateUsers={canImpersonateUsers}
            banner={banner}
          >
            {children}
          </DashboardContent>
        </ImpersonationStateProvider>
      </TooltipProvider>
    </SidebarProvider>
  )
}
