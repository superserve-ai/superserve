import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { ids, offered } from "@/lib/yc/test-fixtures"

import { refreshAcceptance, submitAcceptance } from "./actions"
import { OfferJourney } from "./offer-journey"

vi.mock("./actions", () => ({
  submitAcceptance: vi.fn(),
  refreshAcceptance: vi.fn(),
  openOfferBilling: vi.fn(),
  openReadyOfferConsole: vi.fn(),
}))
beforeEach(() => {
  vi.mocked(submitAcceptance).mockReset()
  vi.stubGlobal("sessionStorage", window.localStorage)
  sessionStorage.clear()
})
it("shows pinned terms before accepting and reuses the request after a lost response", async () => {
  vi.mocked(submitAcceptance)
    .mockRejectedValueOnce(new Error("lost"))
    .mockResolvedValue({
      kind: "saved",
      offer: offered({
        state: "accepted",
        accepted_at: "2026-10-21T12:00:00Z",
      }),
    })
  render(<OfferJourney initial={offered()} />)
  expect(screen.getByText("$30,000")).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Open Console" }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("checkbox"))
  fireEvent.click(screen.getByRole("button", { name: "Accept offer" }))
  await screen.findByRole("button", { name: "Retry same acceptance" })
  fireEvent.click(screen.getByRole("button", { name: "Retry same acceptance" }))
  await waitFor(() => expect(submitAcceptance).toHaveBeenCalledTimes(2))
  expect(vi.mocked(submitAcceptance).mock.calls[0]).toEqual(
    vi.mocked(submitAcceptance).mock.calls[1],
  )
  await screen.findByRole("heading", { name: "Offer accepted" })
  expect(
    screen.queryByRole("button", { name: "Open Console" }),
  ).not.toBeInTheDocument()
})
it("does not grant ready access when a hold accompanies uncertain setup", () => {
  render(
    <OfferJourney
      initial={offered({
        state: "outcome_unknown",
        ready: false,
        held: true,
        control_pending: true,
        accepted_at: "2026-10-21T12:00:00Z",
        assignment_id: ids.assignment,
      })}
    />,
  )
  expect(
    screen.getByRole("heading", { name: "Your account needs attention" }),
  ).toBeInTheDocument()
  expect(
    screen.getByText(/does not confirm cancellation or a refund/),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Accept offer" }),
  ).not.toBeInTheDocument()
})

afterEach(() => vi.useRealTimers())
it.each(["revoked", "rejected"] as const)(
  "replaces a ready view with the authoritative %s decision on polling",
  async (state) => {
    vi.useFakeTimers()
    vi.mocked(refreshAcceptance).mockResolvedValue({
      kind: "claim_state",
      state,
    })
    render(
      <OfferJourney
        initial={offered({
          state: "funding_ready",
          ready: true,
          accepted_at: "2026-10-21T12:00:00Z",
          assignment_id: ids.assignment,
          operation_id: ids.operation,
        })}
      />,
    )
    expect(
      screen.getByRole("button", { name: "Open Console" }),
    ).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(
      screen.getByRole("heading", {
        name:
          state === "revoked"
            ? "Your approval has been revoked"
            : "Your claim was not approved",
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Open Console" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Review your next plan")).not.toBeInTheDocument()
  },
)
