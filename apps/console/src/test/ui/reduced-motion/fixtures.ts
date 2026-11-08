import type { SandboxListItem, SandboxResponse } from "../../../lib/api/types"

export type FixtureMode = "loaded" | "sections" | "all"

/** Read from the `fx` cookie so the API route handler sees the same value. */
export function fixtureMode(): FixtureMode {
  if (typeof document === "undefined") return "all"
  const m = document.cookie.match(/(?:^|; )fx=(loaded|sections|all)/)
  return (m?.[1] as FixtureMode | undefined) ?? "loaded"
}

export const SANDBOXES: SandboxResponse[] = [
  {
    id: "sbx-7f3a91c2",
    name: "agent-runner",
    status: "active",
    vcpu_count: 2,
    memory_mib: 2048,
    access_token: "fixture-token",
    timeout_seconds: 3600,
    network: {
      allow_out: ["api.openai.com", "github.com", "pypi.org"],
      deny_out: ["10.0.0.0/8"],
    },
    metadata: { team: "growth", env: "staging" },
    created_at: "2026-11-01T09:30:00Z",
  },
  {
    id: "sbx-2b8d40e7",
    name: "data-pipeline",
    status: "paused",
    vcpu_count: 4,
    memory_mib: 4096,
    access_token: "fixture-token",
    network: { allow_out: ["s3.amazonaws.com"], deny_out: [] },
    metadata: { team: "data" },
    created_at: "2026-10-28T14:05:00Z",
  },
  {
    id: "sbx-c19e5a63",
    name: "browser-eval",
    status: "active",
    vcpu_count: 1,
    memory_mib: 1024,
    access_token: "fixture-token",
    metadata: {},
    created_at: "2026-11-05T18:45:00Z",
  },
  {
    id: "sbx-9d04b7aa",
    name: "ci-smoke",
    status: "active",
    vcpu_count: 2,
    memory_mib: 2048,
    access_token: "fixture-token",
    metadata: { env: "ci" },
    created_at: "2026-11-06T11:10:00Z",
  },
  {
    id: "sbx-51e8c3f0",
    name: "notebook-dev",
    status: "paused",
    vcpu_count: 2,
    memory_mib: 4096,
    access_token: "fixture-token",
    metadata: {},
    created_at: "2026-11-03T08:00:00Z",
  },
]

export const SANDBOX_LIST: SandboxListItem[] = SANDBOXES
