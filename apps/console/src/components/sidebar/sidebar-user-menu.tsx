"use client"

import { CaretUpDownIcon, SignOutIcon, UserIcon } from "@phosphor-icons/react"
import { createBrowserClient } from "@superserve/supabase"
import {
  Avatar,
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
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
    try {
      const supabase = createBrowserClient()
      await supabase.auth.signOut()
    } catch {
      // Sign out failed, but redirect to sign-in anyway
    }
    router.push("/auth/signin")
  }

  return (
    <div className="px-2.5">
      <Menu>
        <MenuTrigger
          render={<div role="button" tabIndex={0} />}
          className={cn(
            "flex w-full items-center gap-2.5 px-2.5 py-2.5 text-foreground/70 transition-colors hover:text-foreground hover:bg-surface-hover cursor-pointer",
            isCollapsed && "justify-center",
          )}
        >
          <UserIcon className="size-4 shrink-0" weight="light" />
          {!isCollapsed && (
            <>
              <span className="flex-1 truncate text-left text-sm leading-none tracking-tight">
                {name}
              </span>
              <CaretUpDownIcon className="size-4 shrink-0" weight="light" />
            </>
          )}
        </MenuTrigger>
        <MenuPopup
          className="w-56"
          side={isCollapsed ? "right" : "top"}
          align="start"
        >
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
          <MenuSeparator />
          <MenuItem onClick={handleLogout}>
            <SignOutIcon className="size-4" weight="light" />
            Log out
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  )
}
