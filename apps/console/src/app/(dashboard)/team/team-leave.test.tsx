import { ToastProvider } from "@superserve/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"
import { teamKeys } from "@/lib/api/query-keys"

const mocks = vi.hoisted(() => ({
  management: vi.fn(),
  dashboardTeam: vi.fn(),
}))

vi.mock("@/lib/api/team-management", () => ({
  getTeamManagement: mocks.management,
  getTeamInvitations: vi.fn(),
}))
vi.mock("@/lib/api/teams-actions", () => ({ listTeamsAction: vi.fn() }))
vi.mock("@/lib/api/team-invitations-actions", () => ({}))
vi.mock("@/components/query-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/query-provider")>()),
  useDashboardTeamContext: () => mocks.dashboardTeam(),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: null, loading: false, error: null }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }))

import { TeamClient } from "./team-client"

function renderTeam() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(teamKeys.directory(), {
    teams: [
      { id: "team-1", name: "Example team", region: "use" },
      { id: "team-2", name: "Other", region: "usw" },
    ],
    activeTeamId: "team-1",
    activeRegion: "use",
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TeamClient />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe("TeamClient without team-management permission", () => {
  beforeEach(() => {
    mocks.management.mockClear()
    mocks.dashboardTeam.mockReturnValue(null)
    mocks.management.mockRejectedValue(
      new ApiError(403, "forbidden", "Forbidden"),
    )
  })

  it("shows the no-access view and keeps leave enabled without refetching", async () => {
    renderTeam()

    expect(
      await screen.findByRole("button", { name: /^leave team$/i }),
    ).toBeEnabled()
    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Danger zone" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Your role can't view team members. Ask a team Owner if you need access.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("Make another member an owner before leaving."),
    ).not.toBeInTheDocument()
    // A refetch on mount would show the loading state and unmount it again.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole("button", { name: /^leave team$/i })).toBeEnabled()
    expect(mocks.management).toHaveBeenCalledTimes(1)
  })

  it("hides leave while impersonating on a 403", async () => {
    mocks.dashboardTeam.mockReturnValue({
      teamId: "team-3",
      region: "use",
      name: "Viewed team",
    })
    renderTeam()

    expect(
      await screen.findByText(
        "Your role can't view team members. Ask a team Owner if you need access.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^leave team$/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Danger zone" }),
    ).not.toBeInTheDocument()
  })

  it("offers retry without leave for other errors", async () => {
    mocks.management.mockRejectedValue(
      new ApiError(500, "error", "Request failed"),
    )
    const user = userEvent.setup()
    renderTeam()

    await user.click(await screen.findByRole("button", { name: /try again/i }))

    expect(mocks.management).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByRole("button", { name: /^leave team$/i }),
    ).not.toBeInTheDocument()
  })
})
