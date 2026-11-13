import { ToastProvider } from "@superserve/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"
import { teamKeys } from "@/lib/api/query-keys"
import type { TeamRoleAssignment } from "@/lib/api/team-management"

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
  useChangeTeamRole,
  useCreateInvitation,
  useDisplayedTeam,
  useLeaveScope,
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

  it("reloads once when the sources keep disagreeing", async () => {
    vi.clearAllMocks()
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    const management = { team_id: "switched-team", region: "usw" }
    const directory = { activeTeamId: team.teamId, activeRegion: team.region }
    client.setQueryData(["team-management"], management)
    client.setQueryData(teamKeys.directory(), directory)
    // A real round trip, so an emptied cache renders before the refetch lands.
    const later = <T,>(value: T) =>
      new Promise<T>((resolve) => setTimeout(() => resolve(value), 10))
    mocks.management.mockImplementation(() => later(management))
    mocks.directory.mockImplementation(() => later(directory))
    const { result } = renderHook(() => useDisplayedTeam(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(mocks.management).toHaveBeenCalledTimes(1))
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(result.current).toBeNull()
    expect(mocks.management).toHaveBeenCalledTimes(1)
    expect(mocks.directory).toHaveBeenCalledTimes(1)
  })
})

describe("leave scope", () => {
  it.each([
    [403, team],
    [500, null],
  ])(
    "falls back to the directory team only when management is refused (%s)",
    async (status, expected) => {
      vi.clearAllMocks()
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      })
      client.setQueryData(teamKeys.directory(), {
        activeTeamId: team.teamId,
        activeRegion: team.region,
      })
      mocks.management.mockRejectedValue(
        new ApiError(status, "error", "Request failed"),
      )
      const { result } = renderHook(
        () => ({ scope: useLeaveScope(), displayed: useDisplayedTeam() }),
        {
          wrapper: ({ children }) => (
            <QueryClientProvider client={client}>
              {children}
            </QueryClientProvider>
          ),
        },
      )
      await waitFor(() =>
        expect(client.getQueryState(["team-management"])?.status).toBe("error"),
      )
      expect(result.current.displayed).toBeNull()
      expect(result.current.scope).toEqual(expected)
    },
  )
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
    expect(mocks.create).toHaveBeenCalledWith(
      team,
      "owner@example.com",
      undefined,
    )
    expect(mocks.resend).toHaveBeenCalledWith(team, "inv-1")
    expect(mocks.revoke).toHaveBeenCalledWith(team, "inv-1")
    expect(mocks.leave).toHaveBeenCalledWith(team)
  })

  it("selects the next team after a leave even if the refresh fails", async () => {
    const next = { teamId: "next-team", region: "usw" }
    mocks.leave.mockResolvedValue({ ok: true, active: next })
    mocks.directory.mockRejectedValue(new Error("directory down"))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(teamKeys.directory(), {
      teams: [
        { id: team.teamId, name: "Left", region: team.region },
        { id: next.teamId, name: "Next", region: next.region },
      ],
      regions: ["use", "usw"],
      activeTeamId: team.teamId,
      activeRegion: team.region,
    })
    const { result } = renderHook(() => useLeaveTeam(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await act(() => result.current.mutateAsync({ team }))
    expect(client.getQueryData(teamKeys.directory())).toMatchObject({
      teams: [{ id: next.teamId }],
      activeTeamId: next.teamId,
      activeRegion: next.region,
    })
  })
})

describe("replace team role", () => {
  const assignment = (
    id: string,
    role: string,
    overrides: Partial<TeamRoleAssignment> = {},
  ): TeamRoleAssignment => ({
    assignment_id: id,
    user_id: "user-1",
    email: "member@example.com",
    role_name: role,
    team_id: team.teamId,
    scope_type: "team",
    granted_at: "2026-11-01T00:00:00Z",
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...overrides,
  })
  const old = assignment("owner-role", "team_owner")
  const data = { user_id: "user-1", role_name: "viewer" }

  function setup() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    const management = { team_id: team.teamId, region: team.region }
    const directory = { activeTeamId: team.teamId, activeRegion: team.region }
    client.setQueryData(["team-management"], management)
    client.setQueryData(teamKeys.directory(), directory)
    mocks.management.mockResolvedValue(management)
    mocks.directory.mockResolvedValue(directory)
    const hook = renderHook(() => useChangeTeamRole(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      ),
    })
    return { ...hook, client }
  }

  beforeEach(() => {
    vi.resetAllMocks()
    mocks.assign.mockResolvedValue(undefined)
    mocks.revokeRole.mockResolvedValue(undefined)
  })

  it("waits for assignment before revoking every other active role, then refetches", async () => {
    let finishAssign!: () => void
    mocks.assign.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishAssign = resolve
        }),
    )
    const { result } = setup()
    let changing!: Promise<void>
    act(() => {
      changing = result.current.mutateAsync({
        team,
        data,
        assignments: [
          old,
          assignment("admin-role", "team_admin"),
          assignment("revoked-role", "billing_admin", {
            revoked_at: "2026-11-02T00:00:00Z",
          }),
          assignment("other-user-role", "team_admin", { user_id: "user-2" }),
          assignment("other-team-role", "team_admin", {
            team_id: "other-team",
          }),
        ],
      })
    })
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith(team, data))
    expect(mocks.revokeRole).not.toHaveBeenCalled()
    expect(mocks.management).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.isPending).toBe(true))
    await act(async () => {
      finishAssign()
      await changing
    })
    expect(mocks.revokeRole.mock.calls).toEqual([
      [team, "owner-role"],
      [team, "admin-role"],
    ])
    expect(mocks.management).toHaveBeenCalledOnce()
    expect(screen.getByText("Role changed")).toBeInTheDocument()
  })

  it("keeps an already held role and collapses legacy assignments without a duplicate POST", async () => {
    const { result } = setup()
    await act(() =>
      result.current.mutateAsync({
        team,
        data,
        assignments: [old, assignment("viewer-role", "viewer")],
      }),
    )
    expect(mocks.assign).not.toHaveBeenCalled()
    expect(mocks.revokeRole).toHaveBeenCalledWith(team, "owner-role")
    expect(mocks.management).toHaveBeenCalledOnce()
  })

  it("shows a curated assignment error without logging, revokes nothing and refetches", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.assign.mockRejectedValue(
      new ApiError(403, "forbidden", "Raw permission error"),
    )
    const { result } = setup()
    await act(async () => {
      await expect(
        result.current.mutateAsync({ team, data, assignments: [old] }),
      ).rejects.toThrow("Raw permission error")
    })
    expect(mocks.revokeRole).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        "You do not have permission to perform this team-management action.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText("Raw permission error")).not.toBeInTheDocument()
    expect(log).not.toHaveBeenCalled()
    expect(mocks.management).toHaveBeenCalledOnce()
  })

  it("shows a server team-change error without logging", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const message = "Your active team changed. Reload the page and try again."
    mocks.assign.mockRejectedValue(new ApiError(409, "team_changed", message))
    const { result } = setup()
    await act(async () => {
      await expect(
        result.current.mutateAsync({ team, data, assignments: [old] }),
      ).rejects.toThrow(message)
    })
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(log).not.toHaveBeenCalled()
  })

  it.each([
    new ApiError(400, "invalid_role", "Role not allowed"),
    new ApiError(500, "internal_error", "Database connection failed"),
    new Error("Failed to fetch"),
  ])(
    "logs an unexpected assignment error and shows the fallback: %s",
    async (error) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      mocks.assign.mockRejectedValue(error)
      const { result } = setup()
      await act(async () => {
        await expect(
          result.current.mutateAsync({ team, data, assignments: [old] }),
        ).rejects.toBe(error)
      })
      expect(mocks.revokeRole).not.toHaveBeenCalled()
      expect(screen.getByText("Failed to change role.")).toBeInTheDocument()
      expect(screen.queryByText(error.message)).not.toBeInTheDocument()
      expect(log).toHaveBeenCalledWith("Team-management action failed:", error)
      expect(mocks.management).toHaveBeenCalledOnce()
    },
  )

  it("reports partial failure clearly and refetches members and assignments", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.revokeRole.mockRejectedValue(new Error("revoke failed"))
    const { result } = setup()
    const message =
      "Viewer was added, but Owner could not be removed. Refresh and try again."
    await act(async () => {
      await expect(
        result.current.mutateAsync({ team, data, assignments: [old] }),
      ).rejects.toThrow(message)
    })
    expect(mocks.assign).toHaveBeenCalledWith(team, data)
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByText("revoke failed")).not.toBeInTheDocument()
    expect(log).not.toHaveBeenCalled()
    expect(mocks.management).toHaveBeenCalledOnce()
  })

  it("rejects a changed team before assignment", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { result } = setup()
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          team: { ...team, region: "usw" },
          data,
          assignments: [old],
        }),
      ).rejects.toThrow(
        "Your active team changed. Reload the page and try again.",
      )
    })
    expect(
      screen.getByText(
        "Your active team changed. Reload the page and try again.",
      ),
    ).toBeInTheDocument()
    expect(log).not.toHaveBeenCalled()
    expect(mocks.assign).not.toHaveBeenCalled()
    expect(mocks.revokeRole).not.toHaveBeenCalled()
    expect(mocks.management).toHaveBeenCalledOnce()
  })

  it("stops revocation if the displayed team changes while assignment is pending", async () => {
    let finishAssign!: () => void
    mocks.assign.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishAssign = resolve
        }),
    )
    const { result, client } = setup()
    let changing!: Promise<void>
    act(() => {
      changing = result.current.mutateAsync({ team, data, assignments: [old] })
      void changing.catch(() => {})
    })
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledOnce())
    act(() => {
      client.setQueryData(["team-management"], {
        team_id: "next-team",
        region: "usw",
      })
      client.setQueryData(teamKeys.directory(), {
        activeTeamId: "next-team",
        activeRegion: "usw",
      })
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      finishAssign()
      await expect(changing).rejects.toThrow("could not be removed")
    })
    expect(mocks.revokeRole).not.toHaveBeenCalled()
  })
})
