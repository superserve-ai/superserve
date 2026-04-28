"use client"

import { MagnifyingGlassIcon, SidebarSimpleIcon } from "@phosphor-icons/react"
import {
  Button,
  cn,
  Kbd,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@superserve/ui"
import Image from "next/image"
import { bottomNavItems, mainNavItems } from "./nav-config"
import { useSidebar } from "./sidebar-context"
import { SidebarNav } from "./sidebar-nav"
import { SidebarUserMenu } from "./sidebar-user-menu"

function openCommandPalette() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true }),
  )
}

export function Sidebar() {
  const { isCollapsed, toggle } = useSidebar()

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-border bg-background transition-all duration-200",
        isCollapsed ? "w-16" : "w-64",
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-center p-5">
        {isCollapsed ? (
          <Image
            src="/logo-mark.svg"
            alt="Superserve"
            width={20}
            height={20}
            className="size-5"
          />
        ) : (
          <Image
            src="/logo.svg"
            alt="Superserve"
            width={100}
            height={20}
            className="h-5 w-auto"
          />
        )}
      </div>

      {/* Search */}
      <div className="px-2.5 mb-2">
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={openCommandPalette}
                  aria-label="Search"
                  className="w-full"
                />
              }
            >
              <MagnifyingGlassIcon className="size-4" weight="light" />
            </TooltipTrigger>
            <TooltipPopup>Search</TooltipPopup>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={openCommandPalette}
            className="flex w-full group items-center gap-2.5 border border-border px-2.5 py-2.5 text-foreground/70 transition-colors hover:text-foreground hover:bg-foreground/5 cursor-pointer"
          >
            <MagnifyingGlassIcon className="size-4 shrink-0" weight="light" />
            <span className="flex-1 text-left text-sm leading-none tracking-tight text-foreground/70">
              Search
            </span>
            <div className="flex items-center gap-0.5">
              <Kbd className="transition-colors group-hover:bg-neutral-900">
                &#8984;
              </Kbd>
              <Kbd className="transition-colors group-hover:bg-neutral-900">
                K
              </Kbd>
            </div>
          </button>
        )}
      </div>

      {/* Main Nav */}
      <SidebarNav items={mainNavItems} groupId="main" />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Collapse Toggle */}
      <nav className="px-2.5 mb-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={toggle}
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className={cn(
                  "flex w-full items-center gap-2.5 px-2.5 py-2.5 text-foreground/70 hover:text-foreground hover:bg-foreground/4 transition-colors cursor-pointer",
                  isCollapsed && "justify-center",
                )}
              />
            }
          >
            <SidebarSimpleIcon className="size-4 shrink-0" weight="light" />
            {!isCollapsed && (
              <span className="text-sm leading-none tracking-tight">
                Collapse
              </span>
            )}
          </TooltipTrigger>
          {isCollapsed && <TooltipPopup>Expand</TooltipPopup>}
        </Tooltip>
      </nav>

      {/* Bottom Nav */}
      <SidebarNav items={bottomNavItems} groupId="bottom" />

      <div className="m-2.5 border-t border-border" />

      {/* User Menu */}
      <div className="pb-2.5">
        <SidebarUserMenu />
      </div>
    </aside>
  )
}
