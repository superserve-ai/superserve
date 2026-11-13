import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { billingKeys, teamKeys } from "@/lib/api/query-keys"
import { renameTeamAction } from "@/lib/api/team-rename-actions"
import { RenameTeamActionFailure } from "@/lib/api/team-rename-error"

import { refreshTeamScopedQueries, useRenameTeam } from "./use-teams"

vi.mock("@/lib/api/team-rename-actions", () => ({
  renameTeamAction: vi.fn(),
}))

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

describe("useRenameTeam", () => {
  function setup() {
    const client = new QueryClient()
    return renderHook(() => useRenameTeam(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    })
  }

  it.each([
    "invalid_name",
    "name_unavailable",
    "forbidden",
    "team_changed",
    "failed",
  ] as const)("distinguishes the curated %s failure", async (code) => {
    const message = "Curated rename failure"
    vi.mocked(renameTeamAction).mockResolvedValue({ ok: false, code, message })
    const { result } = setup()

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          team: { id: "team-1", region: "use" },
          name: "Renamed Team",
        }),
      ).rejects.toEqual(new RenameTeamActionFailure(code, message))
    })
    await waitFor(() =>
      expect(result.current.error).toBeInstanceOf(RenameTeamActionFailure),
    )
    expect(result.current.error).toMatchObject({ code, message })
  })

  it("preserves unexpected errors for the caller to log", async () => {
    const error = new Error("Failed to fetch")
    vi.mocked(renameTeamAction).mockRejectedValue(error)
    const { result } = setup()

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          team: { id: "team-1", region: "use" },
          name: "Renamed Team",
        }),
      ).rejects.toBe(error)
    })
    await waitFor(() => expect(result.current.error).toBe(error))
  })
})
