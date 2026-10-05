import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { DashboardShell } from "./dashboard-shell"

vi.mock("@/components/sidebar/sidebar", () => ({
  Sidebar: () => <aside>Sidebar</aside>,
}))
vi.mock("@/components/command-palette", () => ({ CommandPalette: () => null }))
vi.mock("@/components/sidebar/sidebar-context", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
  useSidebar: () => ({ isCollapsed: false }),
}))
vi.mock("@/hooks/use-favicon-status", () => ({ useFaviconStatus: () => {} }))
vi.mock("@/hooks/use-posthog-identify", () => ({
  usePostHogIdentify: () => {},
}))

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
