import { ToastProvider } from "@superserve/ui"
import { render, screen, within } from "@testing-library/react"
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
