import { ToastProvider } from "@superserve/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  assign: vi.fn(),
  revokeRole: vi.fn(),
  create: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  leave: vi.fn(),
}))

vi.mock("@/lib/api/team-management", () => ({
  deactivateTeamMember: mocks.remove,
  assignTeamRole: mocks.assign,
  revokeTeamRole: mocks.revokeRole,
  getTeamManagement: vi.fn(),
  getTeamInvitations: vi.fn(),
}))
vi.mock("@/lib/api/team-invitations-actions", () => ({
  createInvitationAction: mocks.create,
  resendInvitationAction: mocks.resend,
  revokeInvitationAction: mocks.revoke,
  leaveTeamAction: mocks.leave,
}))

import {
  useAssignTeamRole,
  useCreateInvitation,
  useLeaveTeam,
  useRemoveTeamMember,
  useResendInvitation,
  useRevokeInvitation,
  useRevokeTeamRole,
} from "./use-team-management"

const team = { teamId: "captured-team", region: "use" }

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
}

describe("team mutation variables", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    for (const mock of Object.values(mocks)) {
      mock.mockResolvedValue({ ok: true, delivery: "sent" })
    }
  })

  it("passes the supplied scope to member and role APIs", async () => {
    const { result } = renderHook(
      () => ({
        remove: useRemoveTeamMember(),
        assign: useAssignTeamRole(),
        revoke: useRevokeTeamRole(),
      }),
      { wrapper },
    )
    const data = { user_id: "user-1", role_name: "viewer" }
    await act(async () => {
      await result.current.remove.mutateAsync({ team, userId: "user-1" })
      await result.current.assign.mutateAsync({ team, data })
      await result.current.revoke.mutateAsync({ team, assignmentId: "role-1" })
    })
    expect(mocks.remove).toHaveBeenCalledWith(team, "user-1")
    expect(mocks.assign).toHaveBeenCalledWith(team, data)
    expect(mocks.revokeRole).toHaveBeenCalledWith(team, "role-1")
  })

  it("passes the supplied scope to invitation and leave actions", async () => {
    const { result } = renderHook(
      () => ({
        create: useCreateInvitation(),
        resend: useResendInvitation(),
        revoke: useRevokeInvitation(),
        leave: useLeaveTeam(),
      }),
      { wrapper },
    )
    await act(async () => {
      await result.current.create.mutateAsync({
        team,
        email: "owner@example.com",
      })
      await result.current.resend.mutateAsync({ team, invitationId: "inv-1" })
      await result.current.revoke.mutateAsync({ team, invitationId: "inv-1" })
      await result.current.leave.mutateAsync({ team })
    })
    expect(mocks.create).toHaveBeenCalledWith(team, "owner@example.com")
    expect(mocks.resend).toHaveBeenCalledWith(team, "inv-1")
    expect(mocks.revoke).toHaveBeenCalledWith(team, "inv-1")
    expect(mocks.leave).toHaveBeenCalledWith(team)
  })
})
