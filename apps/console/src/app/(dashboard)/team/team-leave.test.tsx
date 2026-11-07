import { ToastProvider } from "@superserve/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"
import { teamKeys } from "@/lib/api/query-keys"

const mocks = vi.hoisted(() => ({ management: vi.fn() }))

vi.mock("@/lib/api/team-management", () => ({
  getTeamManagement: mocks.management,
  getTeamInvitations: vi.fn(),
}))
vi.mock("@/lib/api/teams-actions", () => ({ listTeamsAction: vi.fn() }))
vi.mock("@/lib/api/team-invitations-actions", () => ({}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: null, loading: false, error: null }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }))

import { TeamClient } from "./team-client"

describe("TeamClient without team-management permission", () => {
  it("keeps the leave control without refetching the refused query", async () => {
    mocks.management.mockRejectedValue(
      new ApiError(403, "forbidden", "Forbidden"),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    client.setQueryData(teamKeys.directory(), {
      teams: [
        { id: "team-1", name: "Acme", region: "use" },
        { id: "team-2", name: "Other", region: "usw" },
      ],
      activeTeamId: "team-1",
      activeRegion: "use",
    })
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <TeamClient />
        </ToastProvider>
      </QueryClientProvider>,
    )

    expect(
      await screen.findByRole("button", { name: /^leave team$/i }),
    ).toBeEnabled()
    // A refetch on mount would show the loading state and unmount it again.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole("button", { name: /^leave team$/i })).toBeEnabled()
    expect(mocks.management).toHaveBeenCalledTimes(1)
  })
})
