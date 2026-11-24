import { ToastProvider } from "@superserve/ui"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { TeamSnapshot } from "@/lib/api/types"

// Drives Create Sandbox from the real snapshot action and its row mapping,
// with only the database rows mocked.
const { rows, snapshots } = vi.hoisted(() => ({
  rows: { data: [] as Record<string, unknown>[] },
  snapshots: { data: [] as TeamSnapshot[] },
}))

const query = vi.hoisted(() => {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.is = () => chain
  chain.in = async () => ({ data: [], error: null })
  chain.order = async () => ({ data: rows.data, error: null })
  return chain
})

vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext: async () => null,
}))
vi.mock("@/lib/admin/permissions", () => ({
  canReadPlatformSandboxes: () => false,
}))
vi.mock("@/lib/api/active-team", () => ({
  resolveActiveTeam: async () => ({ teamId: "team-1", region: "use" }),
}))
vi.mock("@/lib/cells", () => ({
  cellFor: () => ({ createAdminClient: () => ({ from: () => query }) }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  }),
}))
vi.mock("@/hooks/use-sandboxes", () => ({
  useCreateSandbox: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock("@/hooks/use-templates", () => ({ useTemplates: () => ({ data: [] }) }))
vi.mock("@/hooks/use-snapshots", () => ({ useSnapshots: () => snapshots }))
vi.mock("@/hooks/use-secrets", () => ({ useSecrets: () => ({ data: [] }) }))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}))

import { listSnapshotsAction } from "@/lib/api/snapshots-actions"

import { CreateSandboxDialog } from "./create-sandbox-dialog"

const SNAP = "0b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b"
const dbRow = (over: Record<string, unknown>) => ({
  id: SNAP,
  sandbox_id: "1b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b",
  template_id: null,
  status: "ready",
  name: "warm",
  size_bytes: 1,
  vcpu_count: 2,
  memory_mib: 2048,
  disk_mib: 4096,
  memory_max_mib: null,
  vcpu_max: null,
  vcpu_selectable: true,
  memory_shrink_after_seconds: null,
  fixed_cpu_image_vcpus: null,
  fixed_cpu_image_min_vcpus: null,
  fixed_memory_image_boot_mib: null,
  fixed_memory_image_max_mib: null,
  created_at: "2026-01-01T00:00:00Z",
  ready_at: "2026-01-01T00:00:05Z",
  ...over,
})

async function openWithRow(row: Record<string, unknown>) {
  rows.data = [row]
  snapshots.data = await listSnapshotsAction()
  render(
    <ToastProvider>
      <CreateSandboxDialog open hideTrigger initialSnapshotId={SNAP} />
    </ToastProvider>,
  )
}

beforeEach(() => {
  rows.data = []
  snapshots.data = []
})

describe("Create Sandbox with snapshots from the console's snapshot list", () => {
  it("offers Choose size for a sized snapshot", async () => {
    await openWithRow(
      dbRow({
        fixed_cpu_image_vcpus: 4,
        fixed_cpu_image_min_vcpus: 1,
        fixed_memory_image_boot_mib: 1024,
        fixed_memory_image_max_mib: 4096,
      }),
    )
    expect(snapshots.data[0].resources).toMatchObject({
      vcpu_range: { min: 1, max: 4 },
      memory_range_mib: { min: 1024, max: 4096 },
    })
    expect(
      screen.getByRole("button", { name: "Choose size" }),
    ).toBeInTheDocument()
  })

  it("shows no Choose size for a fixed snapshot", async () => {
    await openWithRow(dbRow({}))
    expect(snapshots.data[0].resources).not.toHaveProperty("vcpu_range")
    expect(screen.queryByRole("button", { name: "Choose size" })).toBeNull()
  })
})
