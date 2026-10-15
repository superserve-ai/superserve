import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"
import { setActiveTeamAction } from "@/lib/api/teams-actions"

import { PlanSelectionLoader } from "./plan-selection-loader"

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { signOut } }),
}))
vi.mock("@/lib/api/signup-plan-actions", () => ({
  getSignupPlanAction: vi.fn(),
}))
vi.mock("@/lib/api/teams-actions", () => ({ setActiveTeamAction: vi.fn() }))
vi.mock("./plan-selection", () => ({
  PlanSelection: () => <p>Plan choices</p>,
}))
beforeEach(() => vi.clearAllMocks())

it("blocks a return with a different active team and restores only the checkout team", async () => {
  vi.mocked(getSignupPlanAction).mockRejectedValue(new Error("Team changed"))
  render(
    <PlanSelectionLoader
      expectedTeam="use:original"
      expectedUser="owner"
      billingReturn="success"
    />,
  )
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "account and team that started checkout",
  )
  expect(getSignupPlanAction).toHaveBeenCalledWith(
    "use:original",
    "owner",
    "success",
  )
  expect(screen.queryByText("Plan choices")).not.toBeInTheDocument()
  vi.mocked(setActiveTeamAction).mockResolvedValue(undefined)
  vi.mocked(getSignupPlanAction).mockResolvedValue({
    userId: "owner",
    teamKey: "use:original",
    state: "pending",
    offer: "pro_annual",
  })
  fireEvent.click(
    screen.getByRole("button", { name: "Return to checkout team" }),
  )
  await waitFor(() =>
    expect(setActiveTeamAction).toHaveBeenCalledWith("original", "use"),
  )
  expect(await screen.findByText("Plan choices")).toBeVisible()
})

it("signs out the other account before returning to bound sign-in", async () => {
  vi.mocked(getSignupPlanAction).mockRejectedValue(new Error("Account changed"))
  signOut.mockResolvedValue({ error: null })
  const assign = vi
    .spyOn(window.location, "assign")
    .mockImplementation(() => {})
  render(
    <PlanSelectionLoader
      expectedTeam="use:original"
      expectedUser="owner"
      billingReturn="success"
    />,
  )
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Sign out and use another account",
    }),
  )
  await waitFor(() => expect(assign).toHaveBeenCalled())
  expect(signOut).toHaveBeenCalledWith({ scope: "local" })
  const next = new URL(
    assign.mock.lastCall![0],
    "https://console.superserve.ai",
  ).searchParams.get("next")!
  const destination = new URL(next, "https://console.superserve.ai")
  expect(destination.searchParams.get("account")).toBe("owner")
  expect(destination.searchParams.get("team")).toBe("use:original")
  expect(destination.searchParams.get("billing")).toBe("success")
})
