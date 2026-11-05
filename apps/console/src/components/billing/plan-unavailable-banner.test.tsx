import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh }),
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    cacheScope: "self",
    teamKey: "use:team",
    ready: true,
  }),
}))
vi.mock("./plan-banner", () => ({ PlanBanner: () => <p>Plan banner</p> }))
import { PlanUnavailableBanner } from "./plan-unavailable-banner"

function mount(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <PlanUnavailableBanner />
    </QueryClientProvider>,
  )
  return client
}

beforeEach(() => vi.clearAllMocks())

it("reruns the server check when asked to try again", () => {
  mount()
  expect(screen.getByText(/Plan and usage: unavailable/)).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(m.refresh).toHaveBeenCalledOnce()
})

it("hands back to the plan banner once the gate's re-check answers", async () => {
  const client = mount()
  expect(screen.queryByText("Plan banner")).toBeNull()
  act(() => {
    client.setQueryData(["signup-plan", "use:team"], {
      userId: "owner",
      teamKey: "use:team",
      state: "committed",
      offer: "free",
    })
  })
  await waitFor(() => expect(screen.getByText("Plan banner")).toBeVisible())
  expect(screen.queryByText(/We couldn’t load your plan details/)).toBeNull()
})
