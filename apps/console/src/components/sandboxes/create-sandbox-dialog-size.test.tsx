import { ToastProvider } from "@superserve/ui"
import { fireEvent, render, screen, within } from "@testing-library/react"
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

const mode = (resource: string, option: "Auto" | "Fixed") =>
  within(screen.getByRole("radiogroup", { name: resource })).getByRole(
    "radio",
    { name: option },
  )
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

describe("Create Sandbox size", () => {
  it("defaults to auto, shows the range and sends no size", () => {
    open("ranged-env")
    expect(mode("vCPU", "Auto")).toBeChecked()
    expect(mode("Memory", "Auto")).toBeChecked()
    expect(screen.getByText("Auto: 1–4 vCPU, grows with load")).toBeVisible()
    expect(summary()).toBe("1–4 vCPU · 1–4 GB · auto")
    const req = create()
    expect(req).not.toHaveProperty("vcpu")
    expect(req).not.toHaveProperty("memory_mib")
  })

  it("sends only the fixed dimension, bounded to the range", () => {
    open("ranged-env")
    fireEvent.click(mode("vCPU", "Fixed"))
    const cpu = screen.getByRole("spinbutton", { name: "vCPU" })
    expect(cpu).toHaveAttribute("aria-valuemin", "1")
    expect(cpu).toHaveAttribute("aria-valuemax", "4")
    fireEvent.click(screen.getByRole("button", { name: "Increase vCPU" }))
    expect(summary()).toBe("2 vCPU fixed · 1–4 GB auto")
    fireEvent.click(mode("Memory", "Fixed"))
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Memory" }), {
      key: "End",
    })
    expect(summary()).toBe("2 vCPU · 4 GB · fixed")
    expect(create()).toMatchObject({ vcpu: 2, memory_mib: 4096 })
  })

  it("shows a template without a range read-only", () => {
    open("plain")
    expect(screen.queryByRole("radiogroup", { name: "vCPU" })).toBeNull()
    expect(
      screen.getByText("1 vCPU · 1 GB · fixed by template"),
    ).toBeInTheDocument()
    expect(
      screen.getByText("To choose sizes, build a template with a size range."),
    ).toBeInTheDocument()
    expect(summary()).toBe("1 vCPU · 1 GB · fixed")
    expect(create()).not.toHaveProperty("vcpu")
  })

  it("lists a dimension without a range as fixed by the template", () => {
    templates.data = [template("cpu-only", { vcpu_max: 4 })]
    open("cpu-only")
    expect(screen.getByRole("radiogroup", { name: "vCPU" })).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "Memory" })).toBeNull()
    expect(
      screen.getByText("Memory: 1 GB, fixed by template"),
    ).toBeInTheDocument()
    expect(summary()).toBe("1–4 vCPU auto · 1 GB fixed")
  })

  it("resets to auto when the template changes", () => {
    open("ranged-env")
    fireEvent.click(mode("vCPU", "Fixed"))
    const pick = (from: RegExp, to: RegExp) => {
      fireEvent.click(screen.getByRole("button", { name: from }))
      fireEvent.click(screen.getAllByRole("button", { name: to }).at(-1)!)
    }
    pick(/ranged-env/, /plain/)
    expect(screen.queryByRole("radiogroup", { name: "vCPU" })).toBeNull()
    pick(/plain/, /ranged-env/)
    expect(mode("vCPU", "Auto")).toBeChecked()
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
    expect(screen.queryByRole("radiogroup", { name: "vCPU" })).toBeNull()
    expect(
      screen.getByText("2 vCPU · 2 GB · from snapshot"),
    ).toBeInTheDocument()
    expect(summary()).toBe("2 vCPU · 2 GB · fixed")
  })
})
