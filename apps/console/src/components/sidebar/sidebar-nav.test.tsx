import { CubeIcon, StackIcon } from "@phosphor-icons/react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/sandboxes/sbx-1",
}))

vi.mock("./sidebar-context", () => ({
  useSidebar: () => ({ isCollapsed: false, toggle: vi.fn() }),
}))

import { SidebarNav } from "./sidebar-nav"

describe("SidebarNav", () => {
  it("colors resting icons and keeps the active icon on the link color", () => {
    render(
      <SidebarNav
        groupId="main"
        items={[
          {
            label: "Sandboxes",
            href: "/sandboxes",
            icon: CubeIcon,
            iconClassName: "text-info",
          },
          {
            label: "Templates",
            href: "/templates",
            icon: StackIcon,
            iconClassName: "text-ecosystem",
          },
        ]}
      />,
    )

    const active = screen.getByRole("link", { name: "Sandboxes" })
    const resting = screen.getByRole("link", { name: "Templates" })
    expect(active).toHaveAttribute("aria-current", "page")
    expect(active.querySelector("svg")).not.toHaveClass("text-info")
    expect(resting.querySelector("svg")).toHaveClass("text-ecosystem")
  })
})
