import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import { ids, renewal } from "@/lib/yc/test-fixtures"

import { saveRenewal } from "./actions"
import { RenewalForm } from "./renewal-form"

vi.mock("./actions", () => ({ saveRenewal: vi.fn() }))
beforeEach(() => {
  vi.mocked(saveRenewal).mockReset()
  vi.stubGlobal("sessionStorage", window.localStorage)
  sessionStorage.clear()
})
it("retains Annual while Free is unknown and retries identical boundary and request", async () => {
  vi.mocked(saveRenewal)
    .mockRejectedValueOnce(new Error("lost"))
    .mockResolvedValue({
      kind: "saved",
      renewal: renewal({
        requested: {
          request_id: ids.request,
          choice: "free",
          state: "outcome_unknown",
          terms: null,
        },
      }),
    })
  render(<RenewalForm claim={ids.claim} initial={renewal()} />)
  expect(screen.getByRole("radio", { name: /Pro Monthly/ })).toBeDisabled()
  fireEvent.click(screen.getByRole("radio", { name: /^Free/ }))
  fireEvent.click(screen.getByRole("button", { name: "Request plan change" }))
  await screen.findByRole("button", { name: "Retry same request" })
  expect(screen.getByRole("radio", { name: /^Free/ })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Retry same request" }))
  await waitFor(() => expect(saveRenewal).toHaveBeenCalledTimes(2))
  expect(vi.mocked(saveRenewal).mock.calls[0]).toEqual(
    vi.mocked(saveRenewal).mock.calls[1],
  )
  await screen.findByRole("heading", { name: "Requested: Free" })
  expect(
    screen.getByRole("heading", { name: "Confirmed: Pro Annual" }),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      /last confirmed instruction remains in effect and may renew/,
    ),
  ).toBeInTheDocument()
})
