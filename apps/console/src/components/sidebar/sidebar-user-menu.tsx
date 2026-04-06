"use client"

import { CaretUpDownIcon, SignOutIcon, UserIcon } from "@phosphor-icons/react"
import { createBrowserClient } from "@superserve/supabase"
import { Avatar, cn } from "@superserve/ui"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
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
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const name =
    user?.user_metadata?.full_name || user?.user_metadata?.name || "User"
  const email = user?.email || ""

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open])

  const handleLogout = async () => {
    setOpen(false)
    try {
      const supabase = createBrowserClient()
      await supabase.auth.signOut()
    } catch {
      // Sign out failed, but redirect to sign-in anyway
    }
    router.push("/auth/signin")
  }

  return (
    <div className="relative px-2.5" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
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
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 w-56 border border-dashed border-border bg-surface p-1",
            isCollapsed
              ? "bottom-0 left-full ml-1"
              : "bottom-full left-2.5 mb-1",
          )}
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
          <div className="-mx-1 my-1 h-px bg-border" />
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full cursor-pointer select-none items-center gap-2 px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-hover"
          >
            <SignOutIcon className="size-4" weight="light" />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
