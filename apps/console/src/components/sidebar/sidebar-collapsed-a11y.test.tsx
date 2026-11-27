import { TooltipProvider } from "@superserve/ui"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  bottomNavItems,
  mainNavItems,
  userManagementNavItem,
} from "./nav-config"
import { SidebarNav } from "./sidebar-nav"
import { SidebarUserMenu } from "./sidebar-user-menu"

const state = vi.hoisted(() => ({ isCollapsed: false }))
const accountName = "Avery Morgan"

vi.mock("./sidebar-context", () => ({
  useSidebar: () => state,
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/sandboxes",
}))

vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { user_metadata: { full_name: accountName } } }),
}))

vi.mock("@/hooks/use-sign-out", () => ({
  useSignOut: () => vi.fn(),
}))

vi.mock("./plan-badge", () => ({
  PlanBadge: () => null,
}))

const primaryNavItems = [...mainNavItems, userManagementNavItem]
const navItems = [...primaryNavItems, ...bottomNavItems]

function renderNav() {
  render(
    <TooltipProvider>
      <SidebarNav items={primaryNavItems} groupId="main" />
      <SidebarNav items={bottomNavItems} groupId="bottom" />
    </TooltipProvider>,
  )
}

describe("SidebarNav accessible names", () => {
  it("names every collapsed link", () => {
    state.isCollapsed = true
    renderNav()

    for (const item of navItems) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute(
        "href",
        item.href,
      )
    }
    expect(screen.queryAllByRole("link", { name: "" })).toHaveLength(0)
  })

  it("uses visible text to name each expanded link exactly once", () => {
    state.isCollapsed = false
    renderNav()

    for (const item of navItems) {
      const link = screen.getByRole("link", { name: item.label })
      expect(within(link).getByText(item.label)).toBeVisible()
      expect(link).not.toHaveAttribute("aria-label")
    }
  })
})

describe("SidebarUserMenu accessibility", () => {
  it("names the collapsed account menu with the user's name", () => {
    state.isCollapsed = true
    render(<SidebarUserMenu />)

    expect(
      screen.getByRole("button", { name: /account menu/i }),
    ).toHaveAccessibleName(`Account menu for ${accountName}`)
  })

  it("uses the visible account name when expanded and announces when opened", async () => {
    state.isCollapsed = false
    const user = userEvent.setup()
    render(<SidebarUserMenu />)

    const trigger = screen.getByRole("button", { name: accountName })
    expect(trigger).not.toHaveAttribute("aria-label")
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    await user.click(trigger)

    expect(trigger).toHaveAttribute("aria-expanded", "true")
  })
})
