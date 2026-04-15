/**
 * use-api-keys hook tests — create, revoke, bulk revoke.
 */

import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/client"
import { apiKeyKeys } from "@/lib/api/query-keys"
import type { ApiKeyResponse, CreateApiKeyResponse } from "@/lib/api/types"
import { createQueryWrapper } from "@/test/react-query"

const mockCreateApiKey = vi.fn()
const mockRevokeApiKey = vi.fn()

vi.mock("@/lib/api/api-keys", () => ({
  createApiKey: (...a: unknown[]) => mockCreateApiKey(...a),
  revokeApiKey: (...a: unknown[]) => mockRevokeApiKey(...a),
  listApiKeys: vi.fn(),
}))

const mockAddToast = vi.fn()
vi.mock("@superserve/ui", () => ({
  useToast: () => ({ addToast: mockAddToast }),
}))

import {
  useBulkRevokeApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "./use-api-keys"

const apiKey = (overrides: Partial<ApiKeyResponse> = {}): ApiKeyResponse => ({
  id: "k1",
  name: "dev",
  prefix: "ss_live_abc",
  created_at: "2026-01-01T00:00:00.000Z",
  last_used_at: null,
  ...overrides,
})

describe("useCreateApiKey", () => {
  beforeEach(() => {
    mockCreateApiKey.mockReset()
    mockAddToast.mockReset()
  })

  it("prepends the created key to the cached list (as a list entry shape)", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    queryClient.setQueryData(apiKeyKeys.all, [apiKey({ id: "old" })])
    const created: CreateApiKeyResponse = {
      id: "new",
      name: "prod-key",
      key: "ss_live_full_secret",
      prefix: "ss_live_pro",
      created_at: "2026-04-15T00:00:00.000Z",
    }
    mockCreateApiKey.mockResolvedValue(created)

    const { result } = renderHook(() => useCreateApiKey(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync("prod-key")
    })

    const list = queryClient.getQueryData<ApiKeyResponse[]>(apiKeyKeys.all)
    expect(list).toHaveLength(2)
    expect(list?.[0]).toMatchObject({
      id: "new",
      name: "prod-key",
      prefix: "ss_live_pro",
      last_used_at: null,
    })
    // The full secret key should not leak into the cached list entry
    expect(list?.[0] as unknown as { key?: string }).not.toHaveProperty("key")
  })

  it("toasts ApiError message on failure", async () => {
    const { wrapper } = createQueryWrapper()
    mockCreateApiKey.mockRejectedValue(
      new ApiError(402, "plan_limit", "Plan limit reached"),
    )

    const { result } = renderHook(() => useCreateApiKey(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync("x").catch(() => {})
    })

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith("Plan limit reached", "error")
    })
  })
})

describe("useRevokeApiKey", () => {
  beforeEach(() => {
    mockRevokeApiKey.mockReset()
    mockAddToast.mockReset()
  })

  it("optimistically removes the key from the cached list", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    queryClient.setQueryData(apiKeyKeys.all, [
      apiKey({ id: "a" }),
      apiKey({ id: "b" }),
    ])
    mockRevokeApiKey.mockResolvedValue(undefined)

    const { result } = renderHook(() => useRevokeApiKey(), { wrapper })
    act(() => {
      result.current.mutate("a")
    })

    await waitFor(() => {
      const list = queryClient.getQueryData<ApiKeyResponse[]>(apiKeyKeys.all)
      expect(list?.map((k) => k.id)).toEqual(["b"])
    })
  })

  it("rolls back on failure and shows an error toast", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    const before = [apiKey({ id: "a" }), apiKey({ id: "b" })]
    queryClient.setQueryData(apiKeyKeys.all, before)
    mockRevokeApiKey.mockRejectedValue(new Error("boom"))

    const { result } = renderHook(() => useRevokeApiKey(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync("a").catch(() => {})
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryData<ApiKeyResponse[]>(apiKeyKeys.all),
      ).toEqual(before)
    })
    expect(mockAddToast).toHaveBeenCalledWith(expect.any(String), "error")
  })
})

describe("useBulkRevokeApiKeys", () => {
  beforeEach(() => {
    mockRevokeApiKey.mockReset()
  })

  it("revokes all selected keys and removes them from the cache", async () => {
    const { queryClient, wrapper } = createQueryWrapper()
    queryClient.setQueryData(apiKeyKeys.all, [
      apiKey({ id: "a" }),
      apiKey({ id: "b" }),
      apiKey({ id: "c" }),
    ])
    mockRevokeApiKey.mockResolvedValue(undefined)

    const { result } = renderHook(() => useBulkRevokeApiKeys(), {
      wrapper,
    })
    await act(async () => {
      await result.current.mutateAsync(["a", "c"])
    })

    expect(mockRevokeApiKey).toHaveBeenCalledTimes(2)
    const list = queryClient.getQueryData<ApiKeyResponse[]>(apiKeyKeys.all)
    expect(list?.map((k) => k.id)).toEqual(["b"])
  })
})

afterEach(() => {
  vi.clearAllMocks()
})
