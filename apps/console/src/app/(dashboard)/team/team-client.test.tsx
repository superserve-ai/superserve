import { ToastProvider } from "@superserve/ui"
import {
  render as baseRender,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"
import type { TeamManagementResponse } from "@/lib/api/team-management"

const {
  mockDisplayedTeam,
  mockImpersonatedTeam,
  mockUseTeamManagement,
  mockUseTeamInvitations,
  mockUseTeams,
  mockCreateInvitation,
  mockAssignRole,
  mockRolePending,
  mockRevokeRole,
  mockLeave,
  mockRemove,
  mockResend,
  mockRevokeInvitation,
  mockRouterReplace,
  mockUser,
} = vi.hoisted(() => ({
  mockDisplayedTeam: vi.fn(),
  mockImpersonatedTeam: vi.fn(),
  mockUseTeamManagement: vi.fn(),
  mockUseTeamInvitations: vi.fn(),
  mockUseTeams: vi.fn(),
  mockCreateInvitation: vi.fn(),
  mockAssignRole: vi.fn(),
  mockRolePending: vi.fn(),
  mockRevokeRole: vi.fn(),
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
  refreshInvitations: vi.fn(),
})

vi.mock("@/hooks/use-team-management", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-team-management")>()),
  useDisplayedTeam: () => mockDisplayedTeam(),
  useLeaveScope: () => mockDisplayedTeam(),
  useTeamManagement: () => mockUseTeamManagement(),
  useTeamInvitations: () => mockUseTeamInvitations(),
  useChangeTeamRole: () => ({
    ...mutation(mockAssignRole),
    isPending: mockRolePending(),
  }),
  useRevokeTeamRole: () => mutation(mockRevokeRole),
  useCreateInvitation: () => mutation(mockCreateInvitation),
  useResendInvitation: () => mutation(mockResend),
  useRevokeInvitation: () => mutation(mockRevokeInvitation),
  useRemoveTeamMember: () => mutation(mockRemove),
  useLeaveTeam: () => mutation(mockLeave),
}))
vi.mock("@/components/query-provider", () => ({
  useDashboardTeamContext: () => mockImpersonatedTeam(),
}))
vi.mock("@/hooks/use-teams", () => ({ useTeams: () => mockUseTeams() }))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: mockUser(), loading: false, error: null }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
}))

import { InviteMemberCard } from "./invitations-section"
import { TeamClient } from "./team-client"

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

describe("TeamClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDisplayedTeam.mockReturnValue({ teamId: "team-1", region: "use" })
    mockImpersonatedTeam.mockReturnValue(null)
    mockRolePending.mockReturnValue(false)
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

  it.each(["members", "loading", "error", "empty"])(
    "shows the displayed team's name in the %s header",
    (state) => {
      if (state !== "members") {
        mockUseTeamManagement.mockReturnValue({
          data:
            state === "empty" ? { ...baseManagement, members: [] } : undefined,
          isPending: state === "loading",
          error: state === "error" ? new Error("Request failed") : null,
          refetch: vi.fn(),
        })
      }
      mockDisplayedTeam.mockReturnValue({ teamId: "team-1", region: "usw" })
      mockUseTeams.mockReturnValue({
        data: {
          activeTeamId: "team-2",
          activeRegion: "use",
          teams: [
            { id: "team-2", name: "Other team", region: "use" },
            { id: "team-1", name: "Same ID in East", region: "use" },
            { id: "team-1", name: "Project team", region: "usw" },
          ],
        },
      })

      render(<TeamClient />)

      const header = screen.getByRole("heading", {
        name: "Team",
      }).parentElement!
      expect(
        within(header).getByText("Project team · US West"),
      ).toHaveAttribute("title", "Project team · US West")
      expect(
        within(header).queryByText(/Other team|Same ID in East/),
      ).not.toBeInTheDocument()
      if (state !== "members") {
        expect(
          screen.queryByText("Only Owners can invite people or change roles."),
        ).not.toBeInTheDocument()
      }
    },
  )

  it("shows the impersonated team's name in the header without a displayed team", () => {
    mockUser.mockReturnValue(staff)
    mockImpersonatedTeam.mockReturnValue({
      teamId: "team-7",
      region: "use",
      name: "  Viewed team  ",
    })
    mockDisplayedTeam.mockReturnValue(null)
    mockUseTeamManagement.mockReturnValue({
      data: { ...baseManagement, team_id: "team-7" },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<TeamClient />)

    const header = screen.getByRole("heading", {
      name: "Team",
    }).parentElement!
    expect(within(header).getByText("Viewed team")).toHaveAttribute(
      "title",
      "Viewed team",
    )
  })

  it.each([undefined, { teams: [] }])(
    "omits the header subtitle when the team name is unknown: %j",
    (data) => {
      mockUseTeams.mockReturnValue({ data })
      render(<TeamClient />)
      const header = screen.getByRole("heading", {
        name: "Team",
      }).parentElement!
      expect(header).toHaveTextContent(/^Team$/)
    },
  )

  it("shows members but hides mutation controls for viewers", () => {
    render(<TeamClient />)

    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /audit log/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText(/search by name/i),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Owner")).toBeInTheDocument()
    expect(screen.getByText("owner@example.com")).toHaveAttribute("data-mask")
    expect(screen.getByText("owner@example.com")).toBeInTheDocument()
    expect(
      screen.getByText("You have read-only access to team membership."),
    ).toBeInTheDocument()
    expect(screen.getByText("invited@example.com")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^invite$/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /remove member/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /manage roles/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /change role/i }),
    ).not.toBeInTheDocument()
  })

  it.each(["hidden", "enabled", "blocked_free_plan"] as const)(
    "shows the no-invite explanation only for hidden state: %s",
    (state) => {
      render(<InviteMemberCard state={state} />)

      const explanation = screen.queryByText(
        "Only Owners can invite people or change roles.",
      )
      if (state === "hidden") {
        expect(explanation).toHaveClass("text-sm", "text-muted")
        expect(explanation?.parentElement?.tagName).toBe("SECTION")
      } else {
        expect(explanation).not.toBeInTheDocument()
      }
    },
  )

  it("shows backend-advertised controls for capable staff and submits the chosen member and role", async () => {
    const user = userEvent.setup()
    mockUser.mockReturnValue(staff)
    mockUseTeamManagement.mockReturnValue({
      data: {
        ...baseManagement,
        members: [
          ...baseManagement.members,
          {
            ...baseManagement.members[0],
            user_id: "user-3",
            email: "other@example.com",
          },
        ],
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

    render(<TeamClient />)

    expect(screen.getByRole("button", { name: /^invite$/i })).toBeEnabled()
    expect(
      screen.getByRole("button", { name: /change role/i }),
    ).toBeInTheDocument()
    const memberSelect = screen.getByRole("combobox", {
      name: "Select member",
    })
    const roleSelect = screen.getByRole("combobox", { name: "New role" })
    expect(memberSelect).toHaveTextContent("owner@example.com")
    expect(roleSelect).toHaveTextContent("Owner")
    expect(screen.getByText("invited@example.com")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument()
    await user.click(memberSelect)
    expect(screen.getAllByRole("option")).toHaveLength(2)
    expect(
      screen.queryByRole("option", { name: "invited@example.com" }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("option", { name: "other@example.com" }))
    expect(memberSelect).toHaveTextContent("other@example.com")
    await user.click(roleSelect)
    expect(screen.getAllByRole("option")).toHaveLength(2)
    await user.click(screen.getByRole("option", { name: "Viewer" }))
    expect(roleSelect).toHaveTextContent("Viewer")
    expect(mockAssignRole).not.toHaveBeenCalled()
    mockAssignRole.mockResolvedValue(undefined)
    await user.click(screen.getByRole("button", { name: "Change role" }))
    const dialog = screen.getByRole("dialog", { name: "Change role" })
    expect(dialog).toHaveTextContent(
      "Change other@example.com from Owner to Viewer?",
    )
    expect(mockAssignRole).not.toHaveBeenCalled()
    await user.click(
      within(dialog).getByRole("button", { name: "Change role" }),
    )
    expect(mockAssignRole).toHaveBeenCalledWith({
      team: { teamId: "team-1", region: "use" },
      data: { user_id: "user-3", role_name: "viewer" },
      assignments: baseManagement.assignments,
    })
  })

  it.each([
    ["team_admin", "Team admin"],
    ["viewer", "Viewer"],
  ])(
    "keeps removed members in a closed disclosure and shows %s invitations",
    (role, label) => {
      mockUseTeamManagement.mockReturnValue({
        data: {
          ...baseManagement,
          members: [
            ...baseManagement.members,
            {
              ...baseManagement.members[0],
              user_id: "removed",
              email: "removed@example.com",
              status: "inactive",
            },
          ],
        },
        isPending: false,
      })
      mockUseTeamInvitations.mockReturnValue({
        data: { invitations: [{ ...pendingInvitation, role }] },
        isPending: false,
      })
      render(<TeamClient />)
      const summary = screen.getByText("Removed members (1)")
      expect(summary.parentElement).not.toHaveAttribute("open")
      fireEvent.click(summary)
      expect(screen.getByText("removed@example.com")).toBeInTheDocument()
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByText("Danger zone")).toBeInTheDocument()
    },
  )

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
      render(<TeamClient />)

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

      render(<TeamClient />)

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

      render(<TeamClient />)

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
      members: [
        ...baseManagement.members,
        {
          ...baseManagement.members[0],
          user_id: "user-3",
          email: "other@example.com",
        },
      ],
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

      render(<TeamClient />)

      expect(screen.queryByText("Role assignments")).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /change role/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /^revoke$/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /manage roles/i }),
      ).not.toBeInTheDocument()
    })

    it("offers Change role and Revoke to staff", () => {
      mockUser.mockReturnValue(staff)

      render(<TeamClient />)

      expect(
        screen.getByRole("button", { name: /change role/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /^revoke$/i }),
      ).toBeInTheDocument()
    })

    it("only mentions invites in the hidden invite explanation when staff can change roles", () => {
      mockUser.mockReturnValue(staff)

      render(<TeamClient />)

      expect(
        screen.queryByRole("button", { name: /^invite$/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /change role/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /^revoke$/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByText("Only Owners can invite people."),
      ).toBeInTheDocument()
      expect(
        screen.queryByText("Only Owners can invite people or change roles."),
      ).not.toBeInTheDocument()
    })

    it("confirms the role and member before revoking the assignment", async () => {
      mockUser.mockReturnValue(staff)
      mockRevokeRole.mockResolvedValue(undefined)
      const captured = { teamId: "team-1", region: "use" }
      mockDisplayedTeam.mockReturnValue(captured)
      render(<TeamClient />)

      fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
      let dialog = screen.getByRole("dialog", { name: "Revoke role" })
      expect(dialog).toHaveTextContent("Revoke Owner from owner@example.com?")
      expect(mockRevokeRole).not.toHaveBeenCalled()
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      )
      expect(mockRevokeRole).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
      dialog = screen.getByRole("dialog", { name: "Revoke role" })
      fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }))
      await waitFor(() => expect(mockRevokeRole).toHaveBeenCalledOnce())
      expect(mockRevokeRole).toHaveBeenCalledWith({
        team: captured,
        assignmentId: "assignment-1",
      })
      expect(mockRevokeRole.mock.calls[0][0].team).toBe(captured)
    })

    it.each([
      { teamId: "team-2", region: "use" },
      { teamId: "team-1", region: "usw" },
      null,
    ])(
      "closes role revocation without mutating when the team becomes %j",
      async (next) => {
        mockUser.mockReturnValue(staff)
        const view = render(<TeamClient />)
        fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
        expect(
          screen.getByRole("dialog", { name: "Revoke role" }),
        ).toBeInTheDocument()

        mockDisplayedTeam.mockReturnValue(next)
        view.rerender(
          <ToastProvider>
            <TeamClient />
          </ToastProvider>,
        )

        await waitFor(() =>
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
        )
        expect(mockRevokeRole).not.toHaveBeenCalled()
      },
    )

    it("allows a role change with a role-less active teammate when another owner remains", async () => {
      const user = userEvent.setup()
      mockUser.mockReturnValue(staff)
      mockAssignRole.mockResolvedValue(undefined)
      mockUseTeamManagement.mockReturnValue({
        data: {
          ...withRoleCapabilities,
          members: [
            ...withRoleCapabilities.members,
            {
              ...baseManagement.members[0],
              user_id: "user-4",
              email: "roleless@example.com",
              roles: undefined,
            },
          ],
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })
      render(<TeamClient />)
      expect(screen.getByRole("button", { name: "Change role" })).toBeDisabled()
      await user.click(screen.getByRole("combobox", { name: "New role" }))
      await user.click(screen.getByRole("option", { name: "Viewer" }))
      expect(screen.getByRole("button", { name: "Change role" })).toBeEnabled()
      await user.click(screen.getByRole("button", { name: "Change role" }))
      const dialog = screen.getByRole("dialog", { name: "Change role" })
      expect(dialog).toHaveTextContent(
        "Change owner@example.com from Owner to Viewer?",
      )
      expect(mockAssignRole).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
      expect(mockAssignRole).not.toHaveBeenCalled()
      await user.click(screen.getByRole("button", { name: "Change role" }))
      await user.click(
        within(screen.getByRole("dialog", { name: "Change role" })).getByRole(
          "button",
          { name: "Change role" },
        ),
      )
      expect(mockAssignRole).toHaveBeenCalledExactlyOnceWith({
        team: { teamId: "team-1", region: "use" },
        data: { user_id: "user-1", role_name: "viewer" },
        assignments: withRoleCapabilities.assignments,
      })
    })

    it("disables Change role while a replacement is pending", async () => {
      const user = userEvent.setup()
      mockUser.mockReturnValue(staff)
      const view = render(<TeamClient />)
      await user.click(screen.getByRole("combobox", { name: "New role" }))
      await user.click(screen.getByRole("option", { name: "Viewer" }))
      expect(screen.getByRole("button", { name: "Change role" })).toBeEnabled()
      mockRolePending.mockReturnValue(true)
      view.rerender(
        <ToastProvider>
          <TeamClient />
        </ToastProvider>,
      )
      expect(screen.getByRole("button", { name: "Changing..." })).toBeDisabled()
    })

    it.each(["inactive", "invited"] as const)(
      "does not count a %s member as another active owner",
      async (status) => {
        const user = userEvent.setup()
        mockUser.mockReturnValue(staff)
        mockUseTeamManagement.mockReturnValue({
          data: {
            ...withRoleCapabilities,
            members: withRoleCapabilities.members.map((member) =>
              member.user_id === "user-3" ? { ...member, status } : member,
            ),
          },
          isPending: false,
          error: null,
          refetch: vi.fn(),
        })
        render(<TeamClient />)
        await user.click(screen.getByRole("combobox", { name: "New role" }))
        await user.click(screen.getByRole("option", { name: "Viewer" }))
        expect(
          screen.getByRole("button", { name: "Change role" }),
        ).toBeDisabled()
        expect(screen.getByRole("button", { name: "Revoke" })).toBeDisabled()
      },
    )

    it("blocks Change role and Revoke for the sole owner", async () => {
      const user = userEvent.setup()
      mockUser.mockReturnValue(staff)
      mockUseTeamManagement.mockReturnValue({
        data: {
          ...withRoleCapabilities,
          members: baseManagement.members,
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })
      render(<TeamClient />)
      await user.click(screen.getByRole("combobox", { name: "New role" }))
      await user.click(screen.getByRole("option", { name: "Viewer" }))
      const change = screen.getByRole("button", { name: "Change role" })
      expect(change).toBeDisabled()
      expect(change).toHaveAccessibleDescription(
        "A team needs at least one owner.",
      )
      expect(screen.getByRole("button", { name: "Revoke" })).toBeDisabled()
      expect(
        screen.getByRole("button", { name: "Revoke" }),
      ).toHaveAccessibleDescription("A team needs at least one owner.")
      expect(screen.getByRole("button", { name: "Revoke" })).toHaveAttribute(
        "title",
        "A team needs at least one owner.",
      )
    })

    it("allows collapsing legacy roles to an already held role", async () => {
      mockUser.mockReturnValue(staff)
      mockUseTeamManagement.mockReturnValue({
        data: {
          ...withRoleCapabilities,
          members: withRoleCapabilities.members.map((member) =>
            member.user_id === "user-1"
              ? { ...member, roles: ["team_owner", "viewer"] }
              : member,
          ),
        },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })
      render(<TeamClient />)
      fireEvent.click(screen.getByRole("button", { name: "Change role" }))
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Change owner@example.com from Owner + Viewer to Owner?",
      )
    })

    it.each([
      { teamId: "team-2", region: "use" },
      { teamId: "team-1", region: "usw" },
      null,
    ])(
      "closes role change without mutating when the team becomes %j",
      async (next) => {
        const user = userEvent.setup()
        mockUser.mockReturnValue(staff)
        const view = render(<TeamClient />)
        await user.click(screen.getByRole("combobox", { name: "New role" }))
        await user.click(screen.getByRole("option", { name: "Viewer" }))
        fireEvent.click(screen.getByRole("button", { name: "Change role" }))
        expect(screen.getByRole("dialog")).toBeInTheDocument()
        mockDisplayedTeam.mockReturnValue(next)
        view.rerender(
          <ToastProvider>
            <TeamClient />
          </ToastProvider>,
        )
        await waitFor(() =>
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
        )
        expect(mockAssignRole).not.toHaveBeenCalled()
      },
    )

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

      render(<TeamClient />)

      expect(
        screen.queryByRole("button", { name: /change role/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /^revoke$/i }),
      ).not.toBeInTheDocument()
    })
  })

  it("counts open email invitations without accepted ones", () => {
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
    render(<TeamClient />)

    expect(
      screen.getByRole("heading", { name: "Pending invitations" })
        .parentElement,
    ).toHaveTextContent("2")
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
      render(<TeamClient />)

      const leave = screen.queryByRole("button", { name: /^leave team$/i })
      if (!offered) {
        expect(leave).not.toBeInTheDocument()
        return
      }
      expect(leave).toBeEnabled()
      expect(
        screen.queryByText("Make another member an owner before leaving."),
      ).not.toBeInTheDocument()
      expect(mockLeave).not.toHaveBeenCalled()
    })
    it.each([
      ["a 403 error", new ApiError(403, "error", "Request failed")],
      ["the member list", null],
    ])("hides leave on %s while viewing another team", (_n, error) => {
      mockImpersonatedTeam.mockReturnValue({
        teamId: "team-7",
        region: "use",
        name: "Viewed team",
      })
      mockUseTeamManagement.mockReturnValue({
        data: error ? undefined : baseManagement,
        isPending: false,
        error,
        refetch: vi.fn(),
      })
      render(<TeamClient />)

      expect(
        screen.queryByRole("button", { name: /^leave team$/i }),
      ).not.toBeInTheDocument()
    })
  })

  it("blocks leave for the sole active owner with an explanation", () => {
    mockUseTeamManagement.mockReturnValue({
      data: {
        ...baseManagement,
        capabilities: {
          ...baseManagement.capabilities,
          can_view_role_assignments: true,
        },
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<TeamClient />)
    expect(screen.getByRole("button", { name: "Leave team" })).toBeDisabled()
    expect(
      screen.getByText("Make another member an owner before leaving."),
    ).toBeInTheDocument()
  })

  it("allows a member to leave when roles are hidden", () => {
    mockUseTeamManagement.mockReturnValue({
      data: {
        ...baseManagement,
        members: baseManagement.members.map((member) => ({
          ...member,
          roles: undefined,
        })),
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<TeamClient />)
    expect(screen.getByRole("button", { name: "Leave team" })).toBeEnabled()
    expect(
      screen.queryByText("Make another member an owner before leaving."),
    ).not.toBeInTheDocument()
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
          const view = render(<TeamClient />)
          fireEvent.click(screen.getByRole("button", { name: open }))
          expect(screen.getByRole("dialog")).toBeInTheDocument()

          mockDisplayedTeam.mockReturnValue(next)
          view.rerender(
            <ToastProvider>
              <TeamClient />
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
        const view = render(<TeamClient />)
        fireEvent.click(screen.getByRole("button", { name: open }))
        mockDisplayedTeam.mockReturnValue({ ...captured })
        view.rerender(
          <ToastProvider>
            <TeamClient />
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
        render(<TeamClient />)
        fireEvent.click(screen.getByRole("button", { name: open }))
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
        expect(mutate).not.toHaveBeenCalled()
      })
    })

    it("explains full Owner access before an invitation is sent", () => {
      render(<TeamClient />)

      fireEvent.click(screen.getByRole("button", { name: /^invite$/i }))

      expect(
        screen.getByText(
          "Invites join as Owner with full access to this team.",
        ),
      ).toBeInTheDocument()
      expect(screen.getByLabelText(/email address/i)).toBeEnabled()
      expect(
        screen.getByRole("button", { name: /send invites/i }),
      ).toBeInTheDocument()
    })

    it.each([
      { teamId: "team-2", region: "use" },
      { teamId: "team-1", region: "usw" },
      null,
    ])(
      "closes and resets the invite when the scope becomes %j",
      async (next) => {
        const view = render(<TeamClient />)
        fireEvent.click(screen.getByRole("button", { name: /^invite$/i }))
        fireEvent.change(screen.getByLabelText(/email address/i), {
          target: { value: "new-owner@example.com" },
        })

        mockDisplayedTeam.mockReturnValue(next)
        view.rerender(
          <ToastProvider>
            <TeamClient />
          </ToastProvider>,
        )

        await waitFor(() =>
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
        )
        expect(mockCreateInvitation).not.toHaveBeenCalled()

        mockDisplayedTeam.mockReturnValue({ teamId: "team-2", region: "usw" })
        view.rerender(
          <ToastProvider>
            <TeamClient />
          </ToastProvider>,
        )
        fireEvent.click(screen.getByRole("button", { name: /^invite$/i }))
        expect(screen.getByLabelText(/email address/i)).toHaveValue("")
        expect(
          screen.getByRole("button", { name: /send invites/i }),
        ).toBeDisabled()
      },
    )

    it("sends the invitation with the scope captured when opened", () => {
      const captured = { teamId: "team-1", region: "use" }
      mockDisplayedTeam.mockReturnValue(captured)
      const view = render(<TeamClient />)
      fireEvent.click(screen.getByRole("button", { name: /^invite$/i }))

      mockDisplayedTeam.mockReturnValue({ ...captured })
      view.rerender(
        <ToastProvider>
          <TeamClient />
        </ToastProvider>,
      )
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "new-owner@example.com" },
      })
      fireEvent.keyDown(screen.getByLabelText(/email address/i), {
        key: "Enter",
      })
      mockCreateInvitation.mockResolvedValue({ delivery: "sent" })
      fireEvent.click(screen.getByRole("button", { name: /send invites/i }))

      expect(mockCreateInvitation).toHaveBeenCalledWith({
        team: captured,
        email: "new-owner@example.com",
      })
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

      render(<TeamClient />)

      const invite = screen.getByRole("button", { name: /^invite$/i })
      expect(invite).toBeDisabled()
      expect(invite).toHaveAttribute("title", "Upgrade to invite members")
      expect(
        screen.getAllByText("Upgrade to invite members").length,
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

      render(<TeamClient />)

      expect(
        screen.queryByRole("button", { name: /^invite$/i }),
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

      render(<TeamClient />)

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

      render(<TeamClient />)

      expect(
        screen.getByText("Invitations could not be loaded."),
      ).toBeInTheDocument()
    })

    it("lets members remove others but never themselves", () => {
      render(<TeamClient />)

      expect(
        screen.getAllByRole("button", { name: /remove member/i }),
      ).toHaveLength(1)
    })

    it("allows leaving when the user belongs to another team", () => {
      render(<TeamClient />)

      expect(
        screen.getByRole("button", { name: /^leave team$/i }),
      ).toBeEnabled()
    })

    it("blocks leaving the user's only team", () => {
      mockUseTeams.mockReturnValue({
        data: { teams: [{ id: "team-1", name: "Acme", region: "use" }] },
      })

      render(<TeamClient />)

      expect(
        screen.getByRole("button", { name: /^leave team$/i }),
      ).toBeDisabled()
      expect(screen.getByText(/this is your only team/i)).toBeInTheDocument()
    })

    it("blocks leaving until the team list is known", () => {
      mockUseTeams.mockReturnValue({ data: undefined })

      render(<TeamClient />)

      expect(
        screen.getByRole("button", { name: /^leave team$/i }),
      ).toBeDisabled()
    })
  })
})
