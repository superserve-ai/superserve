import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  scope: "self",
  context: { ready: false, teamKey: null as string | null },
  teams: { isPending: false, isError: false, refetch: vi.fn() },
  replace: vi.fn(),
  getPlan: vi.fn(),
}))
vi.mock("@/components/query-provider", () => ({
  useQueryScope: () => mocks.scope,
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => mocks.context,
}))
vi.mock("@/hooks/use-teams", () => ({ useTeams: () => mocks.teams }))
vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: mocks.getPlan,
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}))
import { SignupPlanGate } from "./signup-plan-gate"

function renderGate() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SignupPlanGate>
        <p>Console contents</p>
      </SignupPlanGate>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.scope = "self"
  mocks.context = { ready: false, teamKey: null }
  mocks.teams.isError = false
  mocks.teams.isPending = false
  mocks.getPlan.mockResolvedValue({
    userId: "new-user",
    teamKey: "use:new-team",
    state: "selecting",
    offer: null,
  })
})
describe("signup plan gate", () => {
  it("bootstraps a first signup with an empty team directory before rendering console", async () => {
    renderGate()
    await waitFor(() => expect(mocks.getPlan).toHaveBeenCalledWith(undefined))
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/onboarding/plan"),
    )
    expect(screen.queryByText("Console contents")).not.toBeInTheDocument()
  })
  it("refreshes an empty directory after legacy provisioning before exposing the console", async () => {
    let refreshed!: () => void
    mocks.teams.refetch.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        refreshed = resolve
      }),
    )
    mocks.getPlan.mockResolvedValue({
      userId: "new-user",
      teamKey: "use:new-team",
      state: "legacy",
      offer: null,
    })
    renderGate()
    await waitFor(() =>
      expect(mocks.teams.refetch).toHaveBeenCalledWith({ throwOnError: true }),
    )
    expect(screen.queryByText("Console contents")).not.toBeInTheDocument()
    await act(async () => refreshed())
    expect(await screen.findByText("Console contents")).toBeVisible()
  })

  it("allows existing teams without a new-user onboarding record", async () => {
    mocks.context = { ready: true, teamKey: "use:existing" }
    mocks.getPlan.mockResolvedValue({
      state: "legacy",
      offer: null,
      teamKey: "use:existing",
    })
    renderGate()
    expect(await screen.findByText("Console contents")).toBeVisible()
    expect(mocks.getPlan).toHaveBeenCalledWith("use:existing")
    expect(mocks.replace).not.toHaveBeenCalled()
  })
  it("blocks console content when the read fails", async () => {
    mocks.context = { ready: true, teamKey: "use:team" }
    mocks.getPlan.mockRejectedValue(new Error("Unavailable"))
    renderGate()
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(screen.queryByText("Console contents")).not.toBeInTheDocument()
  })
  it("does not bootstrap while team lookup is degraded or pending", () => {
    mocks.teams.isError = true
    renderGate()
    expect(mocks.getPlan).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible()
  })
  it("leaves impersonation read-only and outside onboarding", () => {
    mocks.scope = "impersonated-team"
    renderGate()
    expect(screen.getByText("Console contents")).toBeVisible()
    expect(mocks.getPlan).not.toHaveBeenCalled()
  })
})
