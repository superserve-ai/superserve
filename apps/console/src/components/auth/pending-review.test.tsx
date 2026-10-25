import { fireEvent, render, screen } from "@testing-library/react"
import { useEffect } from "react"
import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  signOut: vi.fn().mockResolvedValue({}),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { signOut: mocks.signOut } }),
}))
vi.mock("next/script", () => ({
  default: ({ onReady }: { onReady: () => void }) => {
    useEffect(() => {
      onReady()
    }, [onReady])
    return null
  },
}))
import { PendingReview } from "./pending-review"

beforeEach(() => {
  vi.clearAllMocks()
  window.Calendly = {
    initInlineWidget: ({ parentElement }) => {
      parentElement.append(document.createElement("iframe"))
    },
  }
})
const booked = {
  state: "booked" as const,
  startTime: "2026-11-01T12:00:00Z",
  endTime: "2026-11-01T12:25:00Z",
  rescheduleUrl: "https://calendly.com/reschedulings/example-invitee",
}
it("shows existing meeting and actual change link without a fresh booking invite", () => {
  render(<PendingReview email="applicant@example.com" meeting={booked} />)
  expect(
    screen.getByRole("heading", { name: "Your meeting is scheduled" }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole("link", { name: "Change or reschedule meeting" }),
  ).toHaveAttribute("href", booked.rescheduleUrl)
  expect(
    screen.queryByLabelText("Book a meeting with the Superserve team"),
  ).not.toBeInTheDocument()
  expect(screen.getByText(/account stays on hold/)).toBeInTheDocument()
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" })
})
it("does not manufacture a change URL when provider supplies none", () => {
  render(<PendingReview meeting={{ ...booked, rescheduleUrl: null }} />)
  expect(
    screen.queryByRole("link", { name: "Change or reschedule meeting" }),
  ).not.toBeInTheDocument()
  expect(screen.getByText(/To change this meeting/)).toBeInTheDocument()
})
it("keeps unknown provider state separate from a fresh booking invitation", () => {
  render(<PendingReview meeting={{ state: "unavailable" }} />)
  expect(screen.getByText(/couldn’t check your meeting/)).toBeInTheDocument()
  expect(
    screen.queryByLabelText("Book a meeting with the Superserve team"),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Refresh meeting" }))
  expect(mocks.refresh).toHaveBeenCalledOnce()
})
it("sends password recovery through the protected gate to mint account context", () => {
  render(<PendingReview meeting={{ state: "signin_required" }} />)
  expect(
    screen.getByRole("link", {
      name: "Sign in to check your existing meeting",
    }),
  ).toHaveAttribute("href", "/auth/signin?next=%2F")
})
it("treats only an event_scheduled message from its Calendly frame as a refresh hint, never booking proof", () => {
  const { container } = render(
    <PendingReview meeting={{ state: "not_booked" }} />,
  )
  const source = container.querySelector("iframe")!.contentWindow
  for (const [origin, event, sender] of [
    ["https://example.com", "calendly.event_scheduled", source],
    ["https://calendly.com", "calendly.event_type_viewed", source],
    ["https://calendly.com", "calendly.date_and_time_selected", source],
    ["https://calendly.com", "calendly.event_scheduled", window],
  ] as const)
    fireEvent(
      window,
      new MessageEvent("message", { origin, source: sender, data: { event } }),
    )
  expect(mocks.refresh).not.toHaveBeenCalled()
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: "https://calendly.com",
      source,
      data: { event: "calendly.event_scheduled" },
    }),
  )
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(screen.getByText(/Checking your meeting/)).toBeInTheDocument()
  expect(
    screen.queryByText("Your meeting is scheduled"),
  ).not.toBeInTheDocument()
})
