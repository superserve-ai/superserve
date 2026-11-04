import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mutate = vi.fn()
let canRename = true

vi.mock("@superserve/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@superserve/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}))
vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({
    data: {
      teams: [{ id: "team-1", name: "Acme", region: "use" }],
      regions: ["use"],
      activeTeamId: "team-1",
      activeRegion: "use",
    },
  }),
  useCanRenameTeam: () => ({ data: canRename }),
  useRenameTeam: () => ({ mutate, isPending: false }),
}))

import { TeamDetailsSection } from "./team-details-section"

beforeEach(() => {
  mutate.mockReset()
  canRename = true
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

  it("is read-only without the capability", () => {
    canRename = false
    render(<TeamDetailsSection />)

    expect(screen.queryByLabelText("Team Name")).toBeNull()
    expect(screen.queryByRole("button", { name: "Save Name" })).toBeNull()
    expect(screen.getByText("Acme")).toBeTruthy()
    expect(screen.getByText("team-1")).toBeTruthy()
  })
})
