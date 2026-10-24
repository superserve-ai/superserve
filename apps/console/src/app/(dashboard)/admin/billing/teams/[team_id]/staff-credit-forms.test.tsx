import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import type { StaffCredit } from "@/lib/admin/team-billing"

import { grantStaffCreditAction } from "./actions"
import {
  parseDollarsToCents,
  ResumeStaffCreditButton,
  StaffCreditForm,
} from "./staff-credit-forms"

vi.mock("./actions", () => ({ grantStaffCreditAction: vi.fn() }))

const team = "22222222-2222-4222-8222-222222222222"

beforeEach(() => vi.mocked(grantStaffCreditAction).mockReset())

function fill(amount: string, reason: string) {
  fireEvent.change(screen.getByLabelText(/Credit amount/), {
    target: { value: amount },
  })
  fireEvent.change(screen.getByLabelText(/Reason/), {
    target: { value: reason },
  })
}

it("parses credit amounts in dollars to cents exactly", () => {
  expect(parseDollarsToCents("250")).toBe(25000)
  expect(parseDollarsToCents("0.1")).toBe(10)
  expect(parseDollarsToCents("19.99")).toBe(1999)
  expect(parseDollarsToCents("1000000")).toBe(100_000_000)
  for (const bad of [
    "",
    "0",
    "-5",
    "1.234",
    "1e3",
    "abc",
    "1,000",
    "1000000.01",
  ]) {
    expect(parseDollarsToCents(bad)).toBeNull()
  }
})

it("freezes a request whose outcome is unknown until it is retried as-is", async () => {
  let loseResponse!: (reason: Error) => void
  vi.mocked(grantStaffCreditAction)
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          loseResponse = reject
        }),
    )
    .mockResolvedValueOnce({ kind: "saved" })
  render(<StaffCreditForm region="use" teamId={team} />)
  fill("125.50", "Outage goodwill")
  fireEvent.click(screen.getByRole("button", { name: "Grant $125.50" }))
  expect(screen.getByLabelText(/Credit amount/)).toBeDisabled()
  expect(screen.getByLabelText(/Reason/)).toBeDisabled()
  await act(async () => loseResponse(new Error("lost response")))
  await screen.findByText(/Stripe may have granted the credit/)
  expect(screen.getByLabelText(/Credit amount/)).toBeDisabled()
  expect(screen.getByLabelText(/Reason/)).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Retry same request" }))
  await screen.findByText("Credit granted.")
  const [first, second] = vi
    .mocked(grantStaffCreditAction)
    .mock.calls.map(([input]) => input)
  expect(first).toMatchObject({ amountCents: 12550, reason: "Outage goodwill" })
  expect(second).toEqual(first)
})

it("starts a new request only when staff abandon the unknown one", async () => {
  vi.mocked(grantStaffCreditAction)
    .mockResolvedValueOnce({ kind: "unavailable" })
    .mockResolvedValueOnce({ kind: "saved" })
  render(<StaffCreditForm region="use" teamId={team} />)
  fill("10", "First")
  fireEvent.click(screen.getByRole("button", { name: "Grant $10.00" }))
  await screen.findByRole("button", { name: "Start a new request" })
  fireEvent.click(screen.getByRole("button", { name: "Start a new request" }))
  fill("12", "Second")
  fireEvent.click(screen.getByRole("button", { name: "Grant $12.00" }))
  await waitFor(() => expect(grantStaffCreditAction).toHaveBeenCalledTimes(2))
  const [first, second] = vi
    .mocked(grantStaffCreditAction)
    .mock.calls.map(([input]) => input)
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
})

it("resumes a pending credit with its original request", async () => {
  vi.mocked(grantStaffCreditAction).mockResolvedValue({ kind: "saved" })
  const credit: StaffCredit = {
    id: "c1",
    idempotency_key: "original-key",
    amount_cents: 2500,
    reason: "Goodwill",
    requested_by: "u1",
    requested_at: "2026-10-23T10:00:00Z",
    state: "pending",
    stripe_credit_grant_id: null,
    issued_at: null,
    last_error: "Stripe timed out",
  }
  render(<ResumeStaffCreditButton region="use" teamId={team} credit={credit} />)
  fireEvent.click(screen.getByRole("button", { name: "Resume" }))
  await screen.findByText("Issued")
  expect(grantStaffCreditAction).toHaveBeenCalledWith({
    region: "use",
    teamId: team,
    idempotencyKey: "original-key",
    amountCents: 2500,
    reason: "Goodwill",
  })
})

it("freezes a request after a conflict too", async () => {
  vi.mocked(grantStaffCreditAction).mockResolvedValueOnce({ kind: "conflict" })
  render(<StaffCreditForm region="use" teamId={team} />)
  fill("10", "First")
  fireEvent.click(screen.getByRole("button", { name: "Grant $10.00" }))
  await screen.findByText(/Check the staff credit list/)
  expect(screen.getByLabelText(/Credit amount/)).toBeDisabled()
  expect(
    screen.getByRole("button", { name: "Start a new request" }),
  ).toBeInTheDocument()
})

it.each([
  ["ASCII", "a".repeat(2000)],
  ["multibyte BMP", "é".repeat(1000)],
  ["astral", "😀".repeat(500)],
])(
  "enforces the trimmed 2000-byte credit reason boundary for %s",
  async (_, reason) => {
    vi.mocked(grantStaffCreditAction).mockResolvedValue({ kind: "saved" })
    render(<StaffCreditForm region="use" teamId={team} />)
    fill("10", `${reason}a`)
    const field = screen.getByLabelText(/Reason/)
    const submit = screen.getByRole("button", { name: "Grant $10.00" })
    expect(
      screen.getByText("Use at most 2,000 UTF-8 bytes for the reason."),
    ).toBeInTheDocument()
    expect(field).toHaveAccessibleDescription(
      "Use at most 2,000 UTF-8 bytes for the reason.",
    )
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(submit).toBeDisabled()
    fireEvent.submit(field.closest("form")!)
    expect(grantStaffCreditAction).not.toHaveBeenCalled()
    fill("10", reason)
    expect(
      screen.queryByText("Use at most 2,000 UTF-8 bytes for the reason."),
    ).toBeNull()
    expect(field).toHaveValue(reason)
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() =>
      expect(grantStaffCreditAction).toHaveBeenCalledWith(
        expect.objectContaining({ reason }),
      ),
    )
  },
)

it("checks the same trimmed reason that the action validates", async () => {
  vi.mocked(grantStaffCreditAction).mockResolvedValue({ kind: "saved" })
  render(<StaffCreditForm region="use" teamId={team} />)
  const reason = ` ${"😀".repeat(500)} `
  fill("10", reason)
  expect(
    screen.queryByText("Use at most 2,000 UTF-8 bytes for the reason."),
  ).toBeNull()
  const submit = screen.getByRole("button", { name: "Grant $10.00" })
  expect(submit).toBeEnabled()
  fireEvent.click(submit)
  await waitFor(() =>
    expect(grantStaffCreditAction).toHaveBeenCalledWith(
      expect.objectContaining({ reason }),
    ),
  )
})
