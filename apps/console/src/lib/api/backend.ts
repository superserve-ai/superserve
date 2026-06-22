export const API_BACKEND_HEADER = "x-superserve-api-backend"
export const API_BACKEND_STORAGE_KEY = "superserve.apiBackendUrl"

export const API_BACKEND_PRESETS = [
  { label: "Production", url: "https://api.superserve.ai" },
  { label: "Staging", url: "https://api-staging.superserve.ai" },
  { label: "Local", url: "http://localhost:8080" },
] as const

export function normalizeApiBackendUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""

  const url = new URL(trimmed)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API backend URL must start with http:// or https://")
  }

  url.pathname = url.pathname.replace(/\/+$/, "")
  return url.toString().replace(/\/+$/, "")
}

export function loadApiBackendUrl(): string {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(API_BACKEND_STORAGE_KEY) ?? ""
}

export function saveApiBackendUrl(value: string): string {
  const normalized = normalizeApiBackendUrl(value)
  if (typeof window !== "undefined") {
    if (normalized) {
      window.localStorage.setItem(API_BACKEND_STORAGE_KEY, normalized)
    } else {
      window.localStorage.removeItem(API_BACKEND_STORAGE_KEY)
    }
  }
  return normalized
}
