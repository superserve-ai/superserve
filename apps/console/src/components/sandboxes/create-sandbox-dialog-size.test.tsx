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
})

const SNAP_A = "0b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b"
const SNAP_B = "2b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b"
const snapshot = (
  id: string,
  name: string,
  extra: Record<string, unknown>,
) => ({
  id,
  sandbox_id: "1b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b",
  kind: "mem+fs",
  status: "ready",
  name,
  size_bytes: 1,
  resources: { vcpu_count: 2, memory_mib: 2048, disk_mib: 4096, ...extra },
  created_at: "2026-01-01T00:00:00Z",
})

function openSnapshot(id: string) {
  render(
    <ToastProvider>
      <CreateSandboxDialog open hideTrigger initialSnapshotId={id} />
    </ToastProvider>,
  )
}

describe("Create Sandbox size from a snapshot", () => {
  it("shows the snapshot's size with no Choose size when it has no range", () => {
    snapshots.data = [snapshot(SNAP_A, "warm", {})]
    openSnapshot(SNAP_A)
    expect(screen.queryByRole("button", { name: "Choose size" })).toBeNull()
    expect(summary()).toBe("2 vCPU · 2 GB · from snapshot")
    expect(create()).not.toHaveProperty("vcpu")
  })

  it("sends a size chosen within both ranges with from_snapshot", () => {
    snapshots.data = [
      snapshot(SNAP_A, "warm", {
        vcpu_range: { min: 1, max: 4 },
        memory_range_mib: { min: 1024, max: 4096 },
      }),
    ]
    openSnapshot(SNAP_A)
    choose()
    const cpu = screen.getByRole("spinbutton", { name: "vCPU" })
    // Opens at the snapshot's own count, bounded to its range.
    expect(cpu).toHaveAttribute("aria-valuenow", "2")
    expect(cpu).toHaveAttribute("aria-valuemax", "4")
    fireEvent.click(screen.getByRole("button", { name: "Increase vCPU" }))
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Memory" }), {
      key: "End",
    })
    expect(summary()).toBe("3 vCPU · 4 GB")
    expect(create()).toMatchObject({
      from_snapshot: SNAP_A,
      vcpu: 3,
      memory_mib: 4096,
    })
  })

  it("opens at the snapshot's own size, so creating unchanged keeps it", () => {
    snapshots.data = [
      snapshot(SNAP_A, "warm", {
        memory_mib: 3072,
        vcpu_range: { min: 1, max: 4 },
        memory_range_mib: { min: 1024, max: 4096 },
      }),
    ]
    openSnapshot(SNAP_A)
    choose()
    expect(screen.getByRole("spinbutton", { name: "Memory" })).toHaveAttribute(
      "aria-valuenow",
      "3072",
    )
    expect(create()).toMatchObject({ vcpu: 2, memory_mib: 3072 })
  })

  it("keeps an off-grid snapshot size selectable", () => {
    snapshots.data = [
      snapshot(SNAP_A, "warm", {
        memory_mib: 2050,
        memory_range_mib: { min: 1024, max: 4096 },
      }),
    ]
    openSnapshot(SNAP_A)
    choose()
    const mem = screen.getByRole("spinbutton", { name: "Memory" })
    expect(mem).toHaveAttribute("aria-valuenow", "2050")
    fireEvent.click(screen.getByRole("button", { name: "Increase Memory" }))
    expect(mem).toHaveAttribute("aria-valuenow", "2304")
    fireEvent.click(screen.getByRole("button", { name: "Decrease Memory" }))
    expect(create()).toMatchObject({ memory_mib: 2050 })
  })

  it("offers only the vCPU stepper for a CPU-only range, and Use default sends nothing", () => {
    snapshots.data = [
      snapshot(SNAP_A, "warm", { vcpu_range: { min: 1, max: 4 } }),
    ]
    openSnapshot(SNAP_A)
    choose()
    expect(screen.queryByRole("spinbutton", { name: "Memory" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Use default" }))
    const req = create()
    expect(req).toMatchObject({ from_snapshot: SNAP_A })
    expect(req).not.toHaveProperty("vcpu")
    expect(req).not.toHaveProperty("memory_mib")
  })

  it("goes back to the default when the snapshot changes", () => {
    snapshots.data = [
      snapshot(SNAP_A, "warm", { vcpu_range: { min: 1, max: 4 } }),
      snapshot(SNAP_B, "cold", { vcpu_range: { min: 1, max: 4 } }),
    ]
    openSnapshot(SNAP_A)
    choose()
    fireEvent.click(screen.getByRole("button", { name: /warm/ }))
    fireEvent.click(screen.getAllByRole("button", { name: /cold/ }).at(-1)!)
    expect(
      screen.getByRole("button", { name: "Choose size" }),
    ).toBeInTheDocument()
    expect(create()).not.toHaveProperty("vcpu")
  })
})
