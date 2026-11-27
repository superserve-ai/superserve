import { ToastProvider } from "@superserve/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  render as baseRender,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { teamKeys } from "@/lib/api/query-keys"
import type { TeamDirectoryResponse } from "@/lib/api/teams-actions"

const mocks = vi.hoisted(() => ({
  directory: vi.fn(),
  setActive: vi.fn(),
}))
let teamsData: TeamDirectoryResponse

vi.mock("@/lib/api/teams-actions", () => ({
  listTeamsAction: mocks.directory,
  setActiveTeamAction: mocks.setActive,
}))

import { TeamSwitcher } from "./team-switcher"

const twoRegions = {
  activeTeamId: "team-a",
  activeRegion: "use",
  regions: ["use", "usw"],
  teams: [
    { id: "team-a", name: "alpha", region: "use" },
    { id: "team-w", name: "westside", region: "usw" },
  ],
}

beforeEach(() => {
  mocks.setActive.mockReset().mockResolvedValue(undefined)
  mocks.directory.mockReset().mockImplementation(async () => teamsData)
})

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(teamKeys.directory(), teamsData)
  return {
    client,
    ...baseRender(
      <QueryClientProvider client={client}>
        <ToastProvider>{ui}</ToastProvider>
      </QueryClientProvider>,
    ),
  }
}

describe("TeamSwitcher", () => {
  it("renders the active team's name, not the raw option value", () => {
    teamsData = twoRegions
    render(<TeamSwitcher />)
    expect(screen.getByText("alpha · US East")).toBeInTheDocument()
    expect(screen.queryByText(/use:team-a/)).not.toBeInTheDocument()
  })

  it("opens the dropdown and lists every team on click", async () => {
    teamsData = twoRegions
    const user = userEvent.setup()
    render(<TeamSwitcher />)

    await user.click(screen.getByRole("combobox", { name: "Active team" }))

    expect(
      await screen.findByRole("option", { name: "westside · US West" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", { name: "alpha · US East" }),
    ).toBeInTheDocument()
  })

  it("switches to the picked team", async () => {
    teamsData = twoRegions
    const user = userEvent.setup()
    render(<TeamSwitcher />)

    await user.click(screen.getByRole("combobox", { name: "Active team" }))
    await user.click(
      await screen.findByRole("option", { name: "westside · US West" }),
    )

    await waitFor(() =>
      expect(mocks.setActive).toHaveBeenCalledWith("team-w", "usw"),
    )
  })

  it("omits region labels when all teams share one region", () => {
    teamsData = {
      ...twoRegions,
      teams: [
        { id: "team-a", name: "alpha", region: "use" },
        { id: "team-b", name: "beta", region: "use" },
      ],
    }
    render(<TeamSwitcher />)
    expect(screen.getByText("alpha")).toBeInTheDocument()
  })

  it("renders nothing for single-team users", () => {
    teamsData = {
      ...twoRegions,
      teams: [{ id: "team-a", name: "alpha", region: "use" }],
    }
    render(<TeamSwitcher />)
    expect(
      screen.queryByRole("combobox", { name: "Active team" }),
    ).not.toBeInTheDocument()
  })

  it("rolls back and waits for the refreshed directory before reporting a removed membership", async () => {
    teamsData = twoRegions
    mocks.setActive.mockRejectedValue(new Error("Server action failed"))
    let finishRefresh!: (directory: TeamDirectoryResponse) => void
    mocks.directory.mockReturnValue(
      new Promise<TeamDirectoryResponse>((resolve) => {
        finishRefresh = resolve
      }),
    )
    const user = userEvent.setup()
    const { client } = render(<TeamSwitcher />)

    await user.click(screen.getByRole("combobox", { name: "Active team" }))
    await user.click(
      await screen.findByRole("option", { name: "westside · US West" }),
    )

    await waitFor(() => expect(mocks.directory).toHaveBeenCalledTimes(1))
    expect(client.getQueryData(teamKeys.directory())).toMatchObject({
      activeTeamId: "team-a",
      activeRegion: "use",
    })
    expect(client.isMutating({ mutationKey: ["switch-team"] })).toBe(1)
    expect(
      screen.queryByText(/You are no longer a member|Could not switch/),
    ).not.toBeInTheDocument()

    await act(async () => {
      finishRefresh({ ...twoRegions, teams: [twoRegions.teams[0]!] })
    })

    expect(
      await screen.findByText("You are no longer a member of westside."),
    ).toBeInTheDocument()
    expect(client.getQueryData(teamKeys.directory())).toMatchObject({
      teams: [twoRegions.teams[0]],
    })
    expect(
      screen.queryByRole("combobox", { name: "Active team" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Server action failed")).not.toBeInTheDocument()
  })

  it("shows a retry message when the refreshed directory cannot read the team's region", async () => {
    teamsData = twoRegions
    mocks.setActive.mockRejectedValue(new Error("Server action failed"))
    mocks.directory.mockResolvedValue({
      ...twoRegions,
      teams: [twoRegions.teams[0]!],
      degradedRegions: ["usw"],
    })
    const user = userEvent.setup()
    render(<TeamSwitcher />)

    await user.click(screen.getByRole("combobox", { name: "Active team" }))
    await user.click(
      await screen.findByRole("option", { name: "westside · US West" }),
    )

    expect(
      await screen.findByText("Could not switch to westside. Try again."),
    ).toBeInTheDocument()
    expect(mocks.directory).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByText("You are no longer a member of westside."),
    ).not.toBeInTheDocument()
  })

  it("shows a retry message when the refreshed directory still lists the team", async () => {
    teamsData = twoRegions
    mocks.setActive.mockRejectedValue(new Error("Server action failed"))
    const user = userEvent.setup()
    render(<TeamSwitcher />)

    await user.click(screen.getByRole("combobox", { name: "Active team" }))
    await user.click(
      await screen.findByRole("option", { name: "westside · US West" }),
    )

    expect(
      await screen.findByText("Could not switch to westside. Try again."),
    ).toBeInTheDocument()
    expect(mocks.directory).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole("combobox", { name: "Active team" }),
    ).toHaveTextContent("alpha · US East")
    expect(screen.queryByText("Server action failed")).not.toBeInTheDocument()
  })
})

describe("TeamSwitcher ordering", () => {
  it("lists the active team first, the rest alphabetical", async () => {
    teamsData = {
      activeTeamId: "team-m",
      activeRegion: "use",
      regions: ["use"],
      teams: [
        { id: "team-z", name: "zeta", region: "use" },
        { id: "team-m", name: "mango", region: "use" },
        { id: "team-a", name: "apple", region: "use" },
      ],
    }
    const user = userEvent.setup()
    render(<TeamSwitcher />)
    await user.click(screen.getByRole("combobox", { name: "Active team" }))
    const labels = (await screen.findAllByRole("option")).map(
      (o) => o.textContent,
    )
    expect(labels).toEqual(["mango", "apple", "zeta"])
  })
})
