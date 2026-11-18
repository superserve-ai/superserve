import { ToastProvider } from "@superserve/ui"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

beforeEach(() => {
  vi.clearAllMocks()
  mockMutate.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("CreateKeyDialog created state", () => {
  const key = "ss_live_test_key_123"
  const command = `export SUPERSERVE_API_KEY=${key}`
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
  const writeText = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    mockMutate.mockImplementation((_name, options) => {
      options.onSuccess({ key })
    })
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
  })

  afterEach(() => {
    if (clipboard) {
      Object.defineProperty(navigator, "clipboard", clipboard)
    } else {
      Reflect.deleteProperty(navigator, "clipboard")
    }
    expect(JSON.stringify(mockCapture.mock.calls)).not.toContain(key)
  })

  async function createKey() {
    const onOpenChange = vi.fn()
    render(
      <ToastProvider>
        <CreateKeyDialog open onOpenChange={onOpenChange} hideTrigger />
      </ToastProvider>,
    )

    await userEvent.type(
      screen.getByPlaceholderText("e.g. Production, CI/CD, Development"),
      "CI",
    )
    await userEvent.click(screen.getByRole("button", { name: "Create Key" }))
    return onOpenChange
  }

  it("shows the key and the shell command", async () => {
    await createKey()

    expect(
      screen.getByRole("heading", { name: "API key created" }),
    ).toBeVisible()
    expect(
      screen.getByText(
        "Copy this key now. You cannot see it again after you close this window.",
      ),
    ).toBeVisible()
    expect(screen.getByText("Your API key")).toBeVisible()
    expect(screen.getByText(key, { selector: "code" })).toBeVisible()
    expect(
      screen.getByText("Set the key in your shell, then create a sandbox:"),
    ).toBeVisible()
    expect(screen.getByText(command, { selector: "code" })).toBeVisible()
  })

  it.each([
    ["Copy key", key, "key", "API key copied to clipboard"],
    ["Copy command", command, "export_command", "Command copied to clipboard"],
  ])("copies and tracks %s", async (label, text, target, toast) => {
    await createKey()

    const button = screen.getByRole("button", { name: label })
    await userEvent.click(button)

    expect(writeText).toHaveBeenCalledExactlyOnceWith(text)
    expect(button).toHaveAccessibleName("Copied")
    expect(screen.getByText(key, { selector: "code" })).toBeVisible()
    expect(screen.getByText(toast)).toBeInTheDocument()
    expect(mockCapture).toHaveBeenCalledWith("api_key_copied", { target })
  })

  it.each(["Copy key", "Copy command"])(
    "shows an error when %s cannot write to the clipboard",
    async (label) => {
      await createKey()
      writeText.mockRejectedValueOnce(new Error("Clipboard permission denied"))

      await userEvent.click(screen.getByRole("button", { name: label }))

      expect(screen.queryByRole("button", { name: "Copied" })).toBeNull()
      expect(screen.getByRole("button", { name: label })).toBeVisible()
      expect(mockCapture.mock.calls.map(([event]) => event)).not.toContain(
        "api_key_copied",
      )
      expect(
        screen.getByText(
          "Could not copy. Select the text and copy it by hand.",
        ),
      ).toBeInTheDocument()
    },
  )

  it("resets the copied labels independently after two seconds", async () => {
    await createKey()
    vi.useFakeTimers()

    const keyButton = screen.getByRole("button", { name: "Copy key" })
    const commandButton = screen.getByRole("button", { name: "Copy command" })
    await act(async () => {
      fireEvent.click(keyButton)
    })
    act(() => vi.advanceTimersByTime(1000))
    expect(keyButton).toHaveAccessibleName("Copied")
    expect(commandButton).toHaveAccessibleName("Copy command")

    await act(async () => {
      fireEvent.click(commandButton)
    })
    act(() => vi.advanceTimersByTime(1000))
    expect(keyButton).toHaveAccessibleName("Copy key")
    expect(commandButton).toHaveAccessibleName("Copied")

    act(() => vi.advanceTimersByTime(1000))
    expect(commandButton).toHaveAccessibleName("Copy command")
  })

  it("closes and clears the key when Done is clicked", async () => {
    const onOpenChange = await createKey()

    await userEvent.click(screen.getByRole("button", { name: "Done" }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByText(key, { selector: "code" })).toBeNull()
    expect(screen.queryByText(command, { selector: "code" })).toBeNull()
  })
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
