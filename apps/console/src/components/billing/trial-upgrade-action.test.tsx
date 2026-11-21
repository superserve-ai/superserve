import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/use-billing-capabilities", () => ({
  useBillingCapabilities: () => ({ data: { offers: undefined } }),
}))
vi.mock("@/hooks/use-billing-context", () => ({
  useBillingContext: () => ({ teamKey: "use:team-1" }),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "account-1" } }),
}))

import { TrialUpgradeAction } from "./trial-upgrade-action"

function view(requestedOffer: string | undefined, onAction: () => void) {
  const client = new QueryClient()
  client.setQueryData(["signup-plan", "use:team-1"], {
    userId: "account-1",
    requestedOffer,
  })
  return render(
    <QueryClientProvider client={client}>
      <TrialUpgradeAction onAction={onAction} />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe("TrialUpgradeAction onAction", () => {
  it("reports checkout and other plans for a selected plan", () => {
    const onAction = vi.fn()
    view("developer", onAction)
    const form = screen
      .getByRole("button", { name: /^Upgrade to / })
      .closest("form") as HTMLFormElement
    form.addEventListener("submit", (event) => event.preventDefault())
    fireEvent.submit(form)
    fireEvent.click(screen.getByRole("link", { name: "Other plans" }))
    expect(onAction.mock.calls).toEqual([["checkout"], ["other_plans"]])
  })

  it("reports the plan picker without a selected plan", () => {
    const onAction = vi.fn()
    view(undefined, onAction)
    fireEvent.click(screen.getByRole("link", { name: "Upgrade" }))
    expect(onAction).toHaveBeenCalledWith("plan_picker")
  })
})
