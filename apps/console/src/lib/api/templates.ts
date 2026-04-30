import { apiClient } from "./client"
import type {
  CreateTemplateRequest,
  CreateTemplateResponse,
  TemplateBuildResponse,
  TemplateResponse,
} from "./types"

export async function listTemplates(params?: {
  name_prefix?: string
}): Promise<TemplateResponse[]> {
  const query = new URLSearchParams()
  if (params?.name_prefix) query.set("name_prefix", params.name_prefix)
  const suffix = query.toString()
  return apiClient<TemplateResponse[]>(
    `/templates${suffix ? `?${suffix}` : ""}`,
  )
}

export async function getTemplate(id: string): Promise<TemplateResponse> {
  return apiClient<TemplateResponse>(`/templates/${id}`)
}

export async function createTemplate(
  data: CreateTemplateRequest,
): Promise<CreateTemplateResponse> {
  return apiClient<CreateTemplateResponse>("/templates", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function deleteTemplate(id: string): Promise<void> {
  return apiClient<void>(`/templates/${id}`, { method: "DELETE" })
}

export async function listTemplateBuilds(
  templateId: string,
  params?: { limit?: number },
): Promise<TemplateBuildResponse[]> {
  const query = new URLSearchParams()
  if (params?.limit) query.set("limit", String(params.limit))
  const suffix = query.toString()
  return apiClient<TemplateBuildResponse[]>(
    `/templates/${templateId}/builds${suffix ? `?${suffix}` : ""}`,
  )
}

export async function createTemplateBuild(
  templateId: string,
): Promise<TemplateBuildResponse> {
  return apiClient<TemplateBuildResponse>(`/templates/${templateId}/builds`, {
    method: "POST",
  })
}

export async function getTemplateBuild(
  templateId: string,
  buildId: string,
): Promise<TemplateBuildResponse> {
  return apiClient<TemplateBuildResponse>(
    `/templates/${templateId}/builds/${buildId}`,
  )
}

export async function cancelTemplateBuild(
  templateId: string,
  buildId: string,
): Promise<void> {
  return apiClient<void>(`/templates/${templateId}/builds/${buildId}`, {
    method: "DELETE",
  })
}
