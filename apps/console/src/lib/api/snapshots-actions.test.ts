import { beforeEach, describe, expect, it, vi } from "vitest"

const getImpersonationContext = vi.hoisted(() => vi.fn())
const canReadPlatformSandboxes = vi.hoisted(() => vi.fn())
const resolveActiveTeam = vi.hoisted(() => vi.fn())
const createServerClient = vi.hoisted(() => vi.fn())
const cellFor = vi.hoisted(() => vi.fn())

const query = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.is = vi.fn(() => chain)
  chain.order = vi.fn(async () => ({ data: [], error: null }))
  return chain
})

vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationContext,
}))

vi.mock("@/lib/admin/permissions", () => ({
  canReadPlatformSandboxes,
}))

vi.mock("@/lib/api/active-team", () => ({
  resolveActiveTeam,
}))

vi.mock("@/lib/cells", () => ({
  cellFor,
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient,
}))

import { listSnapshotsAction } from "./snapshots-actions"

const user = {
  id: "admin-1",
  email: "admin@example.com",
  app_metadata: { permissions: ["platform:sandbox:read"] },
}

describe("listSnapshotsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createServerClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user } })) },
    })
    cellFor.mockReturnValue({
      createAdminClient: () => ({ from: vi.fn(() => query) }),
    })
  })

  it("reads the impersonated team in its home region", async () => {
    getImpersonationContext.mockResolvedValue({
      teamId: "team-target",
      region: "usw",
      teamName: "Target",
    })
    canReadPlatformSandboxes.mockReturnValue(true)

    await listSnapshotsAction()

    expect(cellFor).toHaveBeenCalledWith("usw")
    expect(query.eq).toHaveBeenCalledWith("team_id", "team-target")
    expect(resolveActiveTeam).not.toHaveBeenCalled()
  })

  it("fails closed when impersonation lacks sandbox read access", async () => {
    getImpersonationContext.mockResolvedValue({
      teamId: "team-target",
      region: "use",
      teamName: "Target",
    })
    canReadPlatformSandboxes.mockReturnValue(false)

    await expect(listSnapshotsAction()).rejects.toThrow(
      /platform sandbox read access required/,
    )
    expect(cellFor).not.toHaveBeenCalled()
    expect(resolveActiveTeam).not.toHaveBeenCalled()
  })

  it("keeps normal users on their active team", async () => {
    getImpersonationContext.mockResolvedValue(null)
    resolveActiveTeam.mockResolvedValue({ teamId: "team-self", region: "use" })

    await listSnapshotsAction()

    expect(cellFor).toHaveBeenCalledWith("use")
    expect(query.eq).toHaveBeenCalledWith("team_id", "team-self")
  })
})
