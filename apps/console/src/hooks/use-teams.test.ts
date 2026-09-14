import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { billingKeys, teamKeys } from "@/lib/api/query-keys"
import type { TeamDirectoryResponse } from "@/lib/api/teams-actions"
import { createQueryWrapper } from "@/test/react-query"

const mockListTeams = vi.fn()
const mockCreateTeam = vi.fn()
const mockSetActiveTeam = vi.fn()

vi.mock("@/lib/api/teams-actions", () => ({
  listTeamsAction: (...a: unknown[]) => mockListTeams(...a),
  createTeamAction: (...a: unknown[]) => mockCreateTeam(...a),
  setActiveTeamAction: (...a: unknown[]) => mockSetActiveTeam(...a),
}))

import {
  refreshTeamScopedQueries,
  useCreateTeam,
  useSwitchTeam,
  useTeams,
} from "./use-teams"

afterEach(() => {
  vi.clearAllMocks()
})

describe("refreshTeamScopedQueries", () => {
  it("invalidates billing and resets all non-team queries", () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
      resetQueries: vi.fn(),
    }

    refreshTeamScopedQueries(queryClient as never)

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: billingKeys.all,
    })
    expect(queryClient.resetQueries).toHaveBeenCalledWith({
      predicate: expect.any(Function),
    })
    const predicate = queryClient.resetQueries.mock.calls[0][0]
      .predicate as (query: { queryKey: readonly unknown[] }) => boolean
    expect(predicate({ queryKey: teamKeys.directory() })).toBe(false)
    expect(predicate({ queryKey: billingKeys.all })).toBe(true)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const directory = (
  activeTeamId: string,
  teams: TeamDirectoryResponse["teams"] = [
    { id: "team-a", name: "Team A", region: "use" },
    { id: "team-b", name: "Team B", region: "use" },
  ],
): TeamDirectoryResponse => ({
  teams,
  regions: ["use"],
  activeTeamId,
  activeRegion: "use",
})

describe("useSwitchTeam onError", () => {
  it("refetches the directory instead of restoring a stale pre-switch snapshot", async () => {
    // A team creation queued behind this switch (same mutation scope) can
    // commit its own selection to the server cookie before the switch's own
    // mutationFn runs. If the switch then fails, rolling back to the
    // snapshot captured in its onMutate — before the creation landed — would
    // put the client back on a team the cookie no longer names. Instead the
    // directory should be refetched so it reflects whatever the server
    // actually holds.
    const { queryClient, wrapper } = createQueryWrapper()

    mockListTeams.mockResolvedValueOnce(directory("team-a"))
    const { result: teamsResult } = renderHook(() => useTeams(), { wrapper })
    await waitFor(() => expect(teamsResult.current.isSuccess).toBe(true))

    const create = deferred<{ id: string; name: string; region: string }>()
    mockCreateTeam.mockReturnValueOnce(create.promise)
    const createdTeams = [
      ...directory("team-a").teams,
      { id: "team-c", name: "Team C", region: "use" },
    ]
    mockListTeams.mockResolvedValueOnce(directory("team-c", createdTeams))

    const { result: createResult } = renderHook(() => useCreateTeam(), {
      wrapper,
    })
    const { result: switchResult } = renderHook(() => useSwitchTeam(), {
      wrapper,
    })

    act(() => {
      createResult.current.mutate({ name: "Team C", region: "use" })
    })

    const switchFailure = deferred<never>()
    mockSetActiveTeam.mockReturnValueOnce(switchFailure.promise)
    act(() => {
      switchResult.current.mutate({ teamId: "team-b", region: "use" })
    })

    // The switch flips the client to team-b immediately, ahead of its
    // (queued) mutationFn actually running.
    await waitFor(() =>
      expect(
        queryClient.getQueryData<TeamDirectoryResponse>(teamKeys.directory())
          ?.activeTeamId,
      ).toBe("team-b"),
    )

    await act(async () => {
      create.resolve({ id: "team-c", name: "Team C", region: "use" })
      await waitFor(() => expect(createResult.current.isSuccess).toBe(true))
    })

    // The creation's own reconciliation has now named team-c active, ahead
    // of the switch's mutationFn running at all.
    expect(
      queryClient.getQueryData<TeamDirectoryResponse>(teamKeys.directory())
        ?.activeTeamId,
    ).toBe("team-c")

    mockListTeams.mockResolvedValueOnce(directory("team-c", createdTeams))
    await act(async () => {
      switchFailure.reject(new Error("network error"))
      await waitFor(() => expect(switchResult.current.isError).toBe(true))
    })

    await waitFor(() => expect(mockListTeams).toHaveBeenCalledTimes(3))
    expect(
      queryClient.getQueryData<TeamDirectoryResponse>(teamKeys.directory())
        ?.activeTeamId,
    ).toBe("team-c")
  })

  it("stays pending until the reconciling refetch settles", async () => {
    // `teamKeys.switching()` is how the QM hooks tell a switch is still in
    // flight and hold off reads/writes. If onError resolved before the
    // directory refetch it kicks off, those hooks would treat the switch as
    // over while the cache still names the rejected team.
    const { wrapper } = createQueryWrapper()
    mockListTeams.mockResolvedValueOnce(directory("team-a"))
    const { result: teamsResult } = renderHook(() => useTeams(), { wrapper })
    await waitFor(() => expect(teamsResult.current.isSuccess).toBe(true))

    const switchFailure = deferred<never>()
    mockSetActiveTeam.mockReturnValueOnce(switchFailure.promise)
    const { result: switchResult } = renderHook(() => useSwitchTeam(), {
      wrapper,
    })
    act(() => {
      switchResult.current.mutate({ teamId: "team-b", region: "use" })
    })

    const refetch = deferred<TeamDirectoryResponse>()
    mockListTeams.mockReturnValueOnce(refetch.promise)
    act(() => {
      switchFailure.reject(new Error("network error"))
    })

    // The switch call has rejected, but reconciliation is still in flight —
    // the mutation should not have settled yet.
    await waitFor(() => expect(mockListTeams).toHaveBeenCalledTimes(2))
    expect(switchResult.current.isPending).toBe(true)

    await act(async () => {
      refetch.resolve(directory("team-a"))
      await waitFor(() => expect(switchResult.current.isError).toBe(true))
    })
  })

  it("resets the directory rather than keep the rejected team if the reconciling refetch itself fails", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    mockListTeams.mockResolvedValueOnce(directory("team-a"))
    const { result: teamsResult } = renderHook(() => useTeams(), { wrapper })
    await waitFor(() => expect(teamsResult.current.isSuccess).toBe(true))

    mockSetActiveTeam.mockRejectedValueOnce(new Error("network error"))
    mockListTeams.mockRejectedValueOnce(new Error("directory unreachable"))
    mockListTeams.mockResolvedValueOnce(directory("team-a"))

    const { result: switchResult } = renderHook(() => useSwitchTeam(), {
      wrapper,
    })
    await act(async () => {
      switchResult.current.mutate({ teamId: "team-b", region: "use" })
      await waitFor(() => expect(switchResult.current.isError).toBe(true))
    })

    // The rejected optimistic selection ("team-b") is not left behind: a
    // failed fetch keeps the last-known data in place, so it has to be
    // reset rather than trusted.
    expect(
      queryClient.getQueryData<TeamDirectoryResponse>(teamKeys.directory())
        ?.activeTeamId,
    ).not.toBe("team-b")
  })
})
