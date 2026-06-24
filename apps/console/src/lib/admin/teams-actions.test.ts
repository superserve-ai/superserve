import { beforeEach, describe, expect, it, vi } from "vitest"

const { logSpy } = vi.hoisted(() => ({ logSpy: vi.fn() }))

vi.mock("@/lib/admin/staff", () => ({
  requireStaff: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  readImpersonationTeamId: vi.fn(),
  clearImpersonationCookie: vi.fn(async () => {}),
  setImpersonationCookie: vi.fn(async () => {}),
}))
vi.mock("@/lib/admin/impersonation-key", () => ({
  revokeImpersonationKeyRow: vi.fn(async () => {}),
}))
vi.mock("@/lib/admin/audit", () => ({
  logImpersonationEvent: logSpy,
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { name: "sean.prime.2025@gmail.com" },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

import { readImpersonationTeamId } from "@/lib/admin/impersonation"
import { requireStaff } from "@/lib/admin/staff"

import { listAllTeamsAction, stopImpersonationAction } from "./teams-actions"

beforeEach(() => {
  logSpy.mockClear()
})

describe("listAllTeamsAction", () => {
  it("requires staff", async () => {
    vi.mocked(requireStaff).mockRejectedValueOnce(
      new Error("Forbidden: staff access required"),
    )
    await expect(listAllTeamsAction()).rejects.toThrow(/staff/)
  })
})

describe("stopImpersonationAction", () => {
  it("audits the team name, not the bare team id", async () => {
    vi.mocked(requireStaff).mockResolvedValue({
      id: "a1",
      email: "alejandro@superserve.ai",
    } as never)
    vi.mocked(readImpersonationTeamId).mockResolvedValue(
      "62068d27-d543-461d-9101-627141374484",
    )

    // The action ends in redirect(), which throws NEXT_REDIRECT-style.
    await expect(stopImpersonationAction()).rejects.toThrow(/REDIRECT/)

    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toMatchObject({
      action: "stop",
      adminEmail: "alejandro@superserve.ai",
      teamId: "62068d27-d543-461d-9101-627141374484",
      teamName: "sean.prime.2025@gmail.com",
    })
  })
})
