import type { SandboxResponse } from "../../../lib/api/types"

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
      deny_out: ["10.0.0.0/8", "192.168.0.0/16"],
    },
    metadata: { team: "growth", env: "staging", owner: "ada" },
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
]
