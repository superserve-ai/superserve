import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mockUseTeams = vi.fn()
const mockTeamContext = vi.fn()

vi.mock("@/hooks/use-teams", () => ({ useTeams: () => mockUseTeams() }))
vi.mock("@/components/query-provider", () => ({
  useDashboardTeamContext: () => mockTeamContext(),
}))

import { useQmAccess } from "./use-qm-access"

describe("useQmAccess", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    mockTeamContext.mockReset()
  })

  it("is closed and settled when nothing is allowlisted", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "")
    mockUseTeams.mockReturnValue({ data: undefined, isPending: true })
    mockTeamContext.mockReturnValue(null)
    expect(renderHook(() => useQmAccess()).result.current).toEqual({
      enabled: false,
      loading: false,
    })
  })

  it("opens immediately with the wildcard", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "*")
    mockUseTeams.mockReturnValue({ data: undefined, isPending: true })
    mockTeamContext.mockReturnValue(null)
    expect(renderHook(() => useQmAccess()).result.current).toEqual({
      enabled: true,
      loading: false,
    })
  })

  it("waits for the active team when a team allowlist is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "team-a")
    mockUseTeams.mockReturnValue({ data: undefined, isPending: true })
    mockTeamContext.mockReturnValue(null)
    expect(renderHook(() => useQmAccess()).result.current.loading).toBe(true)

    mockUseTeams.mockReturnValue({
      data: { activeTeamId: "team-a" },
      isPending: false,
    })
    expect(renderHook(() => useQmAccess()).result.current).toEqual({
      enabled: true,
      loading: false,
    })

    mockUseTeams.mockReturnValue({
      data: { activeTeamId: "team-z" },
      isPending: false,
    })
    expect(renderHook(() => useQmAccess()).result.current).toEqual({
      enabled: false,
      loading: false,
    })
  })

  it("settles closed when the directory fails to load", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "team-a")
    mockUseTeams.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new Error("boom"),
    })
    mockTeamContext.mockReturnValue(null)
    expect(renderHook(() => useQmAccess()).result.current).toEqual({
      enabled: false,
      loading: false,
    })
  })

  it("uses the impersonated team while viewing another team", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "team-a")
    mockUseTeams.mockReturnValue({ data: undefined, isPending: true })
    mockTeamContext.mockReturnValue({
      teamId: "team-a",
      region: "use",
      name: "Pilot",
    })
    expect(renderHook(() => useQmAccess()).result.current).toEqual({
      enabled: true,
      loading: false,
    })
  })
})
