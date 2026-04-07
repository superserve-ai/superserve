export async function uploadFile(
  sandboxId: string,
  path: string,
  content: Blob | ArrayBuffer,
): Promise<{ path: string; size: number }> {
  const response = await fetch(
    `/api/sandboxes/${sandboxId}/files/${path}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
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
  const response = await fetch(
    `/api/sandboxes/${sandboxId}/files/${path}`,
  )

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? response.statusText)
  }

  return response.blob()
}
