import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import { ids } from "@/lib/yc/test-fixtures"

import { submitIdentityReview } from "./review-actions"
import { ReviewForm } from "./review-form"

vi.mock("./review-actions", () => ({ submitIdentityReview: vi.fn() }))
beforeEach(() => {
  vi.mocked(submitIdentityReview).mockReset()
  vi.stubGlobal("sessionStorage", window.localStorage)
  sessionStorage.clear()
})
it("retains only request identity in storage and never treats a saved review as approval", async () => {
  vi.mocked(submitIdentityReview).mockResolvedValue({
    kind: "saved",
    result: { state: "review_required" },
  })
  render(
    <ReviewForm
      actor={ids.user}
      claim={ids.claim}
      teams={[{ teamId: ids.team, region: "use", name: "Example Team" }]}
    />,
  )
  fireEvent.change(screen.getByLabelText("Original YC verification link"), {
    target: { value: "https://example.com/private-verification" },
  })
  fireEvent.change(screen.getByLabelText("Team"), {
    target: { value: `use:${ids.team}` },
  })
  fireEvent.click(screen.getByRole("button", { name: "Request review" }))
  await waitFor(() => expect(submitIdentityReview).toHaveBeenCalledTimes(1))
  await screen.findByText(/This does not approve the offer/)
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  expect(sessionStorage.length).toBe(1)
  expect(sessionStorage.getItem(sessionStorage.key(0)!)).toMatch(
    /^[a-f0-9-]{36}$/,
  )
  expect(
    JSON.stringify(vi.mocked(submitIdentityReview).mock.calls[0]),
  ).not.toContain("email")
})
