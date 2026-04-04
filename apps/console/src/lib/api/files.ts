export async function uploadFile(
  sandboxId: string,
  path: string,
  content: Blob | ArrayBuffer,
): Promise<{ path: string; size: number }> {
  const apiKey =
    typeof window !== "undefined"
      ? localStorage.getItem("superserve-api-key")
      : null
  const baseUrl = process.env.NEXT_PUBLIC_API_URL

  const response = await fetch(
    `${baseUrl}/v1/sandboxes/${sandboxId}/files/${path}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      body: content,
    },
  )

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? response.statusText)
  }

  return response.json()
}

export async function downloadFile(
  sandboxId: string,
  path: string,
): Promise<Blob> {
  const apiKey =
    typeof window !== "undefined"
      ? localStorage.getItem("superserve-api-key")
      : null
  const baseUrl = process.env.NEXT_PUBLIC_API_URL

  const response = await fetch(
    `${baseUrl}/v1/sandboxes/${sandboxId}/files/${path}`,
    {
      headers: {
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
    },
  )

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? response.statusText)
  }

  return response.blob()
}
