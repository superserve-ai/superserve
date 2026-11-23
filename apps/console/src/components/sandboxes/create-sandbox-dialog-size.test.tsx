import { ToastProvider } from "@superserve/ui"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CreateSandboxDialog } from "./create-sandbox-dialog"

const { mutate, templates, snapshots } = vi.hoisted(() => ({
  mutate: vi.fn(),
  templates: { data: [] as unknown[] },
  snapshots: { data: [] as unknown[] },
}))

vi.mock("@/hooks/use-sandboxes", () => ({
  useCreateSandbox: () => ({ mutate, isPending: false }),
}))
vi.mock("@/hooks/use-templates", () => ({ useTemplates: () => templates }))
vi.mock("@/hooks/use-snapshots", () => ({ useSnapshots: () => snapshots }))
vi.mock("@/hooks/use-secrets", () => ({ useSecrets: () => ({ data: [] }) }))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}))

const template = (name: string, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${name.length}`,
  team_id: "team-1",
  name,
  status: "ready",
  vcpu: 1,
  memory_mib: 1024,
  disk_mib: 4096,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
})

const ranged = template("ranged-env", { vcpu_max: 4, memory_max_mib: 4096 })
const plain = template("plain")

function open(templateRef: string) {
  render(
    <ToastProvider>
      <CreateSandboxDialog open hideTrigger initialTemplateRef={templateRef} />
    </ToastProvider>,
  )
}

const summary = () => screen.getByTestId("size-summary").textContent
const create = () => {
  fireEvent.click(screen.getByRole("button", { name: "Create Sandbox" }))
  return mutate.mock.calls[0][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  templates.data = [ranged, plain]
  snapshots.data = []
})

const choose = () =>
  fireEvent.click(screen.getByRole("button", { name: "Choose size" }))
const sizeText = (text: string) =>
  screen
    .getAllByText(text)
    .find((el) => el.tagName === "SPAN" && el.closest("p"))

describe("Create Sandbox size", () => {
  it("shows the template's default and sends no size", () => {
    open("ranged-env")
    expect(sizeText("1 vCPU · 1 GB · can grow to 4 vCPU · 4 GB")).toBeTruthy()
    expect(summary()).toBe("1 vCPU · 1 GB · can grow to 4 vCPU · 4 GB")
    expect(screen.queryByRole("spinbutton", { name: "vCPU" })).toBeNull()
    const req = create()
    expect(req).not.toHaveProperty("vcpu")
    expect(req).not.toHaveProperty("memory_mib")
  })

  it("sends the chosen size, bounded to the range", () => {
    open("ranged-env")
    choose()
    const cpu = screen.getByRole("spinbutton", { name: "vCPU" })
    expect(cpu).toHaveAttribute("aria-valuemin", "1")
    expect(cpu).toHaveAttribute("aria-valuemax", "4")
    fireEvent.click(screen.getByRole("button", { name: "Increase vCPU" }))
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Memory" }), {
      key: "End",
    })
    expect(summary()).toBe("2 vCPU · 4 GB")
    expect(create()).toMatchObject({ vcpu: 2, memory_mib: 4096 })
  })

  it("sends nothing after Use default", () => {
    open("ranged-env")
    choose()
    fireEvent.click(screen.getByRole("button", { name: "Use default" }))
    expect(screen.queryByRole("spinbutton", { name: "vCPU" })).toBeNull()
    const req = create()
    expect(req).not.toHaveProperty("vcpu")
    expect(req).not.toHaveProperty("memory_mib")
  })

  it("shows a fixed template's size with no Choose size", () => {
    open("plain")
    expect(screen.queryByRole("button", { name: "Choose size" })).toBeNull()
    expect(summary()).toBe("1 vCPU · 1 GB")
    expect(create()).not.toHaveProperty("vcpu")
  })

  it("only offers a stepper for a resource with a range", () => {
    templates.data = [template("cpu-only", { vcpu_max: 4 })]
    open("cpu-only")
    expect(summary()).toBe("1 vCPU · 1 GB · can grow to 4 vCPU")
    choose()
    expect(screen.getByRole("spinbutton", { name: "vCPU" })).toBeInTheDocument()
    expect(screen.queryByRole("spinbutton", { name: "Memory" })).toBeNull()
    const req = create()
    expect(req).toMatchObject({ vcpu: 1 })
    expect(req).not.toHaveProperty("memory_mib")
  })

  it("goes back to the default when the template changes", () => {
    open("ranged-env")
    choose()
    const pick = (from: RegExp, to: RegExp) => {
      fireEvent.click(screen.getByRole("button", { name: from }))
      fireEvent.click(screen.getAllByRole("button", { name: to }).at(-1)!)
    }
    pick(/ranged-env/, /plain/)
    pick(/plain/, /ranged-env/)
    expect(
      screen.getByRole("button", { name: "Choose size" }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("spinbutton", { name: "vCPU" })).toBeNull()
  })

  it("shows a snapshot's size read-only", () => {
    snapshots.data = [
      {
        id: "0b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b",
        sandbox_id: "1b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b",
        kind: "mem+fs",
        status: "ready",
        name: "warm",
        size_bytes: 1,
        resources: { vcpu_count: 2, memory_mib: 2048, disk_mib: 4096 },
        created_at: "2026-01-01T00:00:00Z",
      },
    ]
    render(
      <ToastProvider>
        <CreateSandboxDialog
          open
          hideTrigger
          initialSnapshotId="0b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b"
        />
      </ToastProvider>,
    )
    expect(screen.queryByRole("button", { name: "Choose size" })).toBeNull()
    expect(summary()).toBe("2 vCPU · 2 GB")
  })
})
