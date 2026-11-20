import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  addToast: vi.fn(),
}))

vi.mock("@superserve/ui", () => ({
  useToast: () => ({ addToast: mocks.addToast }),
}))
vi.mock("@/hooks/use-teams", () => ({
  refreshTeamScopedQueries: vi.fn(),
  useTeams: vi.fn(),
}))
vi.mock("@/lib/api/team-management", () => ({
  deactivateTeamMember: mocks.remove,
  assignTeamRole: vi.fn(),
  revokeTeamRole: vi.fn(),
  getTeamManagement: vi.fn(),
  getTeamInvitations: vi.fn(),
}))
vi.mock("@/lib/api/team-invitations-actions", () => ({
  createInvitationAction: vi.fn(),
  resendInvitationAction: mocks.resend,
  revokeInvitationAction: mocks.revoke,
  leaveTeamAction: vi.fn(),
}))

import {
  InvitationActionFailure,
  TEAM_CHANGED_MESSAGE,
  useRemoveTeamMember,
  useResendInvitation,
  useRevokeInvitation,
} from "./use-team-management"

const team = { teamId: "team-1", region: "use" }
const notReadyMessage =
  "Your active team is still loading. Try again in a moment."
let queryClient: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
})

afterEach(() => queryClient.clear())

describe.each([
  {
    action: "resend",
    useHook: useResendInvitation,
    mock: mocks.resend,
    fallback: "Failed to resend invitation. Try again.",
  },
  {
    action: "revoke",
    useHook: useRevokeInvitation,
    mock: mocks.revoke,
    fallback: "Failed to revoke invitation. Try again.",
  },
])("$action invitation errors", ({ useHook, mock, fallback }) => {
  it("preserves a curated action failure", async () => {
    const log = vi.spyOn(console, "error")
    const message = "That invitation is no longer pending."
    mock.mockResolvedValue({ ok: false, code: "invitation_closed", message })
    const { result } = renderHook(() => useHook(), { wrapper })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ team, invitationId: "inv-1" }),
      ).rejects.toBeInstanceOf(InvitationActionFailure)
    })

    expect(mocks.addToast).toHaveBeenCalledExactlyOnceWith(message, "error")
    expect(log).not.toHaveBeenCalled()
  })

  it("logs a raw error and shows the fallback", async () => {
    const error = new Error("Failed to fetch")
    const log = vi.spyOn(console, "error")
    mock.mockRejectedValue(error)
    const { result } = renderHook(() => useHook(), { wrapper })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ team, invitationId: "inv-1" }),
      ).rejects.toBe(error)
    })

    expect(mocks.addToast).toHaveBeenCalledExactlyOnceWith(fallback, "error")
    expect(log).toHaveBeenCalledWith("Invitation action failed:", error)
  })

  it("preserves the team-loading message", async () => {
    const log = vi.spyOn(console, "error")
    const { result } = renderHook(() => useHook(), { wrapper })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ team: null, invitationId: "inv-1" }),
      ).rejects.toThrow(notReadyMessage)
    })

    expect(mock).not.toHaveBeenCalled()
    expect(mocks.addToast).toHaveBeenCalledExactlyOnceWith(
      notReadyMessage,
      "error",
    )
    expect(log).not.toHaveBeenCalled()
  })
})

describe("RBAC errors", () => {
  it.each([
    new ApiError(500, "internal_error", "Database connection failed"),
    new Error("Failed to fetch"),
  ])(
    "logs unexpected member removal errors and shows the fallback: %s",
    async (error) => {
      const log = vi.spyOn(console, "error")
      mocks.remove.mockRejectedValue(error)
      const { result } = renderHook(() => useRemoveTeamMember(), { wrapper })

      await act(async () => {
        await expect(
          result.current.mutateAsync({ team, userId: "user-1" }),
        ).rejects.toBe(error)
      })

      expect(mocks.addToast).toHaveBeenCalledExactlyOnceWith(
        "Failed to remove member.",
        "error",
      )
      expect(log).toHaveBeenCalledWith("Team-management action failed:", error)
    },
  )

  it.each([
    [
      new ApiError(403, "forbidden", "Raw permission error"),
      "You do not have permission to perform this team-management action.",
    ],
    [
      new ApiError(404, "not_found", "Raw lookup error"),
      "That member, role assignment, or team could not be found. Refresh and try again.",
    ],
    [
      new ApiError(409, "conflict", "Raw conflict error"),
      "This change conflicts with the current team state. If you are changing owners, make sure at least one active owner remains.",
    ],
    [
      new ApiError(409, "team_changed", TEAM_CHANGED_MESSAGE),
      TEAM_CHANGED_MESSAGE,
    ],
  ])("preserves curated RBAC handling: %s", async (error, message) => {
    const log = vi.spyOn(console, "error")
    mocks.remove.mockRejectedValue(error)
    const { result } = renderHook(() => useRemoveTeamMember(), { wrapper })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ team, userId: "user-1" }),
      ).rejects.toBe(error)
    })

    expect(mocks.addToast).toHaveBeenCalledExactlyOnceWith(message, "error")
    expect(log).not.toHaveBeenCalled()
  })

  it("preserves the team-loading message", async () => {
    const log = vi.spyOn(console, "error")
    const { result } = renderHook(() => useRemoveTeamMember(), { wrapper })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ team: null, userId: "user-1" }),
      ).rejects.toThrow(notReadyMessage)
    })

    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.addToast).toHaveBeenCalledExactlyOnceWith(
      notReadyMessage,
      "error",
    )
    expect(log).not.toHaveBeenCalled()
  })
})
