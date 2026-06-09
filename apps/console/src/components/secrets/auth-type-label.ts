import type { SecretAuthType } from "@/lib/api/types"

export const AUTH_TYPE_LABEL: Record<SecretAuthType, string> = {
  bearer: "Bearer",
  basic: "Basic",
  "api-key": "API key",
  custom: "Custom",
  per_host: "Per-host",
}
