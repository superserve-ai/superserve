"use client"

import { useToast } from "@superserve/ui"
import {
  type QueryClient,
  type QueryKey,
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

type ListSnapshots = [QueryKey, QmTenant[] | undefined][]
type DetailSnapshots = [QueryKey, QmTenantDetailResponse | undefined][]

// --- Cache helpers ---------------------------------------------------------
// Lists and details are keyed with a trailing query scope (self vs. an
// impersonated team), so mutations patch by prefix to hit every variant.

function snapshotLists(qc: QueryClient): ListSnapshots {
  return qc.getQueriesData<QmTenant[]>({ queryKey: qmKeys.lists() })
}

function snapshotDetail(qc: QueryClient, id: string): DetailSnapshots {
  return qc.getQueriesData<QmTenantDetailResponse>({
    queryKey: qmKeys.detail(id),
  })
}

function restore<T>(qc: QueryClient, snapshots: [QueryKey, T | undefined][]) {
  for (const [key, data] of snapshots) qc.setQueryData(key, data)
}

function patchTenant(
  qc: QueryClient,
  id: string,
  updater: (tenant: QmTenant) => QmTenant,
) {
  qc.setQueriesData<QmTenant[]>({ queryKey: qmKeys.lists() }, (old) =>
    old ? old.map((t) => (t.id === id ? updater(t) : t)) : old,
  )
  qc.setQueriesData<QmTenantDetailResponse>(
    { queryKey: qmKeys.detail(id) },
    (old) => (old ? { ...old, tenant: updater(old.tenant) } : old),
  )
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

export function useQmTenants() {
  const queryScope = useQueryScope()
  return useQuery({
    queryKey: [...qmKeys.list(), queryScope],
    queryFn: listQmTenants,
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
    queryKey: [...qmKeys.detail(id ?? ""), queryScope],
    queryFn: () => getQmTenant(id as string),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.tenant.status
      return status && TRANSITIONAL_STATUSES.has(status)
        ? TRANSITIONAL_POLL_MS
        : false
    },
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
    queryKey: [...qmKeys.slugAvailability(trimmed), queryScope],
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
      queryClient.setQueryData<QmTenant[]>(
        [...qmKeys.list(), queryScope],
        (old) =>
          old ? [tenant, ...old.filter((t) => t.id !== tenant.id)] : old,
      )
      queryClient.invalidateQueries({ queryKey: qmKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: qmKeys.slugAvailability(tenant.slug),
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
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => deleteQmTenant(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qmKeys.all })
      const lists = snapshotLists(queryClient)
      const details = snapshotDetail(queryClient, id)
      patchTenant(queryClient, id, (t) => ({ ...t, status: "deprovisioning" }))
      return { lists, details }
    },
    onSuccess: (tenant) => {
      patchTenant(queryClient, tenant.id, () => tenant)
    },
    onError: (error, _id, context) => {
      if (context) {
        restore(queryClient, context.lists)
        restore(queryClient, context.details)
      }
      addToast(
        errorMessage(error, "Failed to delete QM instance. Try again."),
        "error",
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qmKeys.all })
    },
  })
}

export function useRetryQmTenant() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => retryQmTenant(id),
    onSuccess: (tenant) => {
      patchTenant(queryClient, tenant.id, () => tenant)
    },
    onError: (error) => {
      addToast(
        errorMessage(error, "Failed to retry provisioning. Try again."),
        "error",
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qmKeys.all })
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
