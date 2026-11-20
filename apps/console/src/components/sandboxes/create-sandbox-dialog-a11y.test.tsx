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

it("switches sources after translation replaces both source text nodes", async () => {
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <CreateSandboxDialog open hideTrigger />
    </ToastProvider>,
  )

  const template = screen.getByRole("button", { name: "Template" })
  const snapshot = screen.getByRole("button", { name: "Snapshot", exact: true })
  for (const [button, translated] of [
    [template, "Imagen"],
    [snapshot, "Instantánea"],
  ] as const) {
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
    const textNodes: Text[] = []
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text)
    for (const text of textNodes) {
      const font = document.createElement("font")
      font.textContent = translated
      text.replaceWith(font)
    }
  }

  for (let i = 0; i < 2; i++) {
    await user.click(snapshot)
    expect(snapshot).toHaveAttribute("aria-pressed", "true")
    expect(template).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByText("Select a snapshot")).toBeInTheDocument()

    await user.click(template)
    expect(template).toHaveAttribute("aria-pressed", "true")
    expect(snapshot).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByText("superserve/base")).toBeInTheDocument()
  }
  expect(template).toHaveAccessibleName("Imagen")
  expect(snapshot).toHaveAccessibleName("Instantánea")
})
