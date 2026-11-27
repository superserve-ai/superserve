import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"

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
      convertibleTeams: [account],
    }
  })

  it.each([
    new Error("Enter a team name between 1 and 256 bytes"),
    new Error("Retry the pending team creation using its original name"),
    new ApiError(403, "invalid_team_name", "Team name is required"),
    new ApiError(
      403,
      "invalid_team_name",
      "Enter a team name between 1 and 256 bytes",
    ),
    new ApiError(403, "region_unavailable", "Region usw is not available"),
    new ApiError(
      403,
      "account_team_unconfirmed",
      "Could not read your account team. Try again.",
    ),
    new ApiError(
      403,
      "team_name_conflict",
      "That name is unavailable. Try another.",
    ),
    new ApiError(
      403,
      "team_conversion_unavailable",
      "Your account team changed. Reload the page and try again.",
    ),
    new ApiError(403, "signup_blocked", "New signups are temporarily paused."),
  ])("preserves the curated creation message: %s", async (error) => {
    const log = vi.spyOn(console, "error")
    const user = userEvent.setup()
    render(<TeamsSection />)

    await user.type(screen.getByPlaceholderText("my-team"), "Example Team")
    await user.click(screen.getByRole("button", { name: "Create Team" }))
    mutate.mock.calls[0][1].onError(error)

    expect(addToast).toHaveBeenCalledWith(error.message, "error")
    expect(log).not.toHaveBeenCalled()
  })

  it.each([
    new Error("Failed to fetch"),
    new Error(
      "An error occurred in the Server Components render. The specific message is omitted in production builds.",
    ),
    new ApiError(500, "internal_error", "Database connection failed"),
    new ApiError(
      500,
      "internal_error",
      "Enter a team name between 1 and 256 bytes",
    ),
    new Error("Team name is required"),
    new Error("Region usw is not available"),
    new Error("Could not read your account team. Try again."),
    new Error("Backend error: Region usw is not available"),
    new Error("Region usw is not available: backend unavailable"),
  ])(
    "logs unexpected creation errors and shows a fallback: %s",
    async (error) => {
      const log = vi.spyOn(console, "error")
      const user = userEvent.setup()
      render(<TeamsSection />)

      await user.type(screen.getByPlaceholderText("my-team"), "Example Team")
      await user.click(screen.getByRole("button", { name: "Create Team" }))
      mutate.mock.calls[0][1].onError(error)

      expect(addToast).toHaveBeenCalledExactlyOnceWith(
        "Failed to create team. Try again.",
        "error",
      )
      expect(log).toHaveBeenCalledWith("Failed to create team:", error)
    },
  )

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
      convertibleTeams: [account],
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
      convertibleTeams: [account],
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

  it.each([
    ["the account is the only team", [account]],
    [
      "the user has other teams",
      [account, { id: "team-a", name: "alpha", region: "usw" }],
    ],
  ])(
    "converts the account in a single-region deployment when %s",
    async (_, teams) => {
      teamsData = {
        teams,
        regions: ["usw"],
        activeTeamId: "team-me",
        activeRegion: "usw",
        convertibleTeams: [account],
      }
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
    },
  )

  it("offers no new team in a single-region deployment", () => {
    const other = { id: "team-a", name: "alpha", region: "usw" }
    teamsData = {
      teams: [account, other],
      regions: ["usw"],
      activeTeamId: "team-a",
      activeRegion: "usw",
      convertibleTeams: [account],
    }
    render(<TeamsSection />)

    expect(screen.getByText("alpha")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Create Team" }),
    ).not.toBeInTheDocument()
  })

  it("converts whichever account team is active", async () => {
    const east = { id: "team-me-e", name: "user@example.com", region: "use" }
    teamsData = {
      teams: [account, east],
      regions: ["use", "usw"],
      activeTeamId: "team-me",
      activeRegion: "usw",
      convertibleTeams: [account, east],
    }
    const user = userEvent.setup()
    const { rerender } = render(<TeamsSection />)
    expect(screen.getByText(/becomes this team in US West/)).toBeInTheDocument()

    teamsData = {
      ...(teamsData as object),
      activeTeamId: "team-me-e",
      activeRegion: "use",
    }
    rerender(<TeamsSection />)
    expect(screen.getByText(/becomes this team in US East/)).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText("my-team"), "acme")
    await user.click(screen.getByRole("button", { name: "Create Team" }))
    expect(mutate).toHaveBeenCalledWith(
      { name: "acme", region: "use", convertTeamId: "team-me-e" },
      expect.anything(),
    )
  })

  it("reports a retried conversion the form no longer offers", async () => {
    const renamed = { ...account, name: "acme" }
    teamsData = {
      teams: [renamed],
      regions: ["use", "usw"],
      activeTeamId: "team-me",
      activeRegion: "usw",
      convertibleTeams: [],
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
      convertibleTeams: [account],
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
