import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mutate = vi.fn()
const addToast = vi.fn()
let teamsData: unknown

vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({ data: teamsData }),
  useCreateTeam: () => ({ mutate, isPending: false }),
}))

vi.mock("@superserve/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useToast: () => ({ addToast }) }
})

import { TeamsSection } from "./teams-section"

const account = { id: "team-me", name: "user@example.com", region: "usw" }

describe("TeamsSection", () => {
  beforeEach(() => {
    mutate.mockReset()
    addToast.mockReset()
    teamsData = {
      teams: [account],
      regions: ["use", "usw"],
      activeTeamId: "team-me",
      activeRegion: "usw",
      convertibleTeam: account,
    }
  })

  it("converts the user's own account in its region", async () => {
    const user = userEvent.setup()
    render(<TeamsSection />)

    expect(
      screen.getByText(/Your current account becomes this team in US West/),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("Team region")).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText("my-team"), "acme")
    await user.click(screen.getByRole("button", { name: "Create Team" }))

    expect(mutate).toHaveBeenCalledWith(
      { name: "acme", region: "usw", convertTeamId: "team-me" },
      expect.anything(),
    )
    mutate.mock.calls[0][1].onSuccess({
      team: { ...account, name: "acme" },
      converted: true,
    })
    expect(addToast).toHaveBeenCalledWith(
      "Your account is now the team acme",
      "success",
    )
  })

  it("creates a new team when the active team is not the account", async () => {
    teamsData = {
      teams: [account, { id: "team-a", name: "alpha", region: "use" }],
      regions: ["use", "usw"],
      activeTeamId: "team-a",
      activeRegion: "use",
      convertibleTeam: account,
    }
    const user = userEvent.setup()
    render(<TeamsSection />)

    expect(screen.getByLabelText("Team region")).toBeInTheDocument()
    expect(screen.queryByText(/becomes this team/)).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText("my-team"), "acme")
    await user.click(screen.getByRole("button", { name: "Create Team" }))

    expect(mutate).toHaveBeenCalledWith(
      { name: "acme", region: "use" },
      expect.anything(),
    )
    mutate.mock.calls[0][1].onSuccess({
      team: { id: "team-new", name: "acme", region: "use" },
      converted: false,
    })
    expect(addToast).toHaveBeenCalledWith(
      "Team acme created in US East",
      "success",
    )
  })

  it("offers the conversion as soon as the user switches to the account", () => {
    teamsData = {
      teams: [account, { id: "team-a", name: "alpha", region: "use" }],
      regions: ["use", "usw"],
      activeTeamId: "team-a",
      activeRegion: "use",
      convertibleTeam: account,
    }
    const { rerender } = render(<TeamsSection />)
    expect(screen.queryByText(/becomes this team/)).not.toBeInTheDocument()

    // A switch changes only the active selection in the cached directory.
    teamsData = {
      ...(teamsData as object),
      activeTeamId: "team-me",
      activeRegion: "usw",
    }
    rerender(<TeamsSection />)

    expect(screen.getByText(/becomes this team in US West/)).toBeInTheDocument()
  })

  it("reports a retried conversion the form no longer offers", async () => {
    const renamed = { ...account, name: "acme" }
    teamsData = {
      teams: [renamed],
      regions: ["use", "usw"],
      activeTeamId: "team-me",
      activeRegion: "usw",
      convertibleTeam: null,
    }
    const user = userEvent.setup()
    render(<TeamsSection />)

    await user.type(screen.getByPlaceholderText("my-team"), "acme")
    await user.click(screen.getByRole("button", { name: "Create Team" }))
    mutate.mock.calls[0][1].onSuccess({ team: renamed, converted: true })

    expect(addToast).toHaveBeenCalledWith(
      "Your account is now the team acme",
      "success",
    )
  })

  it("reports a retried creation of a known team as created", async () => {
    const created = { id: "team-a", name: "acme", region: "use" }
    teamsData = {
      teams: [account, created],
      regions: ["use", "usw"],
      activeTeamId: "team-a",
      activeRegion: "use",
      convertibleTeam: account,
    }
    const user = userEvent.setup()
    render(<TeamsSection />)

    await user.type(screen.getByPlaceholderText("my-team"), "acme")
    await user.click(screen.getByRole("button", { name: "Create Team" }))
    mutate.mock.calls[0][1].onSuccess({ team: created, converted: false })

    expect(addToast).toHaveBeenCalledWith(
      "Team acme created in US East",
      "success",
    )
  })
})
