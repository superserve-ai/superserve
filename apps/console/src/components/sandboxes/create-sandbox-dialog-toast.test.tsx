import { ToastProvider } from "@superserve/ui"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { CreateSandboxDialog } from "./create-sandbox-dialog"

vi.mock("@/hooks/use-sandboxes", () => ({
  useCreateSandbox: () => ({ mutate: vi.fn(), isPending: false }),
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
  usePostHog: () => ({ capture: vi.fn() }),
}))

const TOAST_TEXT = "Timeout must be a whole number between 1 and 604800."

// happy-dom has no layout or hit testing, so read the stacking order from the
// Tailwind z-index utility on each fixed layer instead.
function zIndex(element: Element) {
  const match = element.className.match(/(?:^|\s)z-(?:\[)?(\d+)(?:\])?(?:\s|$)/)
  if (!match) throw new Error(`no z-index utility on: ${element.className}`)
  return Number(match[1])
}

// The element a real click at the toast's position lands on: the higher
// z-index layer wins, and on a tie the layer later in the DOM wins (the dialog
// portal mounts after the toast region). This mirrors the browser hit test
// that happy-dom does not do.
function hitTarget(toastElement: HTMLElement) {
  const region = toastElement.closest('[data-slot="toast-region"]')!
  const backdrop = document.querySelector<HTMLElement>(".ss-dialog-backdrop")
  if (!backdrop) return toastElement
  const toastZ = zIndex(region)
  const backdropZ = zIndex(backdrop)
  if (toastZ !== backdropZ) return toastZ > backdropZ ? toastElement : backdrop
  const backdropIsLater =
    region.compareDocumentPosition(backdrop) & Node.DOCUMENT_POSITION_FOLLOWING
  return backdropIsLater ? backdrop : toastElement
}

async function openDialogWithToast() {
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <CreateSandboxDialog />
    </ToastProvider>,
  )

  await user.click(screen.getByRole("button", { name: "Create sandbox" }))
  const dialog = await screen.findByRole("dialog")
  const name = within(dialog).getByPlaceholderText("my-sandbox")
  await user.type(name, "keep-me")
  await user.click(
    within(dialog).getByRole("button", { name: "Advanced Options" }),
  )
  const timeout = within(dialog).getByPlaceholderText("No timeout")
  await user.type(timeout, "0")

  // An out-of-range timeout makes Create show an error toast and keep the
  // dialog open.
  await user.click(
    within(dialog).getByRole("button", { name: "Create Sandbox" }),
  )
  await screen.findByText(TOAST_TEXT)

  return { user, name, timeout }
}

it("stacks toasts above the dialog backdrop and popup", async () => {
  await openDialogWithToast()

  const region = document.querySelector('[data-slot="toast-region"]')!
  expect(region).toContainElement(screen.getByText(TOAST_TEXT))
  const backdrop = document.querySelector(".ss-dialog-backdrop")!
  const popup = screen.getByRole("dialog")

  expect(zIndex(region)).toBeGreaterThan(zIndex(backdrop))
  expect(zIndex(region)).toBeGreaterThan(zIndex(popup))
})

it("keeps the dialog open and its form intact when a toast is dismissed", async () => {
  const { user, name, timeout } = await openDialogWithToast()

  // The open modal dialog sets aria-hidden on the toast region, so the query
  // needs `hidden: true` to find the dismiss button.
  const dismiss = screen.getByRole("button", {
    name: "Dismiss notification",
    hidden: true,
  })
  await user.click(hitTarget(dismiss))

  await waitFor(() =>
    expect(screen.queryByText(TOAST_TEXT)).not.toBeInTheDocument(),
  )
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  expect(name).toHaveValue("keep-me")
  expect(timeout).toHaveValue(0)
})

it("still closes the dialog on a backdrop press", async () => {
  // Control for the test above: a press on the backdrop is the outside press
  // that closes the dialog, so a toast must never sit under the backdrop.
  const { user } = await openDialogWithToast()

  await user.click(document.querySelector(".ss-dialog-backdrop")!)

  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  )
})
