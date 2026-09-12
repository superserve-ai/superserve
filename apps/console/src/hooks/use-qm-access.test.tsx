import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mockUseUser = vi.fn()
const mockUseTeams = vi.fn()
const mockTeamContext = vi.fn()

vi.mock("@/hooks/use-user", () => ({ useUser: () => mockUseUser() }))
vi.mock("@/hooks/use-teams", () => ({ useTeams: () => mockUseTeams() }))
vi.mock("@/components/query-provider", () => ({
  useDashboardTeamContext: () => mockTeamContext(),
}))

import { useQmAccess } from "./use-qm-access"

const customer = { email: "dev@example.com", app_metadata: {} }
const staff = {
  email: "ops@superserve.ai",
  app_metadata: { provider: "google" },
}

describe("useQmAccess", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    mockTeamContext.mockReset()
  })

  it("is closed and settled when nothing is allowlisted", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "")
    mockUseUser.mockReturnValue({ user: customer, loading: false })
    mockUseTeams.mockReturnValue({ data: undefined, isPending: true })
    mockTeamContext.mockReturnValue(null)
    expect(renderHook(() => useQmAccess()).result.current).toEqual({
      enabled: false,
      loading: false,
    })
  })

  it("waits for the user before deciding", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "")
    mockUseUser.mockReturnValue({ user: null, loading: true })
    mockUseTeams.mockReturnValue({ data: undefined, isPending: true })
    mockTeamContext.mockReturnValue(null)
    expect(renderHook(() => useQmAccess()).result.current.loading).toBe(true)
  })

  it("admits staff without waiting for the team directory", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "")
    mockUseUser.mockReturnValue({ user: staff, loading: false })
    mockUseTeams.mockReturnValue({ data: undefined, isPending: true })
    mockTeamContext.mockReturnValue(null)
    expect(renderHook(() => useQmAccess()).result.current).toEqual({
      enabled: true,
      loading: false,
    })
  })

  it("waits for the active team when a team allowlist is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "team-a")
    mockUseUser.mockReturnValue({ user: customer, loading: false })
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

  it("uses the impersonated team while viewing another team", () => {
    vi.stubEnv("NEXT_PUBLIC_QM_BETA_TEAMS", "team-a")
    mockUseUser.mockReturnValue({ user: customer, loading: false })
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
