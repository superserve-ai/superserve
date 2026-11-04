import { ToastProvider } from "@superserve/ui"
import { render as baseRender, fireEvent, screen } from "@testing-library/react"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { TeamManagementResponse } from "@/lib/api/team-management"

const {
  mockUseTeamManagement,
  mockUseTeamInvitations,
  mockUseTeams,
  mockLeave,
  mockRemove,
  mockResend,
  mockRevokeInvitation,
  mockRouterReplace,
} = vi.hoisted(() => ({
  mockUseTeamManagement: vi.fn(),
  mockUseTeamInvitations: vi.fn(),
  mockUseTeams: vi.fn(),
  mockLeave: vi.fn(),
  mockRemove: vi.fn(),
  mockResend: vi.fn(),
  mockRevokeInvitation: vi.fn(),
  mockRouterReplace: vi.fn(),
}))

const render = (ui: ReactElement) =>
  baseRender(<ToastProvider>{ui}</ToastProvider>)

const mutation = (mutate = vi.fn()) => ({
  mutate,
  mutateAsync: mutate,
  isPending: false,
  reset: vi.fn(),
})

vi.mock("@/hooks/use-team-management", () => ({
  useTeamManagement: () => mockUseTeamManagement(),
  useTeamInvitations: () => mockUseTeamInvitations(),
  useAssignTeamRole: () => mutation(),
  useRevokeTeamRole: () => mutation(),
  useCreateInvitation: () => mutation(),
  useResendInvitation: () => mutation(mockResend),
  useRevokeInvitation: () => mutation(mockRevokeInvitation),
  useRemoveTeamMember: () => mutation(mockRemove),
  useLeaveTeam: () => mutation(mockLeave),
}))
vi.mock("@/hooks/use-teams", () => ({ useTeams: () => mockUseTeams() }))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "user-1" }, loading: false, error: null }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
}))

import { UserManagementClient } from "./user-management-client"

const baseManagement: TeamManagementResponse = {
  team_id: "team-1",
  members: [
    {
      user_id: "user-1",
      email: "owner@example.com",
      full_name: "Owner User",
      status: "active",
      roles: ["team_owner"],
      created_at: "2026-06-24T00:00:00Z",
      updated_at: "2026-06-24T00:00:00Z",
    },
    {
      user_id: "user-2",
      email: "invited@example.com",
      status: "invited",
      roles: [],
      created_at: "2026-06-24T00:00:00Z",
      updated_at: "2026-06-24T00:00:00Z",
    },
  ],
  assignments: [
    {
      assignment_id: "assignment-1",
      user_id: "user-1",
      email: "owner@example.com",
      role_name: "team_owner",
      scope_type: "team",
      team_id: "team-1",
      granted_at: "2026-06-24T00:00:00Z",
      created_at: "2026-06-24T00:00:00Z",
      updated_at: "2026-06-24T00:00:00Z",
    },
  ],
  capabilities: {
    can_view_role_assignments: false,
    can_invite_members: false,
    can_deactivate_members: false,
    can_assign_roles: false,
    can_revoke_roles: false,
  },
}

describe("UserManagementClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTeamManagement.mockReturnValue({
      data: baseManagement,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
    mockUseTeamInvitations.mockReturnValue({
      data: { invitations: [] },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
    mockUseTeams.mockReturnValue({
      data: {
        teams: [
          { id: "team-1", name: "Acme", region: "use" },
          { id: "team-2", name: "Other", region: "usw" },
        ],
      },
    })
  })

  it("shows members but hides mutation controls for viewers", () => {
    render(<UserManagementClient />)

    expect(screen.getByRole("link", { name: /audit log/i })).toBeInTheDocument()
    expect(screen.getByText("owner@example.com")).toBeInTheDocument()
    expect(
      screen.getByText("You have read-only access to team membership."),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("tab", { name: /^active members\s+1$/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("tab", { name: /^invitations\s+1$/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("tab", { name: /^inactive members\s+0$/i }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: /^invitations\s+1$/i }))
    expect(screen.getByText("invited@example.com")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /invite member/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /remove member/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /manage roles/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /update role/i }),
    ).not.toBeInTheDocument()
  })

  it("shows backend-advertised controls for capable users", () => {
    mockUseTeamManagement.mockReturnValue({
      data: {
        ...baseManagement,
        capabilities: {
          can_view_role_assignments: true,
          can_invite_members: true,
          can_deactivate_members: true,
          can_assign_roles: true,
          can_revoke_roles: true,
          can_invite_owners: true,
          invite_blocked_reason: null,
        },
        mutation_options: {
          member_statuses: ["active", "invited"],
          assignable_roles: ["team_owner", "viewer"],
        },
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<UserManagementClient />)

    expect(
      screen.getByRole("button", { name: /^invite member$/i }),
    ).toBeEnabled()
    expect(
      screen.getByRole("button", { name: /update role/i }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole("button", { name: /manage roles/i }),
    ).toHaveLength(1)
    expect(
      screen.getByRole("button", { name: /manage roles/i }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /manage roles/i }))
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("user-1")
    expect(
      screen.getAllByRole("button", { name: /manage roles/i }),
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole("tab", { name: /^invitations\s+1$/i }))
    expect(screen.getByText("invited@example.com")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument()
  })

  describe("customer capabilities", () => {
    const capable = {
      ...baseManagement,
      members: [
        ...baseManagement.members,
        {
          user_id: "user-3",
          email: "teammate@example.com",
          status: "active" as const,
          roles: ["team_owner"],
          created_at: "2026-06-24T00:00:00Z",
          updated_at: "2026-06-24T00:00:00Z",
        },
      ],
      capabilities: {
        ...baseManagement.capabilities,
        can_invite_members: true,
        can_deactivate_members: true,
        can_invite_owners: true,
        invite_blocked_reason: null,
      },
    }

    beforeEach(() => {
      mockUseTeamManagement.mockReturnValue({
        data: capable,
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })
    })

    it("explains full Owner access before an invitation is sent", () => {
      render(<UserManagementClient />)

      fireEvent.click(screen.getByRole("button", { name: /^invite member$/i }))

      expect(
        screen.getByText(/everyone you invite joins as an owner/i),
      ).toBeInTheDocument()
      expect(screen.getByLabelText(/email address/i)).toBeEnabled()
      expect(
        screen.getByRole("button", { name: /send invitation/i }),
      ).toBeInTheDocument()
    })

    it("grays out Invite with the upgrade reason on a Free plan team", () => {
      mockUseTeamManagement.mockReturnValue({
        data: {
          ...capable,
          capabilities: {
            ...capable.capabilities,
            can_invite_owners: false,
            invite_blocked_reason: "free_plan",
          },
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })

      render(<UserManagementClient />)

      const invite = screen.getByRole("button", { name: /^invite member$/i })
      expect(invite).toBeDisabled()
      expect(invite).toHaveAttribute("title", "Upgrade to invite owners")
      expect(
        screen.getAllByText("Upgrade to invite owners").length,
      ).toBeGreaterThan(0)
      fireEvent.click(invite)
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument()
    })

    it("offers no invite control when the backend does not allow owner invites", () => {
      mockUseTeamManagement.mockReturnValue({
        data: {
          ...capable,
          capabilities: {
            ...capable.capabilities,
            can_invite_owners: false,
            invite_blocked_reason: null,
          },
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })

      render(<UserManagementClient />)

      expect(
        screen.queryByRole("button", { name: /^invite member$/i }),
      ).not.toBeInTheDocument()
    })

    it("lists pending invitations with resend and revoke", () => {
      mockUseTeamInvitations.mockReturnValue({
        data: {
          invitations: [
            {
              id: "inv-1",
              email: "pending@example.com",
              status: "pending",
              created_at: "2026-11-04T00:00:00Z",
              expires_at: "2026-11-11T00:00:00Z",
              delivery_status: "failed",
            },
            {
              id: "inv-2",
              email: "done@example.com",
              status: "accepted",
              created_at: "2026-11-01T00:00:00Z",
              expires_at: "2026-11-08T00:00:00Z",
              delivery_status: "sent",
            },
          ],
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })

      render(<UserManagementClient />)

      expect(screen.getByText("pending@example.com")).toBeInTheDocument()
      expect(screen.getByText(/email not sent/i)).toBeInTheDocument()
      expect(screen.queryByText("done@example.com")).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: /^resend$/i }))
      expect(mockResend).toHaveBeenCalledWith("inv-1")
      fireEvent.click(
        screen.getByRole("button", { name: /revoke invitation/i }),
      )
      expect(screen.getByText(/no longer be able to join/i)).toBeInTheDocument()
    })

    it("shows a retry when invitations cannot be loaded", () => {
      mockUseTeamInvitations.mockReturnValue({
        data: undefined,
        isPending: false,
        error: new Error("boom"),
        refetch: vi.fn(),
      })

      render(<UserManagementClient />)

      expect(
        screen.getByText("Invitations could not be loaded."),
      ).toBeInTheDocument()
    })

    it("lets members remove others but never themselves", () => {
      render(<UserManagementClient />)

      expect(
        screen.getAllByRole("button", { name: /remove member/i }),
      ).toHaveLength(1)
    })

    it("allows leaving when the user belongs to another team", () => {
      render(<UserManagementClient />)

      expect(
        screen.getByRole("button", { name: /^leave team$/i }),
      ).toBeEnabled()
    })

    it("blocks leaving the user's only team", () => {
      mockUseTeams.mockReturnValue({
        data: { teams: [{ id: "team-1", name: "Acme", region: "use" }] },
      })

      render(<UserManagementClient />)

      expect(
        screen.getByRole("button", { name: /^leave team$/i }),
      ).toBeDisabled()
      expect(screen.getByText(/this is your only team/i)).toBeInTheDocument()
    })

    it("blocks leaving until the team list is known", () => {
      mockUseTeams.mockReturnValue({ data: undefined })

      render(<UserManagementClient />)

      expect(
        screen.getByRole("button", { name: /^leave team$/i }),
      ).toBeDisabled()
    })
  })
})
