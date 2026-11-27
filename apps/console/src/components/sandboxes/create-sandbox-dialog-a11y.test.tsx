import { ToastProvider } from "@superserve/ui"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"

import { CreateSandboxDialog } from "./create-sandbox-dialog"

const mutate = vi.hoisted(() => vi.fn())
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
  usePostHog: () => ({ capture: vi.fn() }),
}))

it("gives each advanced row removal button a specific, one-based name", async () => {
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <CreateSandboxDialog open hideTrigger />
    </ToastProvider>,
  )

  await user.click(screen.getByRole("button", { name: "Advanced Options" }))

  for (const [section, label] of [
    ["Allow — domains or CIDRs", "Remove allow rule"],
    ["Deny — CIDRs", "Remove deny rule"],
    ["Environment Variables", "Remove environment variable"],
    ["Metadata", "Remove metadata entry"],
  ]) {
    const add = within(screen.getByText(section).parentElement!).getByRole(
      "button",
      { name: "Add" },
    )

    await user.click(add)
    expect(
      screen.getByRole("button", { name: `${label} 1` }),
    ).toBeInTheDocument()

    await user.click(add)
    expect(
      screen.getByRole("button", { name: `${label} 2` }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: `${label} 1` }))
    expect(
      screen.getByRole("button", { name: `${label} 1` }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: `${label} 2` }),
    ).not.toBeInTheDocument()
  }
})

it.each([
  [new ApiError(402, "trial_exhausted", "Trial credit used up."), [false]],
  [new ApiError(500, "internal", "Server error"), undefined],
  [
    new ApiError(402, "sandbox_exceeds_plan_limits", "Use a smaller template."),
    undefined,
  ],
])(
  "closes the dialog only for a billing block (%s)",
  async (error, closeCall) => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    mutate.mockImplementation(
      (_payload: unknown, options: { onError?: (e: unknown) => void }) =>
        options.onError?.(error),
    )
    render(
      <ToastProvider>
        <CreateSandboxDialog open hideTrigger onOpenChange={onOpenChange} />
      </ToastProvider>,
    )

    await user.type(screen.getByPlaceholderText("my-sandbox"), "box")
    await user.click(screen.getByRole("button", { name: "Create Sandbox" }))

    expect(mutate).toHaveBeenCalled()
    if (closeCall) expect(onOpenChange).toHaveBeenCalledWith(...closeCall)
    else expect(onOpenChange).not.toHaveBeenCalled()
  },
)
