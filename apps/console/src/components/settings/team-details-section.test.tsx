import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mutate = vi.fn()
let canRename = true
let teamName = "Example Team"
let managedTeamId = "team-1"

vi.mock("@superserve/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}))
vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({
    data: {
      teams: [{ id: "team-1", name: teamName, region: "use" }],
      regions: ["use"],
      activeTeamId: "team-1",
      activeRegion: "use",
    },
  }),
  useRenameTeam: () => ({ mutate, isPending: false }),
}))

vi.mock("@/hooks/use-team-management", () => ({
  useTeamManagement: () => ({
    data: {
      team_id: managedTeamId,
      capabilities: { can_rename_team: canRename },
    },
  }),
}))

import { TeamDetailsSection } from "./team-details-section"

beforeEach(() => {
  mutate.mockReset()
  canRename = true
  teamName = "Example Team"
  managedTeamId = "team-1"
})

describe("TeamDetailsSection", () => {
  it("shows the conflict message returned for a taken name", async () => {
    mutate.mockImplementation((_vars, opts) =>
      opts.onError(new Error("That name is unavailable. Try another.")),
    )
    render(<TeamDetailsSection />)

    fireEvent.change(screen.getByLabelText("Team Name"), {
      target: { value: "Taken" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save Name" }))

    await waitFor(() =>
      expect(
        screen.getByText("That name is unavailable. Try another."),
      ).toBeTruthy(),
    )
    expect(mutate.mock.calls[0][0]).toMatchObject({ name: "Taken" })
  })

  it("resyncs an untouched name when the directory updates", () => {
    const { rerender } = render(<TeamDetailsSection />)

    teamName = "Updated Team"
    rerender(<TeamDetailsSection />)

    expect((screen.getByLabelText("Team Name") as HTMLInputElement).value).toBe(
      "Updated Team",
    )
    expect(
      (screen.getByRole("button", { name: "Save Name" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it("keeps an edited name when the directory updates", () => {
    const { rerender } = render(<TeamDetailsSection />)
    fireEvent.change(screen.getByLabelText("Team Name"), {
      target: { value: "Draft Team" },
    })

    teamName = "Updated Team"
    rerender(<TeamDetailsSection />)

    expect((screen.getByLabelText("Team Name") as HTMLInputElement).value).toBe(
      "Draft Team",
    )
  })

  it("is read-only without the capability", () => {
    canRename = false
    render(<TeamDetailsSection />)

    expect(screen.queryByLabelText("Team Name")).toBeNull()
    expect(screen.queryByRole("button", { name: "Save Name" })).toBeNull()
    expect(screen.getByText("Example Team")).toBeTruthy()
    expect(screen.getByText("team-1")).toBeTruthy()
  })

  it("is read-only while the capability belongs to another team", () => {
    managedTeamId = "team-2"
    render(<TeamDetailsSection />)

    expect(screen.queryByLabelText("Team Name")).toBeNull()
  })
})
