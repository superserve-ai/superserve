export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

function getBaseUrl(): string {
  return "/api"
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${getBaseUrl()}${path}`

  const headers = new Headers(options.headers)
  if (
    !headers.has("Content-Type") &&
    options.body &&
    typeof options.body === "string"
  ) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (!response.ok) {
    let code = "unknown_error"
    let message = response.statusText

    try {
      const body = await response.json()
      if (body?.error?.code) code = body.error.code
      if (body?.error?.message) message = body.error.message
    } catch {
      // response body is not JSON, use defaults
    }

    throw new ApiError(response.status, code, message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}
