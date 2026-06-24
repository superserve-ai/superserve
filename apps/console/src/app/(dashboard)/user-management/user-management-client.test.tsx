import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { TeamManagementResponse } from "@/lib/api/team-management"

const { mockUseTeamManagement } = vi.hoisted(() => ({
  mockUseTeamManagement: vi.fn(),
}))

vi.mock("@/hooks/use-team-management", () => ({
  useTeamManagement: () => mockUseTeamManagement(),
  useAddTeamMember: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignTeamRole: () => ({ mutate: vi.fn(), isPending: false }),
  useDeactivateTeamMember: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeTeamRole: () => ({ mutate: vi.fn(), isPending: false }),
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
    mockUseTeamManagement.mockReturnValue({
      data: baseManagement,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  it("shows members but hides mutation controls for viewers", () => {
    render(<UserManagementClient />)

    expect(screen.getByText("owner@example.com")).toBeInTheDocument()
    expect(screen.getByText("invited@example.com")).toBeInTheDocument()
    expect(
      screen.getByText("You have read-only access to team membership."),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /add member/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /deactivate/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /assign role/i }),
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
      screen.getByRole("button", { name: /add member/i }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /deactivate/i })).toHaveLength(
      2,
    )
    expect(
      screen.getByRole("button", { name: /assign role/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument()
  })
})
