import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import {
  cancelPlanChangeAction,
  grantStaffCreditAction,
  schedulePlanChangeAction,
} from "./actions"
import {
  CancelPlanChangeForm,
  parseDollarsToCents,
  SchedulePlanChangeForm,
  StaffCreditForm,
} from "./plan-change-forms"

vi.mock("./actions", () => ({
  schedulePlanChangeAction: vi.fn(),
  cancelPlanChangeAction: vi.fn(),
  grantStaffCreditAction: vi.fn(),
}))

const team = "22222222-2222-4222-8222-222222222222"
const options = [
  { offerKey: "free", label: "Pay as you go", description: "No fee" },
  { offerKey: "pro_annual", label: "Pro annual", description: "$12,000.00" },
]

beforeEach(() => {
  vi.mocked(schedulePlanChangeAction).mockReset()
  vi.mocked(cancelPlanChangeAction).mockReset()
  vi.mocked(grantStaffCreditAction).mockReset()
})

function fill(reason = "Customer asked for annual billing") {
  fireEvent.change(screen.getByLabelText(/New plan/), {
    target: { value: "pro_annual" },
  })
  fireEvent.change(screen.getByLabelText(/Reason/), {
    target: { value: reason },
  })
}

it("retries a lost request with the same idempotency key", async () => {
  vi.mocked(schedulePlanChangeAction)
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce({ kind: "unavailable" })
    .mockResolvedValueOnce({ kind: "saved" })
  render(
    <SchedulePlanChangeForm
      region="use"
      teamId={team}
      options={options}
      nextAnniversary="Nov 23, 2026"
    />,
  )
  fill()
  fireEvent.click(screen.getByRole("button", { name: "Schedule change" }))
  await screen.findByText(/Retry to send the same request/)
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await waitFor(() => expect(schedulePlanChangeAction).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await screen.findByText("Plan change scheduled.")
  const keys = vi
    .mocked(schedulePlanChangeAction)
    .mock.calls.map(([input]) => input.idempotencyKey)
  expect(new Set(keys).size).toBe(1)
  expect(vi.mocked(schedulePlanChangeAction).mock.calls[0][0]).toMatchObject({
    region: "use",
    teamId: team,
    targetOffer: "pro_annual",
    reason: "Customer asked for annual billing",
  })
})

it("uses a new idempotency key for the next change", async () => {
  vi.mocked(schedulePlanChangeAction).mockResolvedValue({ kind: "saved" })
  render(
    <SchedulePlanChangeForm
      region="use"
      teamId={team}
      options={options}
      nextAnniversary="Nov 23, 2026"
    />,
  )
  fill()
  fireEvent.click(screen.getByRole("button", { name: "Schedule change" }))
  await screen.findByText("Plan change scheduled.")
  fireEvent.change(screen.getByLabelText(/New plan/), {
    target: { value: "pro_annual" },
  })
  const first = vi.mocked(schedulePlanChangeAction).mock.calls[0][0]
  fireEvent.change(screen.getByLabelText(/Reason/), {
    target: { value: first.reason },
  })
  fireEvent.click(screen.getByRole("button", { name: "Schedule change" }))
  await waitFor(() => expect(schedulePlanChangeAction).toHaveBeenCalledTimes(2))
  const second = vi.mocked(schedulePlanChangeAction).mock.calls[1][0]
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
})

it("does not reuse an unconfirmed request's key for edited input", async () => {
  vi.mocked(schedulePlanChangeAction)
    .mockResolvedValueOnce({ kind: "unavailable" })
    .mockResolvedValueOnce({ kind: "conflict" })
  render(
    <SchedulePlanChangeForm
      region="use"
      teamId={team}
      options={options}
      nextAnniversary="Nov 23, 2026"
    />,
  )
  fill()
  fireEvent.click(screen.getByRole("button", { name: "Schedule change" }))
  await screen.findByText(/Retry to send the same request/)
  fireEvent.change(screen.getByLabelText(/Reason/), {
    target: { value: "A different reason" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await waitFor(() => expect(schedulePlanChangeAction).toHaveBeenCalledTimes(2))
  const [first, second] = vi
    .mocked(schedulePlanChangeAction)
    .mock.calls.map(([input]) => input)
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
})

it("explains a conflicting billing state", async () => {
  vi.mocked(schedulePlanChangeAction).mockResolvedValue({ kind: "conflict" })
  render(
    <SchedulePlanChangeForm
      region="use"
      teamId={team}
      options={options}
      nextAnniversary="Nov 23, 2026"
    />,
  )
  fill()
  fireEvent.click(screen.getByRole("button", { name: "Schedule change" }))
  await screen.findByText(/does not allow this change/)
})

it("requires a reason to cancel", async () => {
  vi.mocked(cancelPlanChangeAction).mockResolvedValue({ kind: "saved" })
  render(
    <CancelPlanChangeForm
      region="use"
      teamId={team}
      changeId="33333333-3333-4333-8333-333333333333"
    />,
  )
  const button = screen.getByRole("button", { name: "Cancel scheduled change" })
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText(/Cancellation reason/), {
    target: { value: "Customer changed their mind" },
  })
  fireEvent.click(button)
  await waitFor(() =>
    expect(cancelPlanChangeAction).toHaveBeenCalledWith({
      region: "use",
      teamId: team,
      changeId: "33333333-3333-4333-8333-333333333333",
      reason: "Customer changed their mind",
    }),
  )
})

it("parses credit amounts in dollars to cents exactly", () => {
  expect(parseDollarsToCents("250")).toBe(25000)
  expect(parseDollarsToCents("0.1")).toBe(10)
  expect(parseDollarsToCents("19.99")).toBe(1999)
  for (const bad of ["", "0", "-5", "1.234", "1e3", "abc", "1,000"]) {
    expect(parseDollarsToCents(bad)).toBeNull()
  }
})

it("grants staff credit in cents and keeps the key for a retry", async () => {
  vi.mocked(grantStaffCreditAction)
    .mockResolvedValueOnce({ kind: "unavailable" })
    .mockResolvedValueOnce({ kind: "saved" })
  render(<StaffCreditForm region="use" teamId={team} />)
  fireEvent.change(screen.getByLabelText(/Credit amount/), {
    target: { value: "125.50" },
  })
  fireEvent.change(screen.getByLabelText(/Reason/), {
    target: { value: "Outage goodwill" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Grant credit" }))
  await screen.findByText(/Retry to send the same request/)
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await screen.findByText("Credit granted.")
  const [first, second] = vi
    .mocked(grantStaffCreditAction)
    .mock.calls.map(([input]) => input)
  expect(first).toMatchObject({ amountCents: 12550, reason: "Outage goodwill" })
  expect(second.idempotencyKey).toBe(first.idempotencyKey)
})
