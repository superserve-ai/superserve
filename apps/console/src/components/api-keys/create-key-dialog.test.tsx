import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockAddToast = vi.fn()
const mockCapture = vi.fn()
const mockMutate = vi.fn()
const mockUseCreateApiKey = vi.fn((_source?: string) => ({
  mutate: mockMutate,
  isPending: false,
}))

vi.mock("@superserve/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: mockAddToast }),
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

function ControlledCreateKeyDialog() {
  const [open, setOpen] = useState(true)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <CreateKeyDialog open={open} onOpenChange={setOpen} hideTrigger />
    </>
  )
}

function deferredCopy() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("CreateKeyDialog created state", () => {
  const key = "ss_live_test_key_123"
  const command = `export SUPERSERVE_API_KEY=${key}`
  const copyError = "Could not copy. Select the text and copy it by hand."
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

  async function submitKey() {
    await userEvent.type(
      screen.getByPlaceholderText("e.g. Production, CI/CD, Development"),
      "CI",
    )
    await userEvent.click(screen.getByRole("button", { name: "Create Key" }))
  }

  async function createKey() {
    const view = render(<ControlledCreateKeyDialog />)
    await submitKey()
    return view
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
    expect(button).toHaveTextContent(/^Copied$/)
    expect(screen.getByText(key, { selector: "code" })).toBeVisible()
    expect(mockAddToast).toHaveBeenCalledExactlyOnceWith(toast, "success")
    expect(mockCapture).toHaveBeenCalledWith("api_key_copied", { target })
  })

  it.each(["Copy key", "Copy command"])(
    "shows an error when %s cannot write to the clipboard",
    async (label) => {
      await createKey()
      writeText.mockRejectedValueOnce(new Error("Clipboard permission denied"))

      const button = screen.getByRole("button", { name: label })
      const dialog = within(screen.getByRole("dialog"))
      await userEvent.click(button)

      expect(button).toHaveAccessibleName(label)
      expect(mockCapture.mock.calls.map(([event]) => event)).not.toContain(
        "api_key_copied",
      )
      expect(mockAddToast).toHaveBeenCalledExactlyOnceWith(copyError, "error")
      expect(
        dialog.queryByText(copyError, { selector: '[role="alert"]' }),
      ).toBeVisible()

      await userEvent.click(button)

      expect(dialog.queryByText(copyError)).toBeNull()
    },
  )

  it("gives both copied buttons distinct accessible names", async () => {
    await createKey()
    const pending = deferredCopy()
    writeText.mockReturnValueOnce(pending.promise)

    const keyButton = screen.getByRole("button", { name: "Copy key" })
    const commandButton = screen.getByRole("button", { name: "Copy command" })
    await userEvent.click(keyButton)
    await userEvent.click(commandButton)
    await act(async () => pending.resolve())

    expect(keyButton).toHaveAccessibleName("Copied API key")
    expect(commandButton).toHaveAccessibleName("Copied export command")
  })

  it.each(["rejection", "success"])(
    "ignores a stale %s after a newer copy succeeds",
    async (settlement) => {
      await createKey()
      const pending = deferredCopy()
      writeText.mockReturnValueOnce(pending.promise)

      const button = screen.getByRole("button", { name: "Copy key" })
      await userEvent.click(button)
      await userEvent.click(button)
      await act(async () => {
        if (settlement === "rejection") {
          pending.reject(new Error("Clipboard permission denied"))
        } else {
          pending.resolve()
        }
      })

      expect(button).toHaveAccessibleName("Copied API key")
      expect(screen.queryByText(copyError)).toBeNull()
      expect(mockAddToast).toHaveBeenCalledExactlyOnceWith(
        "API key copied to clipboard",
        "success",
      )
      expect(
        mockCapture.mock.calls.filter(([event]) => event === "api_key_copied"),
      ).toEqual([["api_key_copied", { target: "key" }]])
    },
  )

  it("ignores a clipboard rejection after unmounting", async () => {
    const { unmount } = await createKey()
    const pending = deferredCopy()
    writeText.mockReturnValueOnce(pending.promise)

    await userEvent.click(screen.getByRole("button", { name: "Copy key" }))
    unmount()
    await act(async () =>
      pending.reject(new Error("Clipboard permission denied")),
    )

    expect(mockAddToast).not.toHaveBeenCalled()
  })

  it("resets the copied labels independently after two seconds", async () => {
    await createKey()
    vi.useFakeTimers()

    const keyButton = screen.getByRole("button", { name: "Copy key" })
    const commandButton = screen.getByRole("button", { name: "Copy command" })
    await act(async () => {
      fireEvent.click(keyButton)
    })
    act(() => vi.advanceTimersByTime(1000))
    expect(keyButton).toHaveAccessibleName("Copied API key")
    expect(commandButton).toHaveAccessibleName("Copy command")

    await act(async () => {
      fireEvent.click(commandButton)
    })
    act(() => vi.advanceTimersByTime(999))
    expect(keyButton).toHaveTextContent("Copied")
    act(() => vi.advanceTimersByTime(1))
    expect(keyButton).toHaveAccessibleName("Copy key")
    expect(commandButton).toHaveAccessibleName("Copied export command")

    act(() => vi.advanceTimersByTime(999))
    expect(commandButton).toHaveTextContent("Copied")
    act(() => vi.advanceTimersByTime(1))
    expect(commandButton).toHaveAccessibleName("Copy command")
  })

  it("closes and clears the key when Done is clicked", async () => {
    await createKey()
    writeText.mockRejectedValueOnce(new Error("Clipboard permission denied"))
    await userEvent.click(screen.getByRole("button", { name: "Copy key" }))

    await userEvent.click(screen.getByRole("button", { name: "Done" }))

    expect(screen.queryByRole("dialog")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Open dialog" }))

    expect(screen.queryByText(key, { selector: "code" })).toBeNull()
    expect(screen.queryByText(command, { selector: "code" })).toBeNull()

    await submitKey()

    expect(screen.queryByText(copyError)).toBeNull()
  })
})

describe("CreateKeyDialog analytics", () => {
  it("records only a click on submit and labels the server event source", async () => {
    render(<CreateKeyDialog open hideTrigger />)

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
