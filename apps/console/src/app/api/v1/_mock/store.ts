import type { SandboxResponse } from "@/lib/api/types"

const now = new Date()

function hoursAgo(h: number): string {
  return new Date(now.getTime() - h * 60 * 60 * 1000).toISOString()
}

function daysAgo(d: number): string {
  return new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString()
}

export const sandboxes: SandboxResponse[] = [
  {
    id: "a1b2c3d4-1111-4000-8000-000000000001",
    name: "dev-agent-sandbox",
    status: "active",
    vcpu_count: 1,
    memory_mib: 1024,
    ip_address: "10.0.1.12",
    created_at: daysAgo(3),
  },
  {
    id: "a1b2c3d4-2222-4000-8000-000000000002",
    name: "staging-sandbox",
    status: "idle",
    vcpu_count: 2,
    memory_mib: 2048,
    snapshot_id: "snap-0001-0001-0001-000000000001",
    created_at: daysAgo(7),
  },
  {
    id: "a1b2c3d4-3333-4000-8000-000000000003",
    name: "test-runner",
    status: "active",
    vcpu_count: 1,
    memory_mib: 1024,
    ip_address: "10.0.1.15",
    created_at: daysAgo(1),
  },
  {
    id: "a1b2c3d4-4444-4000-8000-000000000004",
    name: "ci-build-env",
    status: "idle",
    vcpu_count: 4,
    memory_mib: 4096,
    snapshot_id: "snap-0002-0002-0002-000000000002",
    created_at: daysAgo(14),
  },
  {
    id: "a1b2c3d4-5555-4000-8000-000000000005",
    name: "demo-sandbox",
    status: "starting",
    vcpu_count: 1,
    memory_mib: 1024,
    created_at: hoursAgo(0.1),
  },
]

export interface ApiKeyEntry {
  id: string
  name: string
  prefix: string
  full_key: string
  created_at: string
  last_used_at: string | null
}

export const apiKeys: ApiKeyEntry[] = [
  {
    id: "key-0001",
    name: "Production",
    prefix: "ss_live_a1b2c3d4...",
    full_key: "ss_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4",
    created_at: daysAgo(30),
    last_used_at: hoursAgo(2),
  },
  {
    id: "key-0002",
    name: "Development",
    prefix: "ss_live_q7r8s9t0...",
    full_key: "ss_live_q7r8s9t0u1v2w3x4y5z6a7b8c9d0",
    created_at: daysAgo(14),
    last_used_at: daysAgo(1),
  },
  {
    id: "key-0003",
    name: "CI/CD Pipeline",
    prefix: "ss_live_g3h4i5j6...",
    full_key: "ss_live_g3h4i5j6k7l8m9n0o1p2q3r4s5t6",
    created_at: daysAgo(7),
    last_used_at: null,
  },
]

export interface AuditLogEntry {
  id: string
  time: string
  user: string
  action: string
  target: string
  outcome: "Success" | "Failure"
}

export const auditLogs: AuditLogEntry[] = [
  {
    id: "log-001",
    time: hoursAgo(1),
    user: "user@example.com",
    action: "Create",
    target: "sandbox / dev-agent-sandbox",
    outcome: "Success",
  },
  {
    id: "log-002",
    time: hoursAgo(2),
    user: "user@example.com",
    action: "Start",
    target: "sandbox / test-runner",
    outcome: "Success",
  },
  {
    id: "log-003",
    time: hoursAgo(5),
    user: "user@example.com",
    action: "Update",
    target: "api_key / Production",
    outcome: "Success",
  },
  {
    id: "log-004",
    time: daysAgo(1),
    user: "user@example.com",
    action: "Create",
    target: "api_key / Development",
    outcome: "Success",
  },
  {
    id: "log-005",
    time: daysAgo(3),
    user: "user@example.com",
    action: "Pause",
    target: "sandbox / staging-sandbox",
    outcome: "Success",
  },
  {
    id: "log-006",
    time: daysAgo(5),
    user: "user@example.com",
    action: "Start",
    target: "sandbox / ci-build-env",
    outcome: "Failure",
  },
  {
    id: "log-007",
    time: daysAgo(7),
    user: "user@example.com",
    action: "Create",
    target: "sandbox / ci-build-env",
    outcome: "Success",
  },
  {
    id: "log-008",
    time: daysAgo(10),
    user: "user@example.com",
    action: "Create",
    target: "api_key / CI/CD Pipeline",
    outcome: "Success",
  },
]

export interface SnapshotEntry {
  id: string
  name: string
  created_at: string
  last_used_at: string | null
}

export const snapshots: SnapshotEntry[] = [
  {
    id: "snap-0001-0001-0001-000000000001",
    name: "staging-sandbox-snapshot",
    created_at: daysAgo(5),
    last_used_at: daysAgo(2),
  },
  {
    id: "snap-0002-0002-0002-000000000002",
    name: "ci-build-env-snapshot",
    created_at: daysAgo(10),
    last_used_at: null,
  },
  {
    id: "snap-0003-0003-0003-000000000003",
    name: "demo-checkpoint",
    created_at: daysAgo(1),
    last_used_at: null,
  },
]
