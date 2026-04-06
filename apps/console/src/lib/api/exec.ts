import { apiClient } from "./client"
import type { ExecRequest, ExecResult } from "./types"

export async function execCommand(
  sandboxId: string,
  data: ExecRequest,
): Promise<ExecResult> {
  return apiClient<ExecResult>(`/sandboxes/${sandboxId}/exec`, {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function execCommandStream(
  sandboxId: string,
  data: ExecRequest,
): { abort: () => void; response: Promise<Response> } {
  const apiKey =
    typeof window !== "undefined"
      ? localStorage.getItem("superserve-api-key")
      : null
  const controller = new AbortController()

  const response = fetch(`/api/sandboxes/${sandboxId}/exec/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    },
    body: JSON.stringify(data),
    signal: controller.signal,
  })

  return {
    response,
    abort: () => controller.abort(),
  }
}
