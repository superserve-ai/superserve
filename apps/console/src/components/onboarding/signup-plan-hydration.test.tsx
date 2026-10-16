import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { QueryProvider } from "@/components/query-provider"
import { refreshTeamScopedQueries } from "@/hooks/use-teams"

import { SignupPlanGate } from "./signup-plan-gate"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: () => new Promise(() => {}),
}))
vi.mock("@/lib/api/teams-actions", () => ({
  listTeamsAction: () => new Promise(() => {}),
}))

it("renders a verified dashboard immediately and keeps it while a team reset re-checks", async () => {
  let client!: QueryClient
  function CaptureClient() {
    client = useQueryClient()
    return null
  }
  render(
    <QueryProvider
      initialSignup={{
        context: {
          userId: "owner",
          teamKey: "use:team",
          state: "committed",
          offer: "free",
        },
        directory: {
          teams: [{ id: "team", name: "Team", region: "use" }],
          regions: ["use"],
          activeTeamId: "team",
          activeRegion: "use",
        },
      }}
    >
      <CaptureClient />
      <SignupPlanGate>
        <p>Verified dashboard</p>
      </SignupPlanGate>
    </QueryProvider>,
  )
  expect(screen.getByText("Verified dashboard")).toBeVisible()
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
  await act(async () => {
    refreshTeamScopedQueries(client)
  })
  expect(client.getQueryData(["signup-plan", "use:team"])).toBeUndefined()
  expect(screen.getByText("Verified dashboard")).toBeVisible()
})
