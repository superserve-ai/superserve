import { ToastProvider } from "@superserve/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { teamKeys } from "@/lib/api/query-keys"
import type {
  TeamManagementResponse,
  TeamMember,
} from "@/lib/api/team-management"

vi.mock("@/lib/api/team-management", () => ({
  getTeamManagement: vi.fn(),
  getTeamInvitations: vi.fn().mockResolvedValue({ invitations: [] }),
}))
vi.mock("@/lib/api/teams-actions", () => ({ listTeamsAction: vi.fn() }))
vi.mock("@/lib/api/team-invitations-actions", () => ({}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "self", app_metadata: {} } }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }))

import { TeamClient } from "./team-client"

function member(userId: string, roles: TeamMember["roles"]): TeamMember {
  return {
    user_id: userId,
    email: `${userId}@example.com`,
    status: "active",
    roles,
    created_at: "2026-06-24T00:00:00Z",
    updated_at: "2026-06-24T00:00:00Z",
  }
}

const otherMembers = [
  member("owner", ["team_owner"]),
  member("admin", ["viewer", "team_admin"]),
  member("viewer", ["viewer"]),
]
const removalNote = "Only Owners can remove Owners and Team admins."

function renderMembers({
  canRevoke = false,
  canDeactivate = true,
  members = otherMembers,
}: {
  canRevoke?: boolean
  canDeactivate?: boolean
  members?: TeamMember[]
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(teamKeys.directory(), {
    teams: [
      { id: "team-1", name: "Example team", region: "use" },
      { id: "team-2", name: "Other team", region: "use" },
    ],
    activeTeamId: "team-1",
    activeRegion: "use",
  })
  client.setQueryData<TeamManagementResponse>(["team-management"], {
    team_id: "team-1",
    region: "use",
    members: [
      member("self", [canRevoke ? "team_owner" : "team_admin"]),
      ...members,
    ],
    assignments: [],
    capabilities: {
      can_view_role_assignments: true,
      can_invite_members: false,
      can_deactivate_members: canDeactivate,
      can_assign_roles: false,
      can_revoke_roles: canRevoke,
    },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TeamClient />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe("member removal permissions", () => {
  it("lets a team admin remove viewers and explains protected rows", () => {
    renderMembers()

    expect(
      screen.queryByRole("button", { name: "Remove member owner@example.com" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Remove member admin@example.com" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Remove member viewer@example.com" }),
    ).toBeEnabled()
    expect(
      screen.getAllByRole("button", { name: /remove member/i }),
    ).toHaveLength(1)
    expect(screen.getByText(removalNote)).toBeInTheDocument()
  })

  it("lets an owner remove every other active member without a note", () => {
    renderMembers({
      canRevoke: true,
      members: [...otherMembers, member("unknown", null)],
    })

    for (const userId of ["owner", "admin", "viewer", "unknown"]) {
      expect(
        screen.getByRole("button", {
          name: `Remove member ${userId}@example.com`,
        }),
      ).toBeEnabled()
    }
    expect(
      screen.queryByRole("button", { name: "Remove member self@example.com" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(removalNote)).not.toBeInTheDocument()
  })

  it.each([undefined, null])(
    "hides Remove when the target's roles are %s",
    (roles) => {
      renderMembers({ members: [member("unknown", roles)] })

      expect(
        screen.queryByRole("button", { name: /remove member/i }),
      ).not.toBeInTheDocument()
      expect(screen.getByText(removalNote)).toBeInTheDocument()
    },
  )

  it("requires member deactivation permission even with role revocation permission", () => {
    renderMembers({ canRevoke: true, canDeactivate: false })

    expect(
      screen.queryByRole("button", { name: /remove member/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(removalNote)).not.toBeInTheDocument()
  })

  it("shows no protected-row note for the viewer's own or inactive rows", () => {
    renderMembers({
      members: [
        member("viewer", ["viewer"]),
        { ...member("invited", ["team_admin"]), status: "invited" },
        { ...member("removed", ["team_owner"]), status: "inactive" },
      ],
    })

    expect(
      screen.getAllByRole("button", { name: /remove member/i }),
    ).toHaveLength(1)
    expect(screen.queryByText(removalNote)).not.toBeInTheDocument()
  })
})
