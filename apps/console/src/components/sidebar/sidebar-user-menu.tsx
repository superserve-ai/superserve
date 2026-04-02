"use client"

import { CaretUpDown, SignOut, User } from "@phosphor-icons/react"
import { createBrowserClient } from "@superserve/supabase"
import {
  Avatar,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@superserve/ui"
import { useRouter } from "next/navigation"
import { useUser } from "@/hooks/use-user"
import { useSidebar } from "./sidebar-context"

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export function SidebarUserMenu() {
  const { user } = useUser()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  const name =
    user?.user_metadata?.full_name || user?.user_metadata?.name || "User"
  const email = user?.email || ""

  const handleLogout = async () => {
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    router.push("/auth/signin")
  }

  return (
    <div className="px-2.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={isCollapsed ? name : undefined}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2.5 text-foreground/70 transition-colors hover:text-foreground hover:bg-surface-hover cursor-pointer",
              isCollapsed && "justify-center",
            )}
          >
            <User className="size-4 shrink-0" weight="light" />
            {!isCollapsed && (
              <>
                <span className="flex-1 truncate text-left text-sm leading-none tracking-tight">
                  {name}
                </span>
                <CaretUpDown className="size-4 shrink-0" weight="light" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={isCollapsed ? "right" : "top"}
          align="start"
          className="w-56"
        >
          {/* User info header */}
          <div className="flex items-center gap-2.5 px-2 py-2 select-none">
            <Avatar fallback={getInitials(name)} size="sm" />
            <div className="flex flex-col gap-0.5 overflow-hidden">
              <span className="truncate text-sm font-medium text-foreground">
                {name}
              </span>
              {email && (
                <span className="truncate text-xs text-muted">{email}</span>
              )}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}>
            <SignOut className="size-4" weight="light" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
