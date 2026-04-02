"use client"

import { CaretLeftIcon, CaretRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import {
  cn,
  Kbd,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@superserve/ui"
import { useEffect, useRef } from "react"
import { bottomNavItems, mainNavItems } from "./nav-config"
import { useSidebar } from "./sidebar-context"
import { SidebarNav } from "./sidebar-nav"
import { SidebarUserMenu } from "./sidebar-user-menu"

export function Sidebar() {
  const { isCollapsed, toggle, setCollapsed } = useSidebar()
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        if (isCollapsed) setCollapsed(false)
        // Wait for sidebar expansion transition before focusing
        setTimeout(() => searchInputRef.current?.focus(), 50)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isCollapsed, setCollapsed])

  const handleSearchClick = () => {
    if (isCollapsed) {
      setCollapsed(false)
      setTimeout(() => searchInputRef.current?.focus(), 200)
    } else {
      searchInputRef.current?.focus()
    }
  }

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-dashed border-border bg-background transition-all duration-200",
        isCollapsed ? "w-16" : "w-64",
      )}
    >
      {/* Logo + Toggle */}
      <div className="flex items-center justify-between p-5">
        {isCollapsed ? (
          <img src="/logo-mark.svg" alt="Superserve" className="size-5" />
        ) : (
          <img src="/logo.svg" alt="Superserve" className="h-5 w-auto" />
        )}
        <button
          type="button"
          onClick={toggle}
          className="text-foreground/50 hover:text-foreground transition-colors cursor-pointer"
        >
          {isCollapsed ? (
            <CaretRightIcon className="size-4" weight="light" />
          ) : (
            <CaretLeftIcon className="size-4" weight="light" />
          )}
        </button>
      </div>

      {/* Search */}
      <div className="px-2.5 mb-2">
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleSearchClick}
                className="flex w-full items-center justify-center border border-dashed border-border px-2.5 py-2.5 text-foreground/70 transition-colors hover:text-foreground hover:bg-surface-hover cursor-pointer"
              >
                <MagnifyingGlassIcon className="size-4" weight="light" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Search</TooltipContent>
          </Tooltip>
        ) : (
          <label className="flex w-full group items-center gap-2.5 border border-dashed border-border px-2.5 py-2.5 text-foreground/70 transition-colors hover:text-foreground hover:bg-surface-hover cursor-text focus-within:border-border-focus">
            <MagnifyingGlassIcon className="size-4 shrink-0" weight="light" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search"
              className="flex-1 bg-transparent text-sm leading-none tracking-tight text-foreground placeholder:text-foreground/70 outline-none w-20"
            />
            <div className="flex items-center gap-0.5">
              <Kbd className="transition-colors group-hover:bg-neutral-900">&#8984;</Kbd>
              <Kbd className="transition-colors group-hover:bg-neutral-900">K</Kbd>
            </div>
          </label>
        )}
      </div>

      {/* Main Nav */}
      <SidebarNav items={mainNavItems} groupId="main" />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom Nav */}
      <SidebarNav items={bottomNavItems} groupId="bottom" />

      <div className="px-2.5 py-1">
        <Separator />
      </div>

      {/* User Menu */}
      <div className="pb-2.5">
        <SidebarUserMenu />
      </div>
    </aside>
  )
}
