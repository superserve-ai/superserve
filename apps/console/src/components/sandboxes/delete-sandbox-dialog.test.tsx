/**
 * delete-sandbox-dialog — the destructive-action gate.
 *
 * Users must type the exact sandbox name (or, in bulk, "delete N sandboxes")
 * before the confirm button enables. This test covers both variants and
 * ensures the callback is only invoked when the input matches.
 */

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mocks — see src/test/mocks.tsx for shared helpers; dialog uses more
// than the common set, so define here.
vi.mock("@superserve/ui", async () => {
  const actual = await import("react")
  return {
    cn: (...classes: Array<string | undefined | false>) =>
      classes.filter(Boolean).join(" "),
    Button: (props: React.JSX.IntrinsicElements["button"]) => (
      <button type="button" {...props} />
    ),
    Dialog: ({
      children,
      open,
    }: {
      children: React.ReactNode
      open: boolean
    }) => (open ? <div role="dialog">{children}</div> : null),
    DialogPopup: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DialogTitle: ({ children }: { children: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
    DialogDescription: ({ children }: { children: React.ReactNode }) => (
      <p>{children}</p>
    ),
    DialogFooter: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Field: ({
      label,
      children,
    }: {
      label: React.ReactNode
      children: React.ReactNode
    }) => (
      <label>
        {label}
        {children}
      </label>
    ),
    Input: (props: React.JSX.IntrinsicElements["input"]) => (
      <input {...props} />
    ),
    __actual: actual,
  }
})

vi.mock("motion/react", () => ({
  motion: {
    div: (props: React.JSX.IntrinsicElements["div"]) => <div {...props} />,
  },
}))

vi.mock("@phosphor-icons/react", () => ({
  WarningIcon: () => <span>warn</span>,
}))

import { DeleteSandboxDialog } from "./delete-sandbox-dialog"

describe("DeleteSandboxDialog — single", () => {
  const user = userEvent.setup()
  let onConfirm: ReturnType<typeof vi.fn<() => void | Promise<void>>>
  let onOpenChange: ReturnType<typeof vi.fn<(open: boolean) => void>>

  beforeEach(() => {
    onConfirm = vi.fn<() => void | Promise<void>>()
    onOpenChange = vi.fn<(open: boolean) => void>()
  })

  function mount() {
    return render(
      <DeleteSandboxDialog
        open={true}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        sandboxName="prod-api"
      />,
    )
  }

  it("disables Delete until the exact sandbox name is typed", async () => {
    mount()

    const button = screen.getByRole("button", { name: "Delete" })
    expect(button).toBeDisabled()

    const input = screen.getByPlaceholderText("prod-api")
    await user.type(input, "prod-ap")
    expect(button).toBeDisabled()

    await user.type(input, "i") // now "prod-api"
    expect(button).not.toBeDisabled()
  })

  it("does not call onConfirm while the name is wrong", async () => {
    mount()

    const input = screen.getByPlaceholderText("prod-api")
    await user.type(input, "wrong")

    const button = screen.getByRole("button", { name: "Delete" })
    await user.click(button)

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("calls onConfirm when the name matches exactly", async () => {
    onConfirm.mockResolvedValue(undefined)
    mount()

    await user.type(screen.getByPlaceholderText("prod-api"), "prod-api")
    await user.click(screen.getByRole("button", { name: "Delete" }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("cancel closes the dialog", async () => {
    mount()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe("DeleteSandboxDialog — bulk", () => {
  const user = userEvent.setup()

  it("requires typing 'delete N sandboxes' in bulk mode", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <DeleteSandboxDialog
        open={true}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
        bulkCount={3}
      />,
    )

    const button = screen.getByRole("button", { name: "Delete" })
    expect(button).toBeDisabled()

    const input = screen.getByPlaceholderText("delete 3 sandboxes")
    await user.type(input, "delete 3 sandboxes")
    expect(button).not.toBeDisabled()

    await user.click(button)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("keeps Delete disabled for the wrong count", async () => {
    render(
      <DeleteSandboxDialog
        open={true}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        bulkCount={5}
      />,
    )

    const button = screen.getByRole("button", { name: "Delete" })
    await user.type(
      screen.getByPlaceholderText("delete 5 sandboxes"),
      "delete 3 sandboxes",
    )
    expect(button).toBeDisabled()
  })
})
