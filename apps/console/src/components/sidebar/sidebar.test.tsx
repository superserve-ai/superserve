import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}))

vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({
    user: { id: "user-1" },
    loading: false,
  }),
}))

vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({ data: { activeTeamId: "team-a" }, isPending: false }),
}))

vi.mock("@/hooks/use-favicon-status", () => ({
  useFaviconStatus: () => {},
}))

vi.mock("@/hooks/use-posthog-identify", () => ({
  usePostHogIdentify: () => {},
}))

vi.mock("./sidebar-context", () => ({
  useSidebar: () => ({
    isCollapsed: false,
    toggle: vi.fn(),
  }),
  SidebarProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock("./team-switcher", () => ({
  TeamSwitcher: () => null,
}))

vi.mock("./sidebar-user-menu", () => ({
  SidebarUserMenu: () => null,
}))

vi.mock("./sidebar-nav", () => ({
  SidebarNav: ({ items }: { items: Array<{ label: string }> }) => (
    <nav>{items.map((item) => item.label).join(" | ")}</nav>
  ),
}))

import { Sidebar } from "./sidebar"

describe("Sidebar", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("hides the QM nav item unless the team is in the beta", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "team-z")
    const queryClient = new QueryClient()
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <Sidebar />
      </QueryClientProvider>,
    )
    expect(screen.queryByText(/\bQM\b/)).not.toBeInTheDocument()
    unmount()

    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "team-z,team-a")
    render(
      <QueryClientProvider client={queryClient}>
        <Sidebar />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/Templates \| QM \| Secrets/)).toBeInTheDocument()
  })

  it("does not show the billing nav item", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <Sidebar />
      </QueryClientProvider>,
    )

    expect(screen.queryByText(/Billing/)).not.toBeInTheDocument()
  })
})
