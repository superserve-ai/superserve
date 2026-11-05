import { ToastProvider } from "@superserve/ui"
import {
  render as baseRender,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"
import type { TeamManagementResponse } from "@/lib/api/team-management"

const {
  mockDisplayedTeam,
  mockUseTeamManagement,
  mockUseTeamInvitations,
  mockUseTeams,
  mockCreateInvitation,
  mockLeave,
  mockRemove,
  mockResend,
  mockRevokeInvitation,
  mockRouterReplace,
  mockUser,
} = vi.hoisted(() => ({
  mockDisplayedTeam: vi.fn(),
  mockUseTeamManagement: vi.fn(),
  mockUseTeamInvitations: vi.fn(),
  mockUseTeams: vi.fn(),
  mockCreateInvitation: vi.fn(),
  mockLeave: vi.fn(),
  mockRemove: vi.fn(),
  mockResend: vi.fn(),
  mockRevokeInvitation: vi.fn(),
  mockRouterReplace: vi.fn(),
  mockUser: vi.fn(),
}))

const render = (ui: ReactElement) =>
  baseRender(<ToastProvider>{ui}</ToastProvider>)

const mutation = (mutate = vi.fn()) => ({
  mutate,
  mutateAsync: mutate,
  isPending: false,
  reset: vi.fn(),
})

vi.mock("@/hooks/use-team-management", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-team-management")>()),
  useDisplayedTeam: () => mockDisplayedTeam(),
  useLeaveScope: () => mockDisplayedTeam(),
  useTeamManagement: () => mockUseTeamManagement(),
  useTeamInvitations: () => mockUseTeamInvitations(),
  useAssignTeamRole: () => mutation(),
  useRevokeTeamRole: () => mutation(),
  useCreateInvitation: () => mutation(mockCreateInvitation),
  useResendInvitation: () => mutation(mockResend),
  useRevokeInvitation: () => mutation(mockRevokeInvitation),
  useRemoveTeamMember: () => mutation(mockRemove),
  useLeaveTeam: () => mutation(mockLeave),
}))
vi.mock("@/hooks/use-teams", () => ({ useTeams: () => mockUseTeams() }))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: mockUser(), loading: false, error: null }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
}))

import { UserManagementClient } from "./user-management-client"

const customer = { id: "user-1", app_metadata: {} }
const staff = {
  id: "user-1",
  email: "ops@superserve.ai",
  app_metadata: { provider: "google", permissions: ["platform:teams:read"] },
}

const pendingInvitation = {
  id: "inv-1",
  email: "pending@example.com",
  status: "pending",
  created_at: "2026-11-04T00:00:00Z",
  expires_at: "2026-11-11T00:00:00Z",
  delivery_status: "sent",
}

const baseManagement: TeamManagementResponse = {
  team_id: "team-1",
  region: "use",
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
    mockDisplayedTeam.mockReturnValue({ teamId: "team-1", region: "use" })
    mockUser.mockReturnValue(customer)
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
      screen.getByRole("tab", { name: /^invited members\s+1$/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("tab", { name: /^inactive members\s+0$/i }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: /^invited members\s+1$/i }))
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

  it("shows backend-advertised controls for capable staff", () => {
    mockUser.mockReturnValue(staff)
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
    fireEvent.click(screen.getByRole("tab", { name: /^invited members\s+1$/i }))
    expect(screen.getByText("invited@example.com")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument()
  })

  describe("invitations list visibility", () => {
    beforeEach(() => {
      mockUseTeamInvitations.mockReturnValue({
        data: { invitations: [pendingInvitation] },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })
    })

    it("shows the list to a viewer without Resend or Revoke", () => {
      // baseManagement is a viewer: no invite capabilities at all.
      render(<UserManagementClient />)

      expect(screen.getByText("pending@example.com")).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /^resend$/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /revoke invitation/i }),
      ).not.toBeInTheDocument()
    })

    it("hides Resend but keeps Revoke on a Free plan team", () => {
      mockUseTeamManagement.mockReturnValue({
        data: {
          ...baseManagement,
          capabilities: {
            ...baseManagement.capabilities,
            can_invite_members: true,
            can_assign_roles: true,
            can_invite_owners: false,
            invite_blocked_reason: "free_plan",
          },
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })

      render(<UserManagementClient />)

      expect(screen.getByText("pending@example.com")).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /^resend$/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /revoke invitation/i }),
      ).toBeInTheDocument()
    })

    it("offers Resend and Revoke when owner invites are allowed", () => {
      mockUseTeamManagement.mockReturnValue({
        data: {
          ...baseManagement,
          capabilities: {
            ...baseManagement.capabilities,
            can_invite_members: true,
            can_assign_roles: true,
            can_invite_owners: true,
          },
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })

      render(<UserManagementClient />)

      expect(
        screen.getByRole("button", { name: /^resend$/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /revoke invitation/i }),
      ).toBeInTheDocument()
    })
  })

  describe("role controls", () => {
    const withRoleCapabilities = {
      ...baseManagement,
      capabilities: {
        ...baseManagement.capabilities,
        can_view_role_assignments: true,
        can_assign_roles: true,
        can_revoke_roles: true,
      },
      mutation_options: { assignable_roles: ["team_owner", "viewer"] },
    }

    beforeEach(() => {
      mockUseTeamManagement.mockReturnValue({
        data: withRoleCapabilities,
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })
    })

    it("shows roles read-only to a customer whose capabilities allow changes", () => {
      mockUser.mockReturnValue(customer)

      render(<UserManagementClient />)

      expect(screen.getByText("Role assignments")).toBeInTheDocument()
      expect(
        screen.getByText(/you can view role assignments, but cannot change/i),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /update role/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /^revoke$/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /manage roles/i }),
      ).not.toBeInTheDocument()
    })

    it("offers Update role and Revoke to staff", () => {
      mockUser.mockReturnValue(staff)

      render(<UserManagementClient />)

      expect(
        screen.getByRole("button", { name: /update role/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /^revoke$/i }),
      ).toBeInTheDocument()
    })

    it("keeps staff read-only when the backend withholds the capability", () => {
      mockUser.mockReturnValue(staff)
      mockUseTeamManagement.mockReturnValue({
        data: {
          ...withRoleCapabilities,
          capabilities: {
            ...withRoleCapabilities.capabilities,
            can_assign_roles: false,
            can_revoke_roles: false,
          },
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })

      render(<UserManagementClient />)

      expect(
        screen.queryByRole("button", { name: /update role/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /^revoke$/i }),
      ).not.toBeInTheDocument()
    })
  })

  it("counts pending email invitations as pending invites", () => {
    mockUseTeamInvitations.mockReturnValue({
      data: {
        invitations: [
          pendingInvitation,
          { ...pendingInvitation, id: "inv-2", status: "expired" },
          { ...pendingInvitation, id: "inv-3", status: "accepted" },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<UserManagementClient />)

    expect(screen.getByText("2 pending invites")).toBeInTheDocument()
  })

  describe("without team-management permission", () => {
    it.each([
      [403, true],
      [500, false],
    ])("offers leave on a %s error: %s", async (status, offered) => {
      mockUseTeamManagement.mockReturnValue({
        data: undefined,
        isPending: false,
        error: new ApiError(status, "error", "Request failed"),
        refetch: vi.fn(),
      })
      mockLeave.mockResolvedValue(undefined)
      render(<UserManagementClient />)

      const leave = screen.queryByRole("button", { name: /^leave team$/i })
      if (!offered) {
        expect(leave).not.toBeInTheDocument()
        return
      }
      fireEvent.click(leave!)
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Leave team",
        }),
      )
      await waitFor(() =>
        expect(mockLeave).toHaveBeenCalledWith({
          team: { teamId: "team-1", region: "use" },
        }),
      )
    })
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
        can_assign_roles: true,
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

    describe.each([
      {
        name: "member removal",
        open: /remove member/i,
        confirm: "Remove",
        mutate: mockRemove,
        variables: { userId: "user-3" },
      },
      {
        name: "invitation revoke",
        open: /revoke invitation/i,
        confirm: "Revoke",
        mutate: mockRevokeInvitation,
        variables: { invitationId: "inv-1" },
      },
      {
        name: "leave",
        open: /^leave team$/i,
        confirm: "Leave team",
        mutate: mockLeave,
        variables: {},
      },
    ])("$name confirmation scope", ({ open, confirm, mutate, variables }) => {
      beforeEach(() => {
        mockUseTeamInvitations.mockReturnValue({
          data: { invitations: [pendingInvitation] },
          isPending: false,
          error: null,
          refetch: vi.fn(),
        })
        mutate.mockResolvedValue(undefined)
      })

      it.each([
        { teamId: "team-2", region: "use" },
        { teamId: "team-1", region: "usw" },
        null,
      ])(
        "closes without mutation when the displayed scope becomes %j",
        async (next) => {
          const view = render(<UserManagementClient />)
          fireEvent.click(screen.getByRole("button", { name: open }))
          expect(screen.getByRole("dialog")).toBeInTheDocument()

          mockDisplayedTeam.mockReturnValue(next)
          view.rerender(
            <ToastProvider>
              <UserManagementClient />
            </ToastProvider>,
          )

          await waitFor(() =>
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
          )
          expect(mutate).not.toHaveBeenCalled()
        },
      )

      it("confirms with the scope captured when opened", async () => {
        const captured = { teamId: "team-1", region: "use" }
        mockDisplayedTeam.mockReturnValue(captured)
        const view = render(<UserManagementClient />)
        fireEvent.click(screen.getByRole("button", { name: open }))
        mockDisplayedTeam.mockReturnValue({ ...captured })
        view.rerender(
          <ToastProvider>
            <UserManagementClient />
          </ToastProvider>,
        )
        fireEvent.click(
          within(screen.getByRole("dialog")).getByRole("button", {
            name: confirm,
          }),
        )
        await waitFor(() =>
          expect(mutate).toHaveBeenCalledWith({ team: captured, ...variables }),
        )
        expect(mutate.mock.calls[0][0].team).toBe(captured)
      })

      it("does not open without a displayed scope", () => {
        mockDisplayedTeam.mockReturnValue(null)
        render(<UserManagementClient />)
        fireEvent.click(screen.getByRole("button", { name: open }))
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
        expect(mutate).not.toHaveBeenCalled()
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

    it.each([
      { teamId: "team-2", region: "use" },
      { teamId: "team-1", region: "usw" },
      null,
    ])(
      "closes and resets the invite when the scope becomes %j",
      async (next) => {
        const view = render(<UserManagementClient />)
        fireEvent.click(
          screen.getByRole("button", { name: /^invite member$/i }),
        )
        fireEvent.change(screen.getByLabelText(/email address/i), {
          target: { value: "new-owner@example.com" },
        })

        mockDisplayedTeam.mockReturnValue(next)
        view.rerender(
          <ToastProvider>
            <UserManagementClient />
          </ToastProvider>,
        )

        await waitFor(() =>
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
        )
        expect(mockCreateInvitation).not.toHaveBeenCalled()

        mockDisplayedTeam.mockReturnValue({ teamId: "team-2", region: "usw" })
        view.rerender(
          <ToastProvider>
            <UserManagementClient />
          </ToastProvider>,
        )
        fireEvent.click(
          screen.getByRole("button", { name: /^invite member$/i }),
        )
        expect(screen.getByLabelText(/email address/i)).toHaveValue("")
        expect(
          screen.getByRole("button", { name: /send invitation/i }),
        ).toBeDisabled()
      },
    )

    it("sends the invitation with the scope captured when opened", () => {
      const captured = { teamId: "team-1", region: "use" }
      mockDisplayedTeam.mockReturnValue(captured)
      const view = render(<UserManagementClient />)
      fireEvent.click(screen.getByRole("button", { name: /^invite member$/i }))

      mockDisplayedTeam.mockReturnValue({ ...captured })
      view.rerender(
        <ToastProvider>
          <UserManagementClient />
        </ToastProvider>,
      )
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "new-owner@example.com" },
      })
      fireEvent.click(screen.getByRole("button", { name: /send invitation/i }))

      expect(mockCreateInvitation).toHaveBeenCalledWith(
        { team: captured, email: "new-owner@example.com" },
        expect.any(Object),
      )
      expect(mockCreateInvitation.mock.calls[0][0].team).toBe(captured)
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
      expect(mockResend).toHaveBeenCalledWith({
        team: { teamId: "team-1", region: "use" },
        invitationId: "inv-1",
      })
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
