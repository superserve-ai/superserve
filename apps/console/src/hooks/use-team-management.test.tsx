import { ToastProvider } from "@superserve/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { teamKeys } from "@/lib/api/query-keys"

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  assign: vi.fn(),
  revokeRole: vi.fn(),
  create: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  leave: vi.fn(),
  management: vi.fn(),
  directory: vi.fn(),
}))

vi.mock("@/lib/api/team-management", () => ({
  deactivateTeamMember: mocks.remove,
  assignTeamRole: mocks.assign,
  revokeTeamRole: mocks.revokeRole,
  getTeamManagement: mocks.management,
  getTeamInvitations: vi.fn(),
}))
vi.mock("@/lib/api/teams-actions", () => ({
  listTeamsAction: mocks.directory,
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
  useDisplayedTeam,
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

describe("displayed team scope", () => {
  it.each(["use", "usw", null])(
    "checks the management region (%s) against the directory",
    (region) => {
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity } },
      })
      client.setQueryData(["team-management"], {
        team_id: team.teamId,
        region,
      })
      client.setQueryData(teamKeys.directory(), {
        activeTeamId: team.teamId,
        activeRegion: "use",
      })
      const { result } = renderHook(() => useDisplayedTeam(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      })
      expect(result.current).toEqual(region === "use" ? team : null)
    },
  )

  it("reloads both sources when another tab switched the active team", async () => {
    vi.clearAllMocks()
    const switched = { teamId: "switched-team", region: "usw" }
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    client.setQueryData(["team-management"], {
      team_id: switched.teamId,
      region: switched.region,
    })
    client.setQueryData(teamKeys.directory(), {
      activeTeamId: team.teamId,
      activeRegion: team.region,
    })
    client.setQueryData(["secrets"], ["previous-team-secret"])
    mocks.management.mockResolvedValue({
      team_id: switched.teamId,
      region: switched.region,
    })
    mocks.directory.mockResolvedValue({
      activeTeamId: switched.teamId,
      activeRegion: switched.region,
    })
    const { result } = renderHook(() => useDisplayedTeam(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toEqual(switched))
    expect(mocks.directory).toHaveBeenCalledTimes(1)
    expect(mocks.management).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(["secrets"])).toBeUndefined()
  })
})

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
