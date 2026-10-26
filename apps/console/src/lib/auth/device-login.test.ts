import { beforeEach, describe, expect, it, vi } from "vitest"

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  mint: vi.fn(),
  getUser: vi.fn(),
  member: vi.fn(),
}))

function query(op: "select" | "update", payload?: Row) {
  const filters: ((row: Row) => boolean)[] = []
  let count = false
  const run = () => {
    const matched = state.rows.filter((row) => filters.every((f) => f(row)))
    if (op === "update") for (const row of matched) Object.assign(row, payload)
    return matched
  }
  const result = Promise.resolve().then(() => {
    const matched = run()
    return count
      ? { count: matched.length, error: null }
      : { data: matched, error: null }
  })
  const builder = Object.assign(result, {
    select: (_cols?: string, opts?: { count?: string }) => {
      count = !!opts?.count
      return builder
    },
    eq: (col: string, value: unknown) => {
      filters.push((row) => row[col] === value)
      return builder
    },
    gt: (col: string, value: string) => {
      filters.push((row) => String(row[col]) > value)
      return builder
    },
    // Only the `col.is.null,col.lte."iso"` shape the poll throttle uses.
    or: (expr: string) => {
      const [, col, bound] = /^(\w+)\.is\.null,\w+\.lte\."(.+)"$/.exec(expr)!
      filters.push((row) => row[col] == null || String(row[col]) <= bound)
      return builder
    },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
  })
  return builder
}

vi.mock("server-only", () => ({}))
vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "use",
  cellFor: () => ({
    createAdminClient: () => ({
      from: () => ({
        select: (cols: string, opts?: { count?: string }) =>
          query("select").select(cols, opts),
        insert: async (row: Row) => {
          state.rows.push({
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            ...row,
          })
          return { error: null }
        },
        update: (values: Row) => query("update", values),
      }),
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        const recent = state.rows.filter(
          (row) => row.requester_hash === args.p_requester_hash,
        )
        if (recent.length >= (args.p_max_per_window as number))
          return { data: false, error: null }
        state.rows.push({
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          device_code: args.p_device_code,
          user_code: args.p_user_code,
          client_name: args.p_client_name,
          requester_hash: args.p_requester_hash,
          status: "pending",
          expires_at: args.p_expires_at,
        })
        return { data: true, error: null }
      },
    }),
  }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: state.getUser } },
  }),
}))
vi.mock("@/lib/api/api-key-mint", () => ({ mintTeamApiKey: state.mint }))
vi.mock("@/lib/api/team-directory", () => ({
  membershipExistsInCell: state.member,
}))

import {
  approveDeviceCode,
  createDeviceCode,
  denyDeviceCode,
  normalizeUserCode,
  pollDeviceCode as pollNow,
} from "./device-login"

// A client that waited the advertised interval since its last poll.
async function pollDeviceCode(deviceCode: string) {
  for (const row of state.rows) row.last_polled_at = null
  return pollNow(deviceCode)
}

const user = { id: "user-1", email: "dev@example.com", app_metadata: {} }
const team = { teamId: "team-1", region: "usw" }

async function start() {
  return createDeviceCode({ clientName: "laptop", requester: "192.0.2.1" })
}

describe("device login", () => {
  beforeEach(() => {
    state.rows = []
    state.mint.mockReset().mockResolvedValue({ key: "ss_live_usw_secret" })
    state.getUser.mockReset().mockResolvedValue({ data: { user }, error: null })
    state.member.mockReset().mockResolvedValue(true)
  })

  it("answers slow_down to a client polling faster than the interval", async () => {
    const { deviceCode } = await start()
    await expect(pollNow(deviceCode)).rejects.toMatchObject({
      code: "authorization_pending",
    })
    await expect(pollNow(deviceCode)).rejects.toMatchObject({
      code: "slow_down",
    })
    await expect(pollNow("never-issued")).rejects.toMatchObject({
      code: "invalid_grant",
    })
  })

  it("normalizes typed codes and rejects lookalikes", () => {
    expect(normalizeUserCode("bcdf ghjk")).toBe("BCDF-GHJK")
    expect(normalizeUserCode("BCDF-GHJ0")).toBeNull()
    expect(normalizeUserCode("ABCD-EFGH")).toBeNull()
  })

  it("never stores the polling secret", async () => {
    const { deviceCode } = await start()
    expect(JSON.stringify(state.rows)).not.toContain(deviceCode)
  })

  it("stays pending until approved, then mints exactly once in the team's cell", async () => {
    const { deviceCode, userCode } = await start()
    await expect(pollDeviceCode(deviceCode)).rejects.toMatchObject({
      code: "authorization_pending",
    })
    await approveDeviceCode(userCode, user as never, team)
    await expect(pollDeviceCode(deviceCode)).resolves.toEqual({
      apiKey: "ss_live_usw_secret",
      email: "dev@example.com",
      newAccount: false,
    })
    expect(state.mint).toHaveBeenCalledWith(
      user,
      team,
      "CLI · laptop",
      expect.any(String),
    )
    await expect(pollDeviceCode(deviceCode)).rejects.toMatchObject({
      code: "invalid_grant",
    })
    expect(state.mint).toHaveBeenCalledTimes(1)
  })

  it("lets the next poll retry when minting fails", async () => {
    const { deviceCode, userCode } = await start()
    await approveDeviceCode(userCode, user as never, team)
    state.mint.mockRejectedValueOnce(new Error("cell down"))
    await expect(pollDeviceCode(deviceCode)).rejects.toThrow("cell down")
    await expect(pollDeviceCode(deviceCode)).resolves.toMatchObject({
      apiKey: "ss_live_usw_secret",
    })
  })

  it("does not mint for an account held for review", async () => {
    const { deviceCode, userCode } = await start()
    await approveDeviceCode(userCode, user as never, team)
    state.getUser.mockResolvedValue({
      data: { user: { ...user, app_metadata: { signup_review: "pending" } } },
      error: null,
    })
    await expect(pollDeviceCode(deviceCode)).rejects.toThrow()
    expect(state.mint).not.toHaveBeenCalled()
    await expect(pollDeviceCode(deviceCode)).rejects.toMatchObject({
      code: "invalid_grant",
    })
  })

  it("reports denial and expiry, and refuses to approve either", async () => {
    const denied = await start()
    await denyDeviceCode(denied.userCode)
    await expect(pollDeviceCode(denied.deviceCode)).rejects.toMatchObject({
      code: "access_denied",
    })

    const approved = await start()
    await approveDeviceCode(approved.userCode, user as never, team)
    await expect(denyDeviceCode(approved.userCode)).rejects.toMatchObject({
      code: "invalid_code",
    })

    const expired = await start()
    state.rows.at(-1)!.expires_at = new Date(Date.now() - 1000).toISOString()
    await expect(pollDeviceCode(expired.deviceCode)).rejects.toMatchObject({
      code: "expired_token",
    })
    await expect(
      approveDeviceCode(expired.userCode, user as never, team),
    ).rejects.toMatchObject({ code: "invalid_code" })
    await expect(denyDeviceCode(expired.userCode)).rejects.toMatchObject({
      code: "invalid_code",
    })
  })

  it("won't redeem an approved code after its window closes", async () => {
    const { deviceCode, userCode } = await start()
    await approveDeviceCode(userCode, user as never, team)
    // Approval restarts the window, so a --no-wait agent can come back later.
    expect(
      new Date(state.rows[0].expires_at as string).getTime(),
    ).toBeGreaterThan(Date.now() + 590_000)
    state.rows[0].expires_at = new Date(Date.now() - 1000).toISOString()
    await expect(pollDeviceCode(deviceCode)).rejects.toMatchObject({
      code: "expired_token",
    })
    expect(state.mint).not.toHaveBeenCalled()
  })

  it("flags a just-created team so the CLI can wait out its setup", async () => {
    const { deviceCode, userCode } = await start()
    await approveDeviceCode(userCode, user as never, team)
    state.rows.push({ id: "team-1", created_at: new Date().toISOString() })
    expect(await pollDeviceCode(deviceCode)).toMatchObject({ newAccount: true })

    const second = await start()
    await approveDeviceCode(second.userCode, user as never, team)
    state.rows.find((r) => r.id === "team-1")!.created_at = new Date(
      Date.now() - 86_400_000,
    ).toISOString()
    expect(await pollDeviceCode(second.deviceCode)).toMatchObject({
      newAccount: false,
    })
  })

  it("won't mint for someone removed from the team after approving", async () => {
    const { deviceCode, userCode } = await start()
    await approveDeviceCode(userCode, user as never, team)
    state.member.mockResolvedValue(false)
    await expect(pollDeviceCode(deviceCode)).rejects.toMatchObject({
      code: "access_denied",
    })
    expect(state.member).toHaveBeenCalledWith("usw", "user-1", "team-1")
    expect(state.mint).not.toHaveBeenCalled()
    // The code stays used up rather than becoming retryable.
    await expect(pollDeviceCode(deviceCode)).rejects.toMatchObject({
      code: "invalid_grant",
    })
  })

  it("keeps an approved login retryable through a transient account lookup error", async () => {
    const { deviceCode, userCode } = await start()
    await approveDeviceCode(userCode, user as never, team)
    state.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "upstream timeout" },
    })
    await expect(pollDeviceCode(deviceCode)).rejects.not.toMatchObject({
      code: "access_denied",
    })
    expect(state.rows[0].status).toBe("approved")
    await expect(pollDeviceCode(deviceCode)).resolves.toMatchObject({
      apiKey: "ss_live_usw_secret",
    })
  })

  it("rate-limits a requester that keeps starting logins", async () => {
    for (let i = 0; i < 10; i++) await start()
    await expect(start()).rejects.toMatchObject({ code: "rate_limited" })
  })
})
