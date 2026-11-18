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
  const newKey = "ss_live_test_key_456"
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
    const keyCode = screen.getByText(key, { selector: "code" })
    expect(keyCode).toBeVisible()
    expect(keyCode).toHaveAttribute("data-mask")
    expect(keyCode).toHaveClass("ph-no-capture")
    expect(
      screen.getByText("Set the key in your shell, then create a sandbox:"),
    ).toBeVisible()
    const commandCode = screen.getByText(command, { selector: "code" })
    expect(commandCode).toBeVisible()
    expect(commandCode).toHaveAttribute("data-mask")
    expect(commandCode).toHaveClass("ph-no-capture")
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

  it.each([
    ["Copy key", key],
    ["Copy command", command],
  ])(
    "shows an error below %s and selects its text when copying fails",
    async (label, text) => {
      await createKey()
      writeText.mockRejectedValueOnce(new Error("Clipboard permission denied"))

      const button = screen.getByRole("button", { name: label })
      const block = within(button.parentElement!)
      await userEvent.click(button)

      const alert = block.getByText(copyError, { selector: '[role="alert"]' })
      expect.soft(screen.getByRole("status")).toBeEmptyDOMElement()
      expect(screen.getAllByText(copyError)).toEqual([alert])
      expect(alert).toBeVisible()
      expect(alert).toHaveClass("text-xs", "text-destructive")
      expect(button.nextElementSibling).toBe(alert)
      expect(window.getSelection()?.toString()).toBe(text)
      expect(button).toHaveAccessibleName(label)
      expect(mockCapture.mock.calls.map(([event]) => event)).not.toContain(
        "api_key_copied",
      )
      expect(mockAddToast).toHaveBeenCalledExactlyOnceWith(copyError, "error")

      await userEvent.click(button)

      expect(block.queryByText(copyError)).toBeNull()
    },
  )

  it("keeps the command error when a subsequent key copy succeeds", async () => {
    await createKey()
    writeText.mockRejectedValueOnce(new Error("Clipboard permission denied"))

    const commandButton = screen.getByRole("button", { name: "Copy command" })
    await userEvent.click(commandButton)
    await userEvent.click(screen.getByRole("button", { name: "Copy key" }))

    expect(screen.getByRole("button", { name: "Copied API key" })).toBeVisible()
    expect(commandButton.nextElementSibling).toHaveTextContent(copyError)
  })

  it("leaves the selection alone when focus moves before a copy fails", async () => {
    await createKey()
    const pending = deferredCopy()
    writeText.mockReturnValueOnce(pending.promise)
    const selection = window.getSelection()!
    selection.removeAllRanges()

    const button = screen.getByRole("button", { name: "Copy key" })
    const done = screen.getByRole("button", { name: "Done" })
    await userEvent.click(button)
    expect(button).toHaveFocus()
    act(() => done.focus())
    expect(done).toHaveFocus()

    await act(async () =>
      pending.reject(new Error("Clipboard permission denied")),
    )

    expect(selection.toString()).toBe("")
    expect(button.nextElementSibling).toHaveTextContent(copyError)
  })

  it("preserves a selection when only its anchor offset changes during a copy", async () => {
    await createKey()
    const pending = deferredCopy()
    const error = new Error("Clipboard permission denied")
    writeText.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(error)

    const button = screen.getByRole("button", { name: "Copy key" })
    const commandText = screen.getByText(command, {
      selector: "code",
    }).firstChild!
    const selection = window.getSelection()!
    act(() => button.focus())
    selection.setBaseAndExtent(commandText, 0, commandText, command.length)
    expect(selection.toString()).toBe(command)

    fireEvent.click(button)
    selection.setBaseAndExtent(commandText, 1, commandText, command.length)
    expect(button).toHaveFocus()

    await act(async () => pending.reject(error))

    expect(selection.toString()).toBe(command.slice(1))

    await act(async () => fireEvent.click(button))

    expect(selection.toString()).toBe(key)
  })

  it.each([
    ["API key", "Copy key", key],
    ["Export command", "Copy command", command],
  ])("selects the %s when reached by keyboard", async (name, label, text) => {
    await createKey()

    const code = screen.getByText(text, { selector: "code" })
    expect(code).toHaveAccessibleName(name)
    expect(code).toHaveAttribute("tabindex", "0")
    expect(code).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-border-focus",
      "focus-visible:outline-none",
    )

    act(() => screen.getByRole("button", { name: label }).focus())
    await userEvent.tab({ shift: true })

    expect(code).toHaveFocus()
    expect(window.getSelection()?.toString()).toBe(text)
  })

  it("announces each successful copy in the same live region", async () => {
    await createKey()

    const status = screen.getByRole("status")
    expect(status).toHaveClass("sr-only")
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(status).toBeEmptyDOMElement()

    await userEvent.click(screen.getByRole("button", { name: "Copy key" }))

    expect(screen.getByRole("status")).toBe(status)
    expect(status.textContent).toBe("API key copied to clipboard")

    await userEvent.click(screen.getByRole("button", { name: "Copy command" }))

    expect(screen.getByRole("status")).toBe(status)
    expect(status.textContent).toBe("Command copied to clipboard")

    const announcement = status.firstChild
    await userEvent.click(
      screen.getByRole("button", { name: "Copied export command" }),
    )

    expect(screen.getByRole("status")).toBe(status)
    expect(status.textContent).toBe("Command copied to clipboard")
    expect(status.firstChild).not.toBe(announcement)

    await userEvent.click(screen.getByRole("button", { name: "Done" }))
    await userEvent.click(screen.getByRole("button", { name: "Open dialog" }))
    await submitKey()

    expect(screen.getByRole("status")).toBeEmptyDOMElement()
  })

  it.each(["Copy key", "Copy command"])(
    "remounts the alert for consecutive failures of %s",
    async (label) => {
      await createKey()
      writeText.mockRejectedValue(new Error("Clipboard permission denied"))
      const button = screen.getByRole("button", { name: label })
      const block = within(button.parentElement!)

      await userEvent.click(button)
      const alert = block.getByRole("alert")

      await userEvent.click(button)
      expect(block.getByRole("alert")).not.toBe(alert)
    },
  )

  it("scrolls each failed target's alert into view", async ({
    onTestFinished,
  }) => {
    await createKey()
    writeText.mockRejectedValue(new Error("Clipboard permission denied"))
    const prototype = HTMLElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "scrollIntoView",
    )
    const scrollIntoView = vi.fn()
    Object.defineProperty(prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
    onTestFinished(() => {
      if (descriptor) {
        Object.defineProperty(prototype, "scrollIntoView", descriptor)
      } else {
        Reflect.deleteProperty(prototype, "scrollIntoView")
      }
    })

    for (const label of ["Copy key", "Copy command", "Copy command"]) {
      scrollIntoView.mockClear()
      const button = screen.getByRole("button", { name: label })
      await userEvent.click(button)

      const alert = within(button.parentElement!).getByRole("alert")
      expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({
        block: "nearest",
      })
      expect(scrollIntoView.mock.contexts[0]).toBe(alert)
    }
  })

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

  it.each(["rejection", "success"])(
    "ignores an old command copy %s after reopening and creating a new key",
    async (settlement) => {
      await createKey()
      const pending = deferredCopy()
      writeText.mockReturnValueOnce(pending.promise)

      await userEvent.click(
        screen.getByRole("button", { name: "Copy command" }),
      )
      await userEvent.click(screen.getByRole("button", { name: "Done" }))
      await userEvent.click(screen.getByRole("button", { name: "Open dialog" }))
      mockMutate.mockImplementationOnce((_name, options) => {
        options.onSuccess({ key: newKey })
      })
      await submitKey()
      expect(screen.getByText(newKey, { selector: "code" })).toBeVisible()
      const captureCount = mockCapture.mock.calls.length

      await act(async () => {
        if (settlement === "rejection") {
          pending.reject(new Error("Clipboard permission denied"))
        } else {
          pending.resolve()
        }
      })

      expect.soft(screen.queryByText(/^Copied$/)).toBeNull()
      expect.soft(screen.queryAllByText(copyError)).toHaveLength(0)
      expect.soft(screen.getByRole("status")).toBeEmptyDOMElement()
      expect.soft(mockCapture).toHaveBeenCalledTimes(captureCount)
      expect.soft(mockAddToast).not.toHaveBeenCalled()
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

  it("restarts the two-second feedback timer when copying again", async () => {
    await createKey()
    vi.useFakeTimers()

    const button = screen.getByRole("button", { name: "Copy key" })
    await act(async () => {
      fireEvent.click(button)
    })
    act(() => vi.advanceTimersByTime(1500))
    await act(async () => {
      fireEvent.click(button)
    })

    act(() => vi.advanceTimersByTime(600))
    expect(button).toHaveTextContent(/^Copied$/)
    act(() => vi.advanceTimersByTime(1399))
    expect(button).toHaveTextContent(/^Copied$/)
    act(() => vi.advanceTimersByTime(1))
    expect(button).toHaveTextContent(/^Copy key$/)
  })

  it.each([
    ["Copy key", newKey],
    ["Copy command", `export SUPERSERVE_API_KEY=${newKey}`],
  ])(
    "discards the %s timer from before the dialog was closed",
    async (label, text) => {
      await createKey()
      vi.useFakeTimers()

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: label }))
      })
      act(() => vi.advanceTimersByTime(1500))
      fireEvent.click(screen.getByRole("button", { name: "Done" }))
      fireEvent.click(screen.getByRole("button", { name: "Open dialog" }))

      mockMutate.mockImplementationOnce((_name, options) => {
        options.onSuccess({ key: newKey })
      })
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "CI" } })
      fireEvent.click(screen.getByRole("button", { name: "Create Key" }))

      const button = screen.getByRole("button", { name: label })
      await act(async () => {
        fireEvent.click(button)
      })

      expect(writeText).toHaveBeenLastCalledWith(text)
      act(() => vi.advanceTimersByTime(600))
      expect(button).toHaveTextContent(/^Copied$/)
    },
  )

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
