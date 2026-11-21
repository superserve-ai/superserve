import { ToastProvider } from "@superserve/ui"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"

import { CreateSandboxDialog } from "./create-sandbox-dialog"

const { mutate, capture } = vi.hoisted(() => ({
  mutate: vi.fn(),
  capture: vi.fn(),
}))
vi.mock("@/hooks/use-sandboxes", () => ({
  useCreateSandbox: () => ({ mutate, isPending: false }),
}))
vi.mock("@/hooks/use-templates", () => ({ useTemplates: () => ({ data: [] }) }))
vi.mock("@/hooks/use-snapshots", () => ({ useSnapshots: () => ({ data: [] }) }))
vi.mock("@/hooks/use-secrets", () => ({ useSecrets: () => ({ data: [] }) }))
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture }) }))
beforeEach(() => vi.clearAllMocks())
const events = (name: string) =>
  capture.mock.calls.filter(([event]) => event === name)
const dialog = (open: boolean) => (
  <ToastProvider>
    <CreateSandboxDialog open={open} hideTrigger />
  </ToastProvider>
)

it("observes external open transitions once, not rerenders or closes", () => {
  const { rerender } = render(dialog(false))
  expect(events("sandbox_create_dialog_opened")).toHaveLength(0)
  rerender(dialog(true))
  const first = events("sandbox_create_dialog_opened")[0][1].flow_id
  rerender(dialog(true))
  rerender(dialog(false))
  expect(events("sandbox_create_dialog_opened")).toHaveLength(1)
  rerender(dialog(true))
  expect(events("sandbox_create_dialog_opened")).toHaveLength(2)
  expect(events("sandbox_create_dialog_opened")[1][1].flow_id).not.toBe(first)
})

it("observes a trigger open once", async () => {
  render(
    <ToastProvider>
      <CreateSandboxDialog />
    </ToastProvider>,
  )
  await userEvent.click(screen.getByRole("button", { name: "Create sandbox" }))
  expect(events("sandbox_create_dialog_opened")).toHaveLength(1)
})

it.each(["click", "Enter"])(
  "records explicit %s rejection without dispatch or legacy success",
  async (action) => {
    render(dialog(true))
    const input = screen.getByRole("textbox", { name: /Sandbox name/ })
    fireEvent.change(input, { target: { value: "" } })
    if (action === "click")
      await userEvent.click(
        screen.getByRole("button", { name: "Create Sandbox" }),
      )
    else {
      await userEvent.click(input)
      screen.getByRole("button", { name: "Create Sandbox" }).focus()
      await userEvent.keyboard("{Enter}")
    }
    const submit = events("sandbox_create_submitted")
    expect(submit).toHaveLength(1)
    expect(events("sandbox_create_client_result")).toEqual([
      [
        "sandbox_create_client_result",
        expect.objectContaining({
          flow_id: submit[0][1].flow_id,
          attempt_id: submit[0][1].attempt_id,
          outcome: "validation_rejected",
          request_dispatched: false,
          request_id: null,
          http_status: null,
        }),
      ],
    ])
    expect(mutate).not.toHaveBeenCalled()
    expect(events("sandbox_created")).toHaveLength(0)
  },
)

it("suppresses duplicate pending submissions and ignores analytics exceptions", () => {
  render(dialog(true))
  capture.mockImplementation(() => {
    throw new Error("analytics")
  })
  const button = screen.getByRole("button", { name: "Create Sandbox" })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(events("sandbox_create_submitted")).toHaveLength(1)
})
