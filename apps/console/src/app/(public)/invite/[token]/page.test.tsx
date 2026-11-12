import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock("@/lib/invite/accept", () => ({ loadInviteView: mocks.load }))
vi.mock("./actions", () => ({ beginInviteAuthAction: vi.fn() }))
vi.mock("./invite-controls", () => ({
  AutoJoin: () => null,
  ConfirmControls: () => null,
  MismatchControls: () => null,
}))

import InvitePage from "./page"

const token = `ssinv_use_${"T".repeat(43)}`
beforeEach(() => vi.resetAllMocks())
describe("InvitePage role copy", () => {
  it.each([
    ["signed_out", "team_admin", "Team admin"],
    ["confirm", "team_admin", "Team admin"],
    ["signed_out", "viewer", "Viewer"],
    ["confirm", "viewer", "Viewer"],
  ])(
    "uses the preview role for %s with %s access",
    async (kind, role, label) => {
      mocks.load.mockResolvedValue({
        view: {
          kind,
          preview: {
            teamName: "Example team",
            role,
            region: "use",
            expiresAt: "2026-11-14T00:00:00Z",
          },
          signedInEmail: "person@example.com",
        },
      })
      render(
        await InvitePage({
          params: Promise.resolve({ token }),
          searchParams: Promise.resolve({}),
        }),
      )
      expect(
        screen.getByText(`You're invited to join Example team as ${label}.`),
      ).toBeInTheDocument()
      expect(screen.queryByText(/join as an owner/i)).not.toBeInTheDocument()
    },
  )
  it("keeps legacy Owner copy without a role", async () => {
    mocks.load.mockResolvedValue({
      view: {
        kind: "signed_out",
        preview: {
          teamName: "Example team",
          region: "use",
          expiresAt: "2026-11-14T00:00:00Z",
        },
      },
    })
    render(
      await InvitePage({
        params: Promise.resolve({ token }),
        searchParams: Promise.resolve({}),
      }),
    )
    expect(screen.getByText(/join this team as an Owner/)).toBeInTheDocument()
  })
})
