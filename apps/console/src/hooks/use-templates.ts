"use client"

import { useToast } from "@superserve/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError } from "@/lib/api/client"
import { templateKeys } from "@/lib/api/query-keys"
import {
  cancelTemplateBuild,
  createTemplate,
  createTemplateBuild,
  deleteTemplate,
  getTemplate,
  getTemplateBuild,
  listTemplateBuilds,
  listTemplates,
} from "@/lib/api/templates"
import type { CreateTemplateRequest, TemplateResponse } from "@/lib/api/types"

const TERMINAL_TEMPLATE_STATUSES = new Set(["ready", "failed"])
const TERMINAL_BUILD_STATUSES = new Set(["ready", "failed", "cancelled"])

export function useTemplates(aliasPrefix?: string) {
  return useQuery({
    queryKey: templateKeys.list({ alias_prefix: aliasPrefix }),
    queryFn: () =>
      listTemplates(aliasPrefix ? { alias_prefix: aliasPrefix } : undefined),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  })
}

export function useTemplate(id: string | null) {
  return useQuery({
    queryKey: templateKeys.detail(id ?? ""),
    queryFn: () => getTemplate(id as string),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status) return false
      return TERMINAL_TEMPLATE_STATUSES.has(status) ? false : 5_000
    },
    refetchOnWindowFocus: true,
  })
}

export function useTemplateBuilds(templateId: string | null) {
  return useQuery({
    queryKey: templateKeys.builds(templateId ?? ""),
    queryFn: () => listTemplateBuilds(templateId as string, { limit: 20 }),
    enabled: !!templateId,
    refetchInterval: (query) => {
      const latest = query.state.data?.[0]
      if (!latest) return 5_000
      return TERMINAL_BUILD_STATUSES.has(latest.status) ? false : 5_000
    },
  })
}

export function useTemplateBuild(
  templateId: string | null,
  buildId: string | null,
) {
  return useQuery({
    queryKey: templateKeys.build(templateId ?? "", buildId ?? ""),
    queryFn: () => getTemplateBuild(templateId as string, buildId as string),
    enabled: !!templateId && !!buildId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status) return false
      return TERMINAL_BUILD_STATUSES.has(status) ? false : 3_000
    },
  })
}

export function useCreateTemplate() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (data: CreateTemplateRequest) => createTemplate(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
      addToast(`Template "${created.alias}" created — build queued`, "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to create template. Check your plan limits or try again."
      addToast(message, "error")
    },
  })
}

export function useRebuildTemplate() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (templateId: string) => createTemplateBuild(templateId),
    onSuccess: (_build, templateId) => {
      queryClient.invalidateQueries({
        queryKey: templateKeys.detail(templateId),
      })
      queryClient.invalidateQueries({
        queryKey: templateKeys.builds(templateId),
      })
      addToast("Rebuild queued", "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : "Failed to rebuild template."
      addToast(message, "error")
    },
  })
}

export function useCancelTemplateBuild(templateId: string) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (buildId: string) => cancelTemplateBuild(templateId, buildId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: templateKeys.detail(templateId),
      })
      queryClient.invalidateQueries({
        queryKey: templateKeys.builds(templateId),
      })
      addToast("Build cancelled", "success")
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Failed to cancel build."
      addToast(message, "error")
    },
  })
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  return useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.lists() })
      const snapshots = queryClient.getQueriesData<TemplateResponse[]>({
        queryKey: templateKeys.lists(),
      })
      for (const [key, data] of snapshots) {
        if (!data) continue
        queryClient.setQueryData<TemplateResponse[]>(
          key,
          data.filter((t) => t.id !== id),
        )
      }
      return { snapshots }
    },
    onError: (error, _id, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data)
      }
      const message =
        error instanceof ApiError ? error.message : "Failed to delete template."
      addToast(message, "error")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
  })
}
