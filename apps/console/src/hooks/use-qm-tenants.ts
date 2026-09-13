"use client"

import { useToast } from "@superserve/ui"
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback, useState } from "react"

import { useQueryScope } from "@/components/query-provider"
import { ApiError } from "@/lib/api/client"
import {
  checkQmSlug,
  createQmTenant,
  deleteQmTenant,
  getQmAdminLink,
  getQmTenant,
  listQmTenants,
  retryQmTenant,
} from "@/lib/api/qm"
import { qmKeys } from "@/lib/api/query-keys"
import type {
  CreateQmTenantRequest,
  QmAdminLink,
  QmTenant,
  QmTenantDetailResponse,
  QmTenantStatus,
} from "@/lib/api/types"

/** Tenants in these states change on their own; poll until they settle. */
const TRANSITIONAL_STATUSES: ReadonlySet<QmTenantStatus> = new Set([
  "provisioning",
  "deprovisioning",
])
const TRANSITIONAL_POLL_MS = 2000

/** Statuses a tenant read never recovers from, so retrying only adds delay. */
const NON_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([401, 404, 409])

interface TenantSnapshot {
  list: QmTenant[] | undefined
  detail: QmTenantDetailResponse | undefined
}

// --- Cache helpers ---------------------------------------------------------
// Lists and details are keyed by query scope (self vs. an impersonated team).
// Every helper below takes the scope the mutation was issued in and touches
// only that scope's two exact keys: a write in one scope says nothing about
// what another scope's cache holds, so patching or invalidating by a bare
// `qm` prefix would discard data the mutation never affected.

function snapshotTenant(
  qc: QueryClient,
  id: string,
  scope: string,
): TenantSnapshot {
  return {
    list: qc.getQueryData<QmTenant[]>(qmKeys.list(scope)),
    detail: qc.getQueryData<QmTenantDetailResponse>(qmKeys.detail(id, scope)),
  }
}

// React Query ignores an `undefined` value, so a key that held nothing before
// the mutation is left alone rather than resurrected — which matches
// `patchTenant`, whose updaters also decline to create entries.
function restoreTenant(
  qc: QueryClient,
  id: string,
  scope: string,
  snapshot: TenantSnapshot,
) {
  qc.setQueryData(qmKeys.list(scope), snapshot.list)
  qc.setQueryData(qmKeys.detail(id, scope), snapshot.detail)
}

function patchTenant(
  qc: QueryClient,
  id: string,
  scope: string,
  updater: (tenant: QmTenant) => QmTenant,
) {
  qc.setQueryData<QmTenant[]>(qmKeys.list(scope), (old) =>
    old ? old.map((t) => (t.id === id ? updater(t) : t)) : old,
  )
  qc.setQueryData<QmTenantDetailResponse>(qmKeys.detail(id, scope), (old) =>
    old ? { ...old, tenant: updater(old.tenant) } : old,
  )
}

function invalidateTenant(qc: QueryClient, id: string, scope: string) {
  qc.invalidateQueries({ queryKey: qmKeys.list(scope), exact: true })
  qc.invalidateQueries({ queryKey: qmKeys.detail(id, scope), exact: true })
}

function hasFieldErrors(
  error: unknown,
): error is ApiError & { fields: Record<string, string> } {
  return (
    error instanceof ApiError &&
    error.status === 400 &&
    !!error.fields &&
    Object.keys(error.fields).length > 0
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

// --- Queries ---------------------------------------------------------------

export function useQmTenants(
  options: { enabled?: boolean; refetchOnMount?: boolean | "always" } = {},
) {
  const queryScope = useQueryScope()
  return useQuery({
    queryKey: qmKeys.list(queryScope),
    queryFn: listQmTenants,
    enabled: options.enabled ?? true,
    // "always" for surfaces that must not trust a cached list (e.g. before
    // offering to create a stack, which qm-api allows once per team).
    ...(options.refetchOnMount !== undefined && {
      refetchOnMount: options.refetchOnMount,
    }),
    // Lists change while any tenant is provisioning/deprovisioning.
    refetchInterval: (query) =>
      query.state.data?.some((t) => TRANSITIONAL_STATUSES.has(t.status))
        ? TRANSITIONAL_POLL_MS
        : false,
    refetchIntervalInBackground: false,
  })
}

export function useQmTenant(id: string | null) {
  const queryScope = useQueryScope()
  return useQuery({
    queryKey: qmKeys.detail(id ?? "", queryScope),
    queryFn: () => getQmTenant(id as string),
    enabled: !!id,
    refetchInterval: (query) => {
      // Deprovisioning ends in `deleted`, and a deleted tenant is 404 rather
      // than a terminal status. React Query keeps the last successful
      // (transitional) data alongside the error, so poll on data alone would
      // never stop; the error state is what says the tenant is gone.
      if (query.state.status === "error") return false
      const status = query.state.data?.tenant.status
      return status && TRANSITIONAL_STATUSES.has(status)
        ? TRANSITIONAL_POLL_MS
        : false
    },
    // The shared default already gives up on 401 and 409; 404 is equally
    // final here, since a tenant only stops existing by being deleted.
    retry: (failureCount, error) =>
      error instanceof ApiError && NON_RETRYABLE_STATUSES.has(error.status)
        ? false
        : failureCount < 3,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

/**
 * Slug availability for the create form. Only queries when `slug` is
 * non-empty; debouncing the input is the caller's responsibility.
 */
export function useQmSlugAvailability(slug: string) {
  const queryScope = useQueryScope()
  const trimmed = slug.trim()
  return useQuery({
    queryKey: qmKeys.slugAvailability(trimmed, queryScope),
    queryFn: () => checkQmSlug(trimmed),
    enabled: trimmed.length > 0,
    staleTime: 10_000,
    retry: false,
  })
}

// --- Mutations -------------------------------------------------------------

type CreateQmTenantVariables = Omit<CreateQmTenantRequest, "modelKey">

// Each create call gets its own variables object, and the provider key is
// held against that object alone, so it never enters the mutation's stored
// state and concurrent creates cannot swap keys.
const modelKeys = new WeakMap<CreateQmTenantVariables, string>()

export function useCreateQmTenant() {
  const queryClient = useQueryClient()
  const queryScope = useQueryScope()
  const { addToast } = useToast()

  const mutation = useMutation({
    mutationFn: (data: CreateQmTenantVariables) => {
      const modelKey = modelKeys.get(data)
      modelKeys.delete(data)
      if (!modelKey) return Promise.reject(new Error("Model key is required."))
      return createQmTenant({ ...data, modelKey })
    },
    onSuccess: (tenant) => {
      queryClient.setQueryData<QmTenant[]>(qmKeys.list(queryScope), (old) =>
        old ? [tenant, ...old.filter((t) => t.id !== tenant.id)] : old,
      )
      queryClient.invalidateQueries({
        queryKey: qmKeys.list(queryScope),
        exact: true,
      })
      // Deliberately broad: qm-api answers slug availability across every
      // team, so a slug claimed here makes the cached answer wrong in every
      // scope, not just the active one.
      queryClient.invalidateQueries({
        queryKey: qmKeys.slugAvailabilities(tenant.slug),
      })
    },
    onError: (error) => {
      // Field-level 400s are rendered inline by the form; only toast the rest.
      if (hasFieldErrors(error)) return
      addToast(
        errorMessage(error, "Failed to create QM instance. Try again."),
        "error",
      )
    },
  })

  const { mutate, mutateAsync } = mutation
  const create = useCallback(
    (
      { modelKey, ...data }: CreateQmTenantRequest,
      options?: Parameters<typeof mutate>[1],
    ) => {
      const variables: CreateQmTenantVariables = { ...data }
      modelKeys.set(variables, modelKey)
      mutate(variables, options)
    },
    [mutate],
  )
  const createAsync = useCallback(
    ({ modelKey, ...data }: CreateQmTenantRequest) => {
      const variables: CreateQmTenantVariables = { ...data }
      modelKeys.set(variables, modelKey)
      return mutateAsync(variables)
    },
    [mutateAsync],
  )

  return { ...mutation, mutate: create, mutateAsync: createAsync }
}

export function useDeleteQmTenant() {
  const queryClient = useQueryClient()
  const queryScope = useQueryScope()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => deleteQmTenant(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({
        queryKey: qmKeys.list(queryScope),
        exact: true,
      })
      await queryClient.cancelQueries({
        queryKey: qmKeys.detail(id, queryScope),
        exact: true,
      })
      const snapshot = snapshotTenant(queryClient, id, queryScope)
      patchTenant(queryClient, id, queryScope, (t) => ({
        ...t,
        status: "deprovisioning",
      }))
      return snapshot
    },
    onSuccess: (tenant) => {
      patchTenant(queryClient, tenant.id, queryScope, () => tenant)
    },
    onError: (error, id, snapshot) => {
      if (snapshot) restoreTenant(queryClient, id, queryScope, snapshot)
      addToast(
        errorMessage(error, "Failed to delete QM instance. Try again."),
        "error",
      )
    },
    onSettled: (_tenant, _error, id) => {
      invalidateTenant(queryClient, id, queryScope)
    },
  })
}

export function useRetryQmTenant() {
  const queryClient = useQueryClient()
  const queryScope = useQueryScope()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => retryQmTenant(id),
    onSuccess: (tenant) => {
      patchTenant(queryClient, tenant.id, queryScope, () => tenant)
    },
    onError: (error) => {
      addToast(
        errorMessage(error, "Failed to retry provisioning. Try again."),
        "error",
      )
    },
    onSettled: (_tenant, _error, id) => {
      invalidateTenant(queryClient, id, queryScope)
    },
  })
}

/**
 * Mints a single-use admin sign-in link. Deliberately not a React Query
 * mutation: the URL is a credential and must live only in the caller's
 * component state, never in any cache.
 */
export function useQmAdminLink(id: string) {
  const { addToast } = useToast()
  const [inFlight, setInFlight] = useState(0)

  const mint = useCallback(async (): Promise<QmAdminLink> => {
    setInFlight((n) => n + 1)
    try {
      return await getQmAdminLink(id)
    } catch (error) {
      addToast(
        errorMessage(error, "Failed to generate admin link. Try again."),
        "error",
      )
      throw error
    } finally {
      setInFlight((n) => n - 1)
    }
  }, [addToast, id])

  return { mint, isPending: inFlight > 0 }
}
