import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  scope: "self",
  context: { ready: true, teamKey: "use:team" as string | null },
  replace: vi.fn(),
  getPlan: vi.fn(),
}))
vi.mock("@/components/query-provider", () => ({
  useQueryScope: () => mocks.scope,
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => mocks.context,
}))
vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: mocks.getPlan,
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}))
import { SignupPlanGate } from "./signup-plan-gate"

function renderGate(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  render(
    <QueryClientProvider client={client}>
      <SignupPlanGate>
        <p>Console contents</p>
      </SignupPlanGate>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.scope = "self"
  mocks.context = { ready: true, teamKey: "use:team" }
})
describe("signup plan gate", () => {
  it("keeps a server-verified YC team on the dashboard", () => {
    mocks.context = { ready: true, teamKey: "use:yc-team" }
    const client = new QueryClient()
    client.setQueryData(["signup-plan", "use:yc-team"], {
      userId: "owner",
      state: "yc_claim",
      offer: null,
      teamKey: "use:yc-team",
    })
    renderGate(client)
    expect(screen.getByText("Console contents")).toBeVisible()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.getPlan).not.toHaveBeenCalled()
  })
  it("sends a team that still needs a plan to onboarding", async () => {
    mocks.getPlan.mockResolvedValue({
      userId: "owner",
      teamKey: "use:team",
      state: "selecting",
      offer: null,
    })
    renderGate()
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/onboarding/plan"),
    )
    expect(mocks.getPlan).toHaveBeenCalledWith("use:team")
  })
  it("keeps the console usable when the read fails", async () => {
    mocks.getPlan.mockRejectedValue(new Error("Unavailable"))
    renderGate()
    await waitFor(() => expect(mocks.getPlan).toHaveBeenCalled())
    expect(screen.getByText("Console contents")).toBeVisible()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(mocks.replace).not.toHaveBeenCalled()
  })
  it("leaves impersonation read-only and outside onboarding", () => {
    mocks.scope = "impersonated-team"
    renderGate()
    expect(screen.getByText("Console contents")).toBeVisible()
    expect(mocks.getPlan).not.toHaveBeenCalled()
  })
})
