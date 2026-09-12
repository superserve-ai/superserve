/**
 * use-qm-tenants hook tests — polling on transitional states, optimistic
 * delete, error surfacing (including field errors from a 400), and the
 * admin-link mutation never touching the query cache.
 */

import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"
import { qmKeys } from "@/lib/api/query-keys"
import type {
  QmAdminLink,
  QmTenant,
  QmTenantDetailResponse,
} from "@/lib/api/types"
import { createQueryWrapper } from "@/test/react-query"

const mockList = vi.fn()
const mockGet = vi.fn()
const mockCreate = vi.fn()
const mockDelete = vi.fn()
const mockRetry = vi.fn()
const mockAdminLink = vi.fn()
const mockCheckSlug = vi.fn()

vi.mock("@/lib/api/qm", () => ({
  listQmTenants: (...a: unknown[]) => mockList(...a),
  getQmTenant: (...a: unknown[]) => mockGet(...a),
  createQmTenant: (...a: unknown[]) => mockCreate(...a),
  deleteQmTenant: (...a: unknown[]) => mockDelete(...a),
  retryQmTenant: (...a: unknown[]) => mockRetry(...a),
  getQmAdminLink: (...a: unknown[]) => mockAdminLink(...a),
  checkQmSlug: (...a: unknown[]) => mockCheckSlug(...a),
}))

const mockAddToast = vi.fn()
vi.mock("@superserve/ui", () => ({
  useToast: () => ({ addToast: mockAddToast }),
}))

import {
  useCreateQmTenant,
  useDeleteQmTenant,
  useQmAdminLink,
  useQmSlugAvailability,
  useQmTenant,
  useQmTenants,
  useRetryQmTenant,
} from "./use-qm-tenants"

const tenant = (overrides: Partial<QmTenant> = {}): QmTenant => ({
  id: "t1",
  teamId: "team-a",
  slug: "acme",
  orgName: "Acme",
  adminEmail: "admin@example.com",
  signIn: "magic_link",
  modelProvider: "anthropic",
  harness: "pi",
  status: "ready",
  publicUrl: "https://acme.qm.example.com",
  imageTag: "v1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
})

const detail = (t: QmTenant): QmTenantDetailResponse => ({
  tenant: t,
  events: [],
})

// Hooks append the query scope ("self" without a provider) to every key.
const listKey = [...qmKeys.list(), "self"]
const detailKey = (id: string) => [...qmKeys.detail(id), "self"]

// React Query only re-renders when a property read during render changes, so
// polling tests must read `data` (as any real consumer would) before asserting
// on later fetches; otherwise `result.current` stays stale after a refetch.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  mockList.mockReset()
  mockGet.mockReset()
  mockCreate.mockReset()
  mockDelete.mockReset()
  mockRetry.mockReset()
  mockAdminLink.mockReset()
  mockCheckSlug.mockReset()
  mockAddToast.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("useQmTenant", () => {
  it("polls every 2s while provisioning and stops once ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { wrapper } = createQueryWrapper()
    mockGet
      .mockResolvedValueOnce(detail(tenant({ status: "provisioning" })))
      .mockResolvedValueOnce(detail(tenant({ status: "provisioning" })))
      .mockResolvedValue(detail(tenant({ status: "ready" })))

    const { result } = renderHook(() => useQmTenant("t1"), { wrapper })
    await waitFor(() =>
      expect(result.current.data?.tenant.status).toBe("provisioning"),
    )
    expect(mockGet).toHaveBeenCalledTimes(1)

    await advance(2100)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
    expect(result.current.data?.tenant.status).toBe("provisioning")

    await advance(2100)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3))
    await waitFor(() =>
      expect(result.current.data?.tenant.status).toBe("ready"),
    )

    // Terminal state: no further polling.
    await advance(6000)
    expect(mockGet).toHaveBeenCalledTimes(3)
  })

  it("polls while deprovisioning", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { wrapper } = createQueryWrapper()
    mockGet.mockResolvedValue(detail(tenant({ status: "deprovisioning" })))

    const { result } = renderHook(() => useQmTenant("t1"), { wrapper })
    await waitFor(() =>
      expect(result.current.data?.tenant.status).toBe("deprovisioning"),
    )

    await advance(2100)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
  })

  it.each(["ready", "failed", "deleted"] as const)(
    "does not poll on terminal status %s",
    async (status) => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const { wrapper } = createQueryWrapper()
      mockGet.mockResolvedValue(detail(tenant({ status })))

      const { result } = renderHook(() => useQmTenant("t1"), { wrapper })
      await waitFor(() =>
        expect(result.current.data?.tenant.status).toBe(status),
      )

      await advance(6000)
      expect(mockGet).toHaveBeenCalledTimes(1)
    },
  )

  it("is disabled without an id", () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useQmTenant(null), { wrapper })
    expect(result.current.fetchStatus).toBe("idle")
    expect(mockGet).not.toHaveBeenCalled()
  })
})

describe("useQmTenants", () => {
  it("lists tenants and polls while any tenant is transitional", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { wrapper } = createQueryWrapper()
    mockList
      .mockResolvedValueOnce([tenant({ id: "a", status: "provisioning" })])
      .mockResolvedValue([tenant({ id: "a", status: "ready" })])

    const { result } = renderHook(() => useQmTenants(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.[0].status).toBe("provisioning")

    await advance(2100)
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2))

    await advance(6000)
    expect(mockList).toHaveBeenCalledTimes(2)
  })
})

describe("useCreateQmTenant", () => {
  const body = {
    slug: "acme",
    orgName: "Acme",
    adminEmail: "admin@example.com",
    signIn: "magic_link" as const,
    modelProvider: "anthropic" as const,
    modelKey: "sk-ant-secret",
  }

  it("prepends the created tenant to cached lists without caching the model key", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    queryClient.setQueryData(listKey, [tenant({ id: "old" })])
    const created = tenant({ id: "new", slug: "acme", status: "provisioning" })
    mockCreate.mockResolvedValue(created)

    const { result } = renderHook(() => useCreateQmTenant(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(body)
    })

    expect(mockCreate).toHaveBeenCalledWith(body)
    const list = queryClient.getQueryData<QmTenant[]>(listKey)
    expect(list?.map((t) => t.id)).toEqual(["new", "old"])
    // The model key must never land anywhere in the cache.
    const cacheDump = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => [q.queryKey, q.state]),
    )
    expect(cacheDump).not.toContain("sk-ant-secret")
    const mutationDump = JSON.stringify(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    )
    expect(mutationDump).not.toContain("sk-ant-secret")
  })

  it("keeps each concurrent create's model key with its own request", async () => {
    const { wrapper } = createQueryWrapper()
    mockCreate.mockImplementation(async (data: { slug: string }) =>
      tenant({ id: data.slug, slug: data.slug }),
    )

    const { result } = renderHook(() => useCreateQmTenant(), { wrapper })
    await act(async () => {
      await Promise.all([
        result.current.mutateAsync({
          ...body,
          slug: "one",
          modelKey: "key-one",
        }),
        result.current.mutateAsync({
          ...body,
          slug: "two",
          modelKey: "key-two",
        }),
      ])
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "one", modelKey: "key-one" }),
    )
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "two", modelKey: "key-two" }),
    )
  })

  it("only prepends to the active scope's list", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    const otherScopeKey = [...qmKeys.list(), "team:other"]
    queryClient.setQueryData(listKey, [tenant({ id: "old" })])
    queryClient.setQueryData(otherScopeKey, [tenant({ id: "theirs" })])
    mockCreate.mockResolvedValue(tenant({ id: "new", slug: "acme" }))

    const { result } = renderHook(() => useCreateQmTenant(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(body)
    })

    expect(
      queryClient.getQueryData<QmTenant[]>(listKey)?.map((t) => t.id),
    ).toEqual(["new", "old"])
    expect(
      queryClient.getQueryData<QmTenant[]>(otherScopeKey)?.map((t) => t.id),
    ).toEqual(["theirs"])
  })

  it("surfaces field errors from a 400 without toasting", async () => {
    const { wrapper } = createQueryWrapper()
    mockCreate.mockRejectedValue(
      new ApiError(400, "unknown_error", "Validation failed", {
        slug: "Slug is taken",
      }),
    )

    const { result } = renderHook(() => useCreateQmTenant(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(body).catch(() => {})
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = result.current.error as ApiError
    expect(err.status).toBe(400)
    expect(err.fields).toEqual({ slug: "Slug is taken" })
    expect(mockAddToast).not.toHaveBeenCalled()
  })

  it("toasts conflict errors (409) that carry no fields", async () => {
    const { wrapper } = createQueryWrapper()
    mockCreate.mockRejectedValue(
      new ApiError(409, "unknown_error", "Slug already in use"),
    )

    const { result } = renderHook(() => useCreateQmTenant(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(body).catch(() => {})
    })

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith("Slug already in use", "error")
    })
  })
})

describe("useDeleteQmTenant", () => {
  it("optimistically marks the tenant deprovisioning in every list and the detail", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    queryClient.setQueryData(listKey, [
      tenant({ id: "a" }),
      tenant({ id: "b" }),
    ])
    queryClient.setQueryData(detailKey("a"), detail(tenant({ id: "a" })))
    // Resolve slowly so we can observe the optimistic state.
    let resolveDelete: (t: QmTenant) => void = () => {}
    mockDelete.mockReturnValue(
      new Promise<QmTenant>((resolve) => {
        resolveDelete = resolve
      }),
    )

    const { result } = renderHook(() => useDeleteQmTenant(), { wrapper })
    act(() => {
      result.current.mutate("a")
    })

    await waitFor(() => {
      const list = queryClient.getQueryData<QmTenant[]>(listKey)
      expect(list?.find((t) => t.id === "a")?.status).toBe("deprovisioning")
      expect(list?.find((t) => t.id === "b")?.status).toBe("ready")
      expect(
        queryClient.getQueryData<QmTenantDetailResponse>(detailKey("a"))?.tenant
          .status,
      ).toBe("deprovisioning")
    })

    await act(async () => {
      resolveDelete(tenant({ id: "a", status: "deprovisioning" }))
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it("rolls back on failure and toasts the ApiError message", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    const before = [tenant({ id: "a" })]
    const beforeDetail = detail(tenant({ id: "a" }))
    queryClient.setQueryData(listKey, before)
    queryClient.setQueryData(detailKey("a"), beforeDetail)
    mockDelete.mockRejectedValue(
      new ApiError(409, "unknown_error", "Tenant is still provisioning"),
    )

    const { result } = renderHook(() => useDeleteQmTenant(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync("a").catch(() => {})
    })

    await waitFor(() => {
      expect(queryClient.getQueryData(listKey)).toEqual(before)
      expect(queryClient.getQueryData(detailKey("a"))).toEqual(beforeDetail)
    })
    expect(mockAddToast).toHaveBeenCalledWith(
      "Tenant is still provisioning",
      "error",
    )
  })
})

describe("useRetryQmTenant", () => {
  it("patches the cached tenant with the returned (provisioning) tenant", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    queryClient.setQueryData(listKey, [tenant({ id: "a", status: "failed" })])
    queryClient.setQueryData(
      detailKey("a"),
      detail(tenant({ id: "a", status: "failed" })),
    )
    mockRetry.mockResolvedValue(tenant({ id: "a", status: "provisioning" }))

    const { result } = renderHook(() => useRetryQmTenant(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync("a")
    })

    expect(mockRetry).toHaveBeenCalledWith("a")
    expect(queryClient.getQueryData<QmTenant[]>(listKey)?.[0].status).toBe(
      "provisioning",
    )
    expect(
      queryClient.getQueryData<QmTenantDetailResponse>(detailKey("a"))?.tenant
        .status,
    ).toBe("provisioning")
  })

  it("toasts on failure", async () => {
    const { wrapper } = createQueryWrapper()
    mockRetry.mockRejectedValue(new Error("boom"))

    const { result } = renderHook(() => useRetryQmTenant(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync("a").catch(() => {})
    })

    expect(mockAddToast).toHaveBeenCalledWith(expect.any(String), "error")
  })
})

describe("useQmAdminLink", () => {
  it("calls the fetcher on every invocation and never writes to the query cache", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    const link: QmAdminLink = {
      url: "https://acme.qm.example.com/auth?token=once",
      expiresAt: "2026-01-01T00:05:00.000Z",
    }
    mockAdminLink.mockResolvedValue(link)

    const { result } = renderHook(() => useQmAdminLink("t1"), { wrapper })

    let first: QmAdminLink | undefined
    let second: QmAdminLink | undefined
    await act(async () => {
      first = await result.current.mint()
    })
    await act(async () => {
      second = await result.current.mint()
    })

    expect(first).toEqual(link)
    expect(second).toEqual(link)
    expect(mockAdminLink).toHaveBeenCalledTimes(2)
    expect(mockAdminLink).toHaveBeenCalledWith("t1")
    expect(queryClient.getQueryData(qmKeys.adminLink("t1"))).toBeUndefined()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    expect(JSON.stringify(result.current)).not.toContain("token=once")
  })

  it("stays pending until every overlapping mint has settled", async () => {
    const { wrapper } = createQueryWrapper()
    let resolveFirst!: (link: QmAdminLink) => void
    let resolveSecond!: (link: QmAdminLink) => void
    mockAdminLink
      .mockImplementationOnce(
        () => new Promise<QmAdminLink>((r) => (resolveFirst = r)),
      )
      .mockImplementationOnce(
        () => new Promise<QmAdminLink>((r) => (resolveSecond = r)),
      )
    const link: QmAdminLink = {
      url: "https://acme.qm.example.com/auth?token=x",
      expiresAt: "2026-01-01T00:05:00.000Z",
    }

    const { result } = renderHook(() => useQmAdminLink("t1"), { wrapper })
    let first: Promise<QmAdminLink>
    let second: Promise<QmAdminLink>
    act(() => {
      first = result.current.mint()
      second = result.current.mint()
    })
    expect(result.current.isPending).toBe(true)
    await act(async () => {
      resolveFirst(link)
      await first
    })
    expect(result.current.isPending).toBe(true)
    await act(async () => {
      resolveSecond(link)
      await second
    })
    expect(result.current.isPending).toBe(false)
  })

  it("toasts on failure", async () => {
    const { wrapper } = createQueryWrapper()
    mockAdminLink.mockRejectedValue(
      new ApiError(409, "unknown_error", "Tenant is not ready"),
    )

    const { result } = renderHook(() => useQmAdminLink("t1"), { wrapper })
    await act(async () => {
      await result.current.mint().catch(() => {})
    })

    expect(mockAddToast).toHaveBeenCalledWith("Tenant is not ready", "error")
  })
})

describe("useQmSlugAvailability", () => {
  it("does not query for an empty slug", () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useQmSlugAvailability("  "), {
      wrapper,
    })
    expect(result.current.fetchStatus).toBe("idle")
    expect(mockCheckSlug).not.toHaveBeenCalled()
  })

  it("queries the trimmed slug once non-empty", async () => {
    const { wrapper } = createQueryWrapper()
    mockCheckSlug.mockResolvedValue({ available: false, reason: "taken" })

    const { result } = renderHook(() => useQmSlugAvailability(" acme "), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockCheckSlug).toHaveBeenCalledWith("acme")
    expect(result.current.data).toEqual({ available: false, reason: "taken" })
  })
})
