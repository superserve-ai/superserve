import type { BadgeVariant } from "@superserve/ui"

import type {
  QmHarness,
  QmModelProvider,
  QmSignIn,
  QmTenantStatus,
} from "@/lib/api/types"

// --- Model providers -------------------------------------------------------

export const PROVIDER_OPTIONS: ReadonlyArray<{
  value: QmModelProvider
  label: string
  keyPlaceholder: string
}> = [
  { value: "anthropic", label: "Anthropic", keyPlaceholder: "sk-ant-…" },
  { value: "openai", label: "OpenAI", keyPlaceholder: "sk-…" },
  { value: "openrouter", label: "OpenRouter", keyPlaceholder: "sk-or-…" },
]

export const PROVIDER_LABEL: Record<QmModelProvider, string> =
  Object.fromEntries(PROVIDER_OPTIONS.map((o) => [o.value, o.label])) as Record<
    QmModelProvider,
    string
  >

// --- Harnesses -------------------------------------------------------------

/**
 * `pi` is the default for every provider — it is the harness QM ships with
 * and the only one exercised against all three providers. `claude` and
 * `codex` are the vendor CLIs, so they are only offered for their own
 * provider; `opencode` is provider-agnostic.
 */
export const DEFAULT_HARNESS: QmHarness = "pi"

export const HARNESS_OPTIONS: ReadonlyArray<{
  value: QmHarness
  label: string
  description: string
  providers: ReadonlyArray<QmModelProvider> | "any"
}> = [
  {
    value: "pi",
    label: "pi",
    description: "QM's built-in harness. Works with every provider.",
    providers: "any",
  },
  {
    value: "claude",
    label: "Claude Agent SDK",
    description: "Anthropic only.",
    providers: ["anthropic"],
  },
  {
    value: "codex",
    label: "Codex",
    description: "OpenAI only.",
    providers: ["openai"],
  },
  {
    value: "opencode",
    label: "OpenCode",
    description: "Works with every provider.",
    providers: "any",
  },
]

export const HARNESS_LABEL: Record<QmHarness, string> = Object.fromEntries(
  HARNESS_OPTIONS.map((o) => [o.value, o.label]),
) as Record<QmHarness, string>

export function harnessAllowed(
  harness: QmHarness,
  provider: QmModelProvider,
): boolean {
  const option = HARNESS_OPTIONS.find((o) => o.value === harness)
  if (!option) return false
  return option.providers === "any" || option.providers.includes(provider)
}

// --- Sign-in ---------------------------------------------------------------

export const SIGN_IN_OPTIONS: ReadonlyArray<{
  value: QmSignIn
  label: string
  description: string
}> = [
  {
    value: "magic_link",
    label: "Magic link",
    description: "We send the sign-in email; nothing to configure.",
  },
  {
    value: "slack",
    label: "Slack SSO",
    description: "You'll install a Slack app after the stack is up.",
  },
]

export const SIGN_IN_LABEL: Record<QmSignIn, string> = Object.fromEntries(
  SIGN_IN_OPTIONS.map((o) => [o.value, o.label]),
) as Record<QmSignIn, string>

// --- Status ----------------------------------------------------------------

export const QM_STATUS_LABEL: Record<QmTenantStatus, string> = {
  provisioning: "Provisioning",
  ready: "Ready",
  failed: "Failed",
  deprovisioning: "Deleting",
  deleted: "Deleted",
}

/** Mint for live states, amber for transitions, red for failures. */
export const QM_STATUS_BADGE_VARIANT: Record<QmTenantStatus, BadgeVariant> = {
  provisioning: "warning",
  ready: "active",
  failed: "destructive",
  deprovisioning: "warning",
  deleted: "muted",
}
