import { ToastProvider } from "@superserve/ui"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const mockCapture = vi.fn()
const mockMutate = vi.fn()
const mockUseCreateApiKey = vi.fn((_source?: string) => ({
  mutate: mockMutate,
  isPending: false,
}))

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}))
vi.mock("@/hooks/use-api-keys", () => ({
  useCreateApiKey: (source?: string) => mockUseCreateApiKey(source),
}))

import { CreateKeyDialog } from "./create-key-dialog"

afterEach(() => {
  cleanup()
  mockCapture.mockReset()
  mockMutate.mockReset()
  mockUseCreateApiKey.mockClear()
})

describe("CreateKeyDialog analytics", () => {
  it("records only a click on submit and labels the server event source", async () => {
    render(
      <ToastProvider>
        <CreateKeyDialog open onOpenChange={() => {}} hideTrigger />
      </ToastProvider>,
    )

    await userEvent.type(
      screen.getByPlaceholderText("e.g. Production, CI/CD, Development"),
      "CI",
    )
    await userEvent.click(screen.getByRole("button", { name: "Create Key" }))

    expect(mockUseCreateApiKey).toHaveBeenCalledWith("create_dialog")
    expect(mockMutate).toHaveBeenCalledWith("CI", expect.any(Object))
    // The client never sends api_key_created; the server sends it once the
    // key is stored, so the two events cannot double count.
    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockCapture).toHaveBeenCalledWith("api_key_create_clicked", {
      name: "CI",
    })
  })
})
