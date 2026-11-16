import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ActivityResponse } from "@/lib/api/types"

const mocks = vi.hoisted(() => ({ activity: vi.fn() }))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock("@/components/query-provider", () => ({
  useQueryScope: () => "self",
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: null, loading: false }),
}))
vi.mock("@/hooks/use-activity", () => ({
  useActivityPage: mocks.activity,
}))

import AuditLogsPage from "./page"

const teamLog: ActivityResponse = {
  id: "event-1",
  sandbox_id: null,
  template_id: null,
  category: "team",
  action: "team_role_assigned",
  status: null,
  sandbox_name: null,
  secret_id: null,
  secret_name: null,
  actor_id: "actor-1",
  duration_ms: null,
  error: null,
  metadata: {
    role_name: "viewer",
    target_user_id: "member-1",
    assignment_id: "assignment-1",
  },
  created_at: "2026-11-01T00:00:00Z",
}

function show(log: ActivityResponse) {
  mocks.activity.mockReturnValue({
    data: { items: [log], total: 1 },
    isPending: false,
    error: null,
    isPlaceholderData: false,
  })
  return render(<AuditLogsPage />)
}

describe("team audit logs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, "", "/audit-logs")
  })

  it.each([
    ["team_invitation_created", "Invitation created"],
    ["team_invitation_resent", "Invitation resent"],
    ["team_invitation_revoked", "Invitation revoked"],
    ["team_invitation_accepted", "Invitation accepted"],
    ["team_member_left", "Member left"],
    ["team_renamed", "Team renamed"],
    ["team_role_assigned", "Role assigned"],
    ["team_role_revoked", "Role revoked"],
    ["team_member_removed", "Member removed"],
    ["team_future_action", "team_future_action"],
    ["sandbox_created", "sandbox_created"],
    ["constructor", "constructor"],
  ])("labels %s in summary and details as %s", (action, label) => {
    show({ ...teamLog, action })
    expect(screen.getByText(label)).toHaveClass("text-foreground/80")
    fireEvent.click(screen.getByRole("button", { name: "Expand details" }))
    expect(screen.getAllByText(label)).toHaveLength(2)
    expect(screen.getByText(`Team · ${label}`)).toBeInTheDocument()
    expect(screen.queryByText("Sandbox ID")).not.toBeInTheDocument()
    expect(
      screen.queryByText("Sandbox", { selector: "dt" }),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Team resource")).toBeInTheDocument()
    expect(screen.getByText("Assignment Id")).toBeInTheDocument()
  })

  it.each([
    [{ role_name: "viewer", target_user_id: "member-1" }, "member-1 · Viewer"],
    [
      { email: "member@example.com", role_name: "team_owner" },
      "member@example.com · Owner",
    ],
    [{ user_id: "member-1" }, "member-1"],
    [{ old_name: "Old team", new_name: "New team" }, "New team"],
    [{}, "Team"],
  ])("uses team metadata %j for the resource", (metadata, resource) => {
    show({ ...teamLog, metadata })
    const row = screen.getAllByRole("row")[1]!
    expect(within(row).getByText(resource)).toBeInTheDocument()
  })

  it("offers a Team tab and forwards category=team through the normal activity query", () => {
    const view = show(teamLog)
    fireEvent.click(screen.getByRole("button", { name: "Team" }))
    expect(window.location.search).toBe("?tab=team")
    view.rerender(<AuditLogsPage />)
    expect(mocks.activity).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: "team", status: undefined }),
      { enabled: true },
    )
    fireEvent.click(screen.getByRole("button", { name: "All" }))
    view.rerender(<AuditLogsPage />)
    expect(mocks.activity).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: undefined, status: undefined }),
      { enabled: true },
    )
  })

  it("preserves sandbox resources and detail fields for other categories", () => {
    show({
      ...teamLog,
      category: "sandbox",
      action: "sandbox_created",
      sandbox_name: "test-sandbox",
      sandbox_id: "sandbox-1",
      metadata: {},
    })
    expect(screen.getByText("test-sandbox")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Expand details" }))
    expect(screen.getByText("Sandbox ID")).toBeInTheDocument()
    expect(screen.getByText("sandbox-1")).toBeInTheDocument()
    expect(screen.queryByText("Team resource")).not.toBeInTheDocument()
  })
})
