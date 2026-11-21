import { ToastProvider } from "@superserve/ui"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, expect, it, vi } from "vitest"

import {
  CreateSandboxDialog,
  generateSandboxName,
} from "./create-sandbox-dialog"

const { mutate, capture } = vi.hoisted(() => ({
  mutate: vi.fn(),
  capture: vi.fn(),
}))

vi.mock("@/hooks/use-sandboxes", () => ({
  useCreateSandbox: () => ({ mutate, isPending: false }),
}))

vi.mock("@/hooks/use-templates", () => ({
  useTemplates: () => ({ data: [] }),
}))

vi.mock("@/hooks/use-snapshots", () => ({
  useSnapshots: () => ({ data: [] }),
}))

vi.mock("@/hooks/use-secrets", () => ({
  useSecrets: () => ({ data: [] }),
}))

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture }),
}))

const namePattern = /^sandbox-[a-z0-9]{6}$/
const nameError = "Enter a name for this sandbox."

beforeEach(() => vi.clearAllMocks())

function renderOpenDialog() {
  render(
    <ToastProvider>
      <CreateSandboxDialog open hideTrigger />
    </ToastProvider>,
  )
}

function getNameInput() {
  return screen.getByRole<HTMLInputElement>("textbox", { name: /Sandbox name/ })
}

function getFieldError() {
  return screen.getByText(nameError)
}

function stubGeneratedNames() {
  vi.spyOn(crypto, "getRandomValues")
    .mockImplementationOnce((bytes) => {
      const array = bytes as Uint8Array
      array.set([0, 1, 2, 3, 4, 5])
      return bytes
    })
    .mockImplementationOnce((bytes) => {
      const array = bytes as Uint8Array
      array.set([25, 26, 35, 36, 37, 38])
      return bytes
    })
}

it("generates sandbox names in the expected format with varying suffixes", () => {
  const names = Array.from({ length: 20 }, () => generateSandboxName())

  for (const name of names) {
    expect(name).toMatch(namePattern)
    expect(name.length).toBeLessThanOrEqual(64)
  }
  expect(new Set(names).size).toBeGreaterThan(1)
})

it("prefills the sandbox name on open", () => {
  renderOpenDialog()

  expect(getNameInput().value).toMatch(namePattern)
})

it("creates a sandbox with the prefilled name", async () => {
  const user = userEvent.setup()
  renderOpenDialog()
  const name = getNameInput().value

  await user.click(screen.getByRole("button", { name: "Create Sandbox" }))

  expect(mutate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ name }),
    expect.any(Object),
  )
})

it.each([
  ["empty", ""],
  ["whitespace-only", "   "],
])("attaches the error before focusing for %s input", async (_, value) => {
  const user = userEvent.setup()
  renderOpenDialog()
  const input = getNameInput()
  const create = screen.getByRole("button", { name: "Create Sandbox" })

  await user.clear(input)
  if (value) await user.type(input, value)
  expect(create).toBeEnabled()

  const focusState = vi.fn()
  input.addEventListener(
    "focus",
    () => {
      const descriptionId = input.getAttribute("aria-describedby") ?? ""
      focusState(
        input.getAttribute("aria-invalid"),
        document.getElementById(descriptionId)?.textContent,
      )
    },
    { once: true },
  )
  await user.click(create)

  expect(focusState).toHaveBeenCalledExactlyOnceWith("true", nameError)
  expect(mutate).not.toHaveBeenCalled()
  expect(capture).not.toHaveBeenCalledWith("sandbox_created", expect.anything())
  expect(getFieldError()).toBeVisible()
  expect(input).toHaveAttribute("aria-invalid", "true")
  expect(input).toHaveAccessibleDescription(nameError)
  expect(input).toHaveFocus()
})

it("describes the error once when submitting with focus already on the empty name input", async () => {
  const user = userEvent.setup()
  renderOpenDialog()
  const input = getNameInput()
  const dialog = within(screen.getByRole("dialog"))

  await user.click(input)
  await user.clear(input)
  expect(input).toHaveFocus()
  expect(input).toHaveValue("")
  expect(input).not.toHaveAttribute("placeholder")
  expect(dialog.queryByText(nameError)).not.toBeInTheDocument()

  fireEvent.click(dialog.getByRole("button", { name: "Create Sandbox" }))

  expect(input).toHaveFocus()
  expect(input).toHaveAttribute("aria-invalid", "true")
  expect(input).toHaveAccessibleDescription(nameError)
  expect(dialog.getAllByText(nameError)).toHaveLength(1)
  expect(dialog.queryByRole("status")).not.toBeInTheDocument()
  // The input's description already reads the error at focus time, so a live
  // region around it would announce the error a second time.
  const liveRegion =
    '[aria-live], [role="alert"], [role="status"], [role="log"], output'
  expect(dialog.getByText(nameError).closest(liveRegion)).toBeNull()
  expect(screen.getByRole("dialog").querySelectorAll(liveRegion)).toHaveLength(
    0,
  )
})

it("clears the name error and submits the corrected name", async () => {
  const user = userEvent.setup()
  renderOpenDialog()
  const input = getNameInput()
  const create = screen.getByRole("button", { name: "Create Sandbox" })

  await user.clear(input)
  await user.click(create)
  expect(getFieldError()).toBeVisible()
  await user.type(input, "dev-sandbox")

  expect(screen.queryByText(nameError)).not.toBeInTheDocument()
  expect(input).not.toHaveAttribute("aria-invalid")

  await user.click(create)

  expect(mutate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ name: "dev-sandbox" }),
    expect.any(Object),
  )
})

it("prefills a fresh name and clears validation when reopened after Cancel", async () => {
  stubGeneratedNames()
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <CreateSandboxDialog />
    </ToastProvider>,
  )
  const trigger = screen.getByRole("button", { name: "Create sandbox" })

  await user.click(trigger)
  const input = getNameInput()
  expect(input.value).toBe("sandbox-abcdef")
  await user.clear(input)
  await user.type(input, "   ")
  await user.click(screen.getByRole("button", { name: "Create Sandbox" }))
  expect(getFieldError()).toBeVisible()

  await user.click(screen.getByRole("button", { name: "Cancel" }))
  await user.click(trigger)

  expect(getNameInput().value).toBe("sandbox-z09abc")
  expect(screen.queryByText(nameError)).not.toBeInTheDocument()
})

it("prefills a fresh name and clears validation when the parent reopens the dialog", async () => {
  function ControlledDialog() {
    const [open, setOpen] = useState(false)

    return (
      <ToastProvider>
        <button type="button" onClick={() => setOpen(true)}>
          Launch sandbox
        </button>
        <CreateSandboxDialog open={open} onOpenChange={setOpen} hideTrigger />
      </ToastProvider>
    )
  }

  stubGeneratedNames()
  const user = userEvent.setup()
  render(<ControlledDialog />)
  const launch = screen.getByRole("button", { name: "Launch sandbox" })

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  await user.click(launch)
  const input = getNameInput()
  expect(input.value).toBe("sandbox-abcdef")

  await user.clear(input)
  await user.type(input, "   ")
  await user.click(screen.getByRole("button", { name: "Create Sandbox" }))
  expect(getFieldError()).toBeVisible()

  await user.click(screen.getByRole("button", { name: "Cancel" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  await user.click(launch)

  expect(getNameInput().value).toBe("sandbox-z09abc")
  expect(screen.queryByText(nameError)).not.toBeInTheDocument()
})

it("ignores Create during the closing transition", () => {
  const { rerender } = render(<CreateSandboxDialog open hideTrigger />, {
    wrapper: ToastProvider,
  })
  const dialog = screen.getByRole("dialog")
  const input = getNameInput()
  const create = within(dialog).getByRole("button", { name: "Create Sandbox" })

  // Keep the popup mounted through the close reset and the late click.
  const finished = new Promise<void>(() => {})
  Object.defineProperty(dialog, "getAnimations", {
    value: () => [{ finished }],
  })

  rerender(<CreateSandboxDialog open={false} hideTrigger />)
  expect(input).toBeInTheDocument()
  expect(input).toHaveValue("")

  create.focus()
  fireEvent.click(create)
  expect(input).not.toHaveAttribute("aria-invalid")
  expect(screen.queryByText(nameError)).not.toBeInTheDocument()
  expect(create).toHaveFocus()
  expect(mutate).not.toHaveBeenCalled()

  rerender(<CreateSandboxDialog open hideTrigger />)
  expect(getNameInput().value).toMatch(namePattern)
  expect(getNameInput()).not.toHaveAttribute("aria-invalid")
  expect(screen.queryByText(nameError)).not.toBeInTheDocument()
})

it("does not submit a name typed during the closing transition", () => {
  const { rerender } = render(<CreateSandboxDialog open hideTrigger />, {
    wrapper: ToastProvider,
  })
  const dialog = screen.getByRole("dialog")
  const input = getNameInput()
  const create = within(dialog).getByRole("button", { name: "Create Sandbox" })

  // Keep the popup mounted through the close reset and the late edit.
  const finished = new Promise<void>(() => {})
  Object.defineProperty(dialog, "getAnimations", {
    value: () => [{ finished }],
  })

  rerender(<CreateSandboxDialog open={false} hideTrigger />)
  fireEvent.change(input, { target: { value: "late-name" } })
  fireEvent.click(create)

  expect(mutate).not.toHaveBeenCalled()
  expect(capture).not.toHaveBeenCalledWith("sandbox_created", expect.anything())
})

it("prefills a fresh name after an edit during the closing transition", () => {
  stubGeneratedNames()
  const { rerender } = render(<CreateSandboxDialog open hideTrigger />, {
    wrapper: ToastProvider,
  })
  const dialog = screen.getByRole("dialog")
  const input = getNameInput()

  // Keep the popup mounted through the close reset and the late edit.
  const finished = new Promise<void>(() => {})
  Object.defineProperty(dialog, "getAnimations", {
    value: () => [{ finished }],
  })

  rerender(<CreateSandboxDialog open={false} hideTrigger />)
  fireEvent.change(input, { target: { value: "x" } })
  expect(input).toHaveValue("x")

  rerender(<CreateSandboxDialog open hideTrigger />)
  expect(getNameInput()).toHaveValue("sandbox-z09abc")
})
