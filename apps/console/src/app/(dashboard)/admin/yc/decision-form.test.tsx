import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import type { StaffClaim } from "@/lib/yc/staff-schema"

import { submitStaffDecision } from "./actions"
import { DecisionForm } from "./decision-form"

vi.mock("./actions", () => ({ submitStaffDecision: vi.fn() }))
const claim: StaffClaim = {
  id: "11111111-1111-4111-8111-111111111111",
  state: "manual_review",
  revision: 3,
  submitted_email: "founder@example.com",
  company_identity: null,
  team_id: null,
  claimed_user_id: null,
  home_region: null,
  reason: "Mismatch",
  acceptance_required: false,
  approval_notification: null,
}
beforeEach(() => vi.mocked(submitStaffDecision).mockReset())
function submit() {
  fireEvent.change(screen.getByLabelText("Decision"), {
    target: { value: "reject" },
  })
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "Review completed" },
  })
  fireEvent.change(screen.getByLabelText("Evidence reference"), {
    target: { value: "review evidence" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save decision" }))
}
it("keeps the exact request and region after a lost response", async () => {
  vi.mocked(submitStaffDecision)
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValue({ kind: "saved", claim })
  render(<DecisionForm claim={claim} regions={["use"]} />)
  submit()
  await screen.findByRole("button", { name: "Retry same decision" })
  expect(screen.getByLabelText("Reason")).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Retry same decision" }))
  await waitFor(() => expect(submitStaffDecision).toHaveBeenCalledTimes(2))
  expect(vi.mocked(submitStaffDecision).mock.calls[1]).toEqual(
    vi.mocked(submitStaffDecision).mock.calls[0],
  )
  expect(vi.mocked(submitStaffDecision).mock.calls[0][0]).toMatchObject({
    expected_revision: 3,
    id: claim.id,
    decision: "reject",
  })
})
it("requires a refresh on stale revision instead of retrying a new decision", async () => {
  vi.mocked(submitStaffDecision).mockResolvedValue({ kind: "conflict" })
  render(<DecisionForm claim={claim} regions={["use"]} />)
  submit()
  await screen.findByText(/claim or your permissions changed/)
  expect(
    screen.queryByRole("button", { name: "Retry same decision" }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Save decision" })).toBeDisabled()
})

it.each([
  ["revocation_pending", 1, "Revocation pending"],
  ["revoked", 0, "Revocation confirmed"],
] as const)(
  "reports financial %s from the saved decision response",
  async (state, pending, title) => {
    vi.mocked(submitStaffDecision).mockResolvedValue({
      kind: "saved",
      claim: {
        ...claim,
        state: "revoked",
        financial_authority: {
          kind: "accepted_offer",
          state,
          pending_invalidations: pending,
        },
      },
    })
    render(<DecisionForm claim={claim} regions={["use"]} />)
    fireEvent.change(screen.getByLabelText("Decision"), {
      target: { value: "revoke" },
    })
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Review completed" },
    })
    fireEvent.change(screen.getByLabelText("Evidence reference"), {
      target: { value: "review evidence" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }))
    await screen.findByText(new RegExp(title))
    expect(
      screen.getByText(/does not confirm cancellation or a refund/),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Approval still requires/),
    ).not.toBeInTheDocument()
  },
)
