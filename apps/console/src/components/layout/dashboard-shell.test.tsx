import { render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import { DashboardShell } from "./dashboard-shell"

const sidebar = vi.hoisted(() => ({ isCollapsed: false }))

vi.mock("@/components/sidebar/sidebar", () => ({
  Sidebar: () => <aside>Sidebar</aside>,
}))
vi.mock("@/components/command-palette", () => ({ CommandPalette: () => null }))
vi.mock("@/components/sidebar/sidebar-context", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
  useSidebar: () => sidebar,
}))
vi.mock("@/hooks/use-favicon-status", () => ({ useFaviconStatus: () => {} }))
vi.mock("@/hooks/use-posthog-identify", () => ({
  usePostHogIdentify: () => {},
}))

beforeEach(() => {
  sidebar.isCollapsed = false
})

it("places one global banner above the positioned sidebar row and preserves impersonation", () => {
  render(
    <DashboardShell
      globalBanner={<div>Trial</div>}
      banner={<div>Impersonation</div>}
    >
      <div>Page</div>
    </DashboardShell>,
  )
  const main = screen.getByRole("main")
  const row = main.parentElement!
  expect(row).toHaveClass("relative", "min-h-0")
  expect(row).toContainElement(screen.getByRole("complementary"))
  expect(row).not.toContainElement(screen.getByText("Trial"))
  expect(row.previousElementSibling).toContainElement(screen.getByText("Trial"))
  expect(main).toContainElement(screen.getByText("Impersonation"))
  expect(main).toContainElement(screen.getByText("Page"))
  expect(screen.getAllByText("Trial")).toHaveLength(1)
})

it("uses the rail margin on small screens and the wider desktop margin only when expanded", () => {
  const { rerender } = render(<DashboardShell>Page</DashboardShell>)

  expect(screen.getByRole("main")).toHaveClass("ml-16", "md:ml-64")
  expect(screen.getByRole("main")).not.toHaveClass("ml-64")

  sidebar.isCollapsed = true
  rerender(<DashboardShell>Page</DashboardShell>)

  expect(screen.getByRole("main")).toHaveClass("ml-16")
  expect(screen.getByRole("main")).not.toHaveClass("md:ml-64")
})
