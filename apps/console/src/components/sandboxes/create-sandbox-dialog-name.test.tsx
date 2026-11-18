import { ToastProvider } from "@superserve/ui"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

const namePattern = /^sandbox-[a-z0-9]{4}$/
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
  expect(capture).not.toHaveBeenCalled()
  expect(screen.getByText(nameError)).toBeVisible()
  expect(input).toHaveAttribute("aria-invalid", "true")
  expect(input).toHaveAccessibleDescription(nameError)
  expect(input).toHaveFocus()
})

it("clears the name error and submits the corrected name", async () => {
  const user = userEvent.setup()
  renderOpenDialog()
  const input = getNameInput()
  const create = screen.getByRole("button", { name: "Create Sandbox" })

  await user.clear(input)
  await user.click(create)
  expect(screen.getByText(nameError)).toBeVisible()
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
  vi.spyOn(crypto, "getRandomValues")
    .mockImplementationOnce((bytes) => {
      const array = bytes as Uint8Array
      array.set([0, 1, 2, 3])
      return bytes
    })
    .mockImplementationOnce((bytes) => {
      const array = bytes as Uint8Array
      array.set([25, 26, 35, 36])
      return bytes
    })
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <CreateSandboxDialog />
    </ToastProvider>,
  )
  const trigger = screen.getByRole("button", { name: "Create sandbox" })

  await user.click(trigger)
  const input = getNameInput()
  expect(input.value).toBe("sandbox-abcd")
  await user.clear(input)
  await user.type(input, "   ")
  await user.click(screen.getByRole("button", { name: "Create Sandbox" }))
  expect(screen.getByText(nameError)).toBeVisible()

  await user.click(screen.getByRole("button", { name: "Cancel" }))
  await user.click(trigger)

  expect(getNameInput().value).toBe("sandbox-z09a")
  expect(screen.queryByText(nameError)).not.toBeInTheDocument()
})
