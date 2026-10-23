import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import {
  cancelPlanChangeAction,
  previewPlanChangeAction,
  schedulePlanChangeAction,
} from "./actions"
import {
  CancelPlanChangeForm,
  SchedulePlanChangeForm,
} from "./plan-change-forms"

vi.mock("./actions", () => ({
  schedulePlanChangeAction: vi.fn(),
  cancelPlanChangeAction: vi.fn(),
  previewPlanChangeAction: vi.fn(),
}))

const preview = {
  kind: "preview" as const,
  preview: {
    target_offer: "pro_annual",
    terms: {
      offer_key: "pro_annual",
      fee_cents: 1200000,
      interval_months: 12,
      monthly_credit_cents: 100000,
    },
    effective_at: "2027-03-14T09:00:00Z",
    timing: "annual_fee_starts_on_yearly_anniversary",
  },
}

const team = "22222222-2222-4222-8222-222222222222"
const options = [
  { offerKey: "free", label: "Pay as you go", description: "No fee" },
  { offerKey: "pro_annual", label: "Pro annual", description: "$12,000.00" },
]

beforeEach(() => {
  vi.mocked(schedulePlanChangeAction).mockReset()
  vi.mocked(cancelPlanChangeAction).mockReset()
  vi.mocked(previewPlanChangeAction).mockReset()
  vi.mocked(previewPlanChangeAction).mockResolvedValue(preview)
})

async function fill(reason = "Customer asked for annual billing") {
  fireEvent.change(screen.getByLabelText(/New plan/), {
    target: { value: "pro_annual" },
  })
  await screen.findByText("Takes effect March 14, 2027")
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
    <SchedulePlanChangeForm region="use" teamId={team} options={options} />,
  )
  await fill()
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
    <SchedulePlanChangeForm region="use" teamId={team} options={options} />,
  )
  await fill()
  fireEvent.click(screen.getByRole("button", { name: "Schedule change" }))
  await screen.findByText("Plan change scheduled.")
  fireEvent.change(screen.getByLabelText(/New plan/), {
    target: { value: "pro_annual" },
  })
  await screen.findByText("Takes effect March 14, 2027")
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
    <SchedulePlanChangeForm region="use" teamId={team} options={options} />,
  )
  await fill()
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
    <SchedulePlanChangeForm region="use" teamId={team} options={options} />,
  )
  await fill()
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

it("shows the effective date and why before scheduling", async () => {
  render(
    <SchedulePlanChangeForm region="use" teamId={team} options={options} />,
  )
  await fill()
  expect(
    screen.getByText(/annual fee starts only on a yearly anniversary/),
  ).toBeInTheDocument()
  expect(previewPlanChangeAction).toHaveBeenCalledWith({
    region: "use",
    teamId: team,
    targetOffer: "pro_annual",
  })
})

it("blocks scheduling when the preview refuses the change", async () => {
  vi.mocked(previewPlanChangeAction).mockResolvedValue({
    kind: "preview",
    preview: {
      target_offer: "pro_annual",
      terms: preview.preview.terms,
      blocked: "a sponsorship is active",
    },
  })
  render(
    <SchedulePlanChangeForm region="use" teamId={team} options={options} />,
  )
  fireEvent.change(screen.getByLabelText(/New plan/), {
    target: { value: "pro_annual" },
  })
  await screen.findByText(/a sponsorship is active/)
  fireEvent.change(screen.getByLabelText(/Reason/), {
    target: { value: "upgrade" },
  })
  expect(screen.getByRole("button", { name: "Schedule change" })).toBeDisabled()
})

it("ignores a slow preview for a plan the user moved away from", async () => {
  let resolveSlow: (value: typeof preview) => void = () => {}
  vi.mocked(previewPlanChangeAction)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSlow = resolve
        }),
    )
    .mockResolvedValueOnce({
      kind: "preview",
      preview: {
        target_offer: "free",
        terms: { ...preview.preview.terms, offer_key: "free", fee_cents: 0 },
        blocked: "the team is already on this plan",
      },
    })
  render(
    <SchedulePlanChangeForm region="use" teamId={team} options={options} />,
  )
  fireEvent.change(screen.getByLabelText(/New plan/), {
    target: { value: "pro_annual" },
  })
  fireEvent.change(screen.getByLabelText(/New plan/), {
    target: { value: "free" },
  })
  await screen.findByText(/already on this plan/)
  resolveSlow(preview)
  await waitFor(() =>
    expect(screen.queryByText(/Takes effect/)).not.toBeInTheDocument(),
  )
  fireEvent.change(screen.getByLabelText(/Reason/), {
    target: { value: "downgrade" },
  })
  expect(screen.getByRole("button", { name: "Schedule change" })).toBeDisabled()
})

it("lets staff check the effective date again after a failed preview", async () => {
  vi.mocked(previewPlanChangeAction).mockResolvedValueOnce({
    kind: "unavailable",
  })
  render(
    <SchedulePlanChangeForm region="use" teamId={team} options={options} />,
  )
  fireEvent.change(screen.getByLabelText(/New plan/), {
    target: { value: "pro_annual" },
  })
  fireEvent.click(await screen.findByRole("button", { name: "Check again" }))
  await screen.findByText("Takes effect March 14, 2027")
})
