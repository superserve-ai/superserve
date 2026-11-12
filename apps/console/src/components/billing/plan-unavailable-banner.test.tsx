import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  getPlan: vi.fn(),
  search: new URLSearchParams(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh, replace: m.replace }),
  useSearchParams: () => m.search,
}))
vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: m.getPlan,
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({
    cacheScope: "self",
    teamKey: "use:team",
    ready: true,
  }),
}))
vi.mock("./plan-banner", () => ({ PlanBanner: () => <p>Plan banner</p> }))
import { SignupPlanGate } from "@/components/onboarding/signup-plan-gate"

import { PlanUnavailableBanner } from "./plan-unavailable-banner"

function mount(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <PlanUnavailableBanner />
    </QueryClientProvider>,
  )
  return client
}

const COMMITTED = {
  userId: "owner",
  teamKey: "use:team",
  state: "committed",
  offer: "free",
}

beforeEach(() => {
  vi.clearAllMocks()
  m.search = new URLSearchParams()
  m.getPlan.mockReturnValue(new Promise(() => {}))
})

it("reruns the server check when asked to try again", () => {
  mount()
  expect(screen.getByText(/Plan and usage: unavailable/)).toBeVisible()
  const retry = screen.getByRole("button", { name: "Try again" })
  // The warning banner's dark text is unreadable on the outline button's dark
  // background, so Try again uses the filled button like other warning banners.
  expect(retry).toHaveClass("bg-primary")
  expect(retry).not.toHaveClass("bg-background")
  fireEvent.click(retry)
  expect(m.refresh).toHaveBeenCalledOnce()
})

it("hands back to the plan banner once the gate's re-check answers", async () => {
  const client = mount()
  expect(screen.queryByText("Plan banner")).toBeNull()
  act(() => {
    client.setQueryData(["signup-plan", "use:team"], COMMITTED)
  })
  await waitFor(() => expect(screen.getByText("Plan banner")).toBeVisible())
  expect(screen.queryByText(/We couldn’t load your plan details/)).toBeNull()
})

it("keeps the gate's retries when Try again rerenders the notice", async () => {
  let reject: (error: Error) => void = () => {}
  m.getPlan
    .mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail
      }),
    )
    .mockResolvedValueOnce(COMMITTED)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SignupPlanGate>
        <PlanUnavailableBanner />
      </SignupPlanGate>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(m.getPlan).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  act(() => reject(new Error("Unable to check your plan.")))
  await waitFor(() => expect(m.getPlan).toHaveBeenCalledTimes(2), {
    timeout: 3000,
  })
  await waitFor(() => expect(screen.getByText("Plan banner")).toBeVisible())
})

it("doesn't name a plan in the sales notice before the plan is read", () => {
  m.search = new URLSearchParams("contact_sales=1")
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SignupPlanGate>
        <PlanUnavailableBanner />
      </SignupPlanGate>
    </QueryClientProvider>,
  )
  expect(screen.getByText(/Your account is ready\./)).toBeVisible()
  expect(screen.queryByText(/Free account/)).toBeNull()
})
