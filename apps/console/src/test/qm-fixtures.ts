import type {
  QmTenant,
  QmTenantDetailResponse,
  QmTenantEvent,
} from "@/lib/api/types"

export const qmTenant = (overrides: Partial<QmTenant> = {}): QmTenant => ({
  id: "t1",
  teamId: "team-a",
  slug: "acme",
  orgName: "Acme",
  adminEmail: "admin@example.com",
  signIn: "magic_link",
  modelProvider: "anthropic",
  harness: "pi",
  status: "ready",
  publicUrl: "https://acme.qm.superserve.ai",
  imageTag: "v0.4.2",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:05:00.000Z",
  ...overrides,
})

let seq = 0
export const qmEvent = (
  step: string,
  status: QmTenantEvent["status"],
  at: string,
  message: string | null = null,
): QmTenantEvent => ({
  id: `e${++seq}`,
  step,
  status,
  message,
  detail: null,
  at,
})

/** Seconds after the fixture epoch, as an ISO timestamp. */
export const T = (s: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString()

/** All six steps succeeded. */
export const successEvents = (): QmTenantEvent[] => [
  qmEvent("validate_model_key", "started", T(0)),
  qmEvent("validate_model_key", "ok", T(1)),
  qmEvent("reserve_slug", "started", T(1)),
  qmEvent("reserve_slug", "ok", T(2)),
  qmEvent("create_database", "started", T(2)),
  qmEvent("create_database", "ok", T(20)),
  qmEvent("deploy", "started", T(20)),
  qmEvent("deploy", "ok", T(80)),
  qmEvent("configure_dns", "started", T(80)),
  qmEvent("configure_dns", "ok", T(95)),
  qmEvent("health_check", "started", T(95)),
  qmEvent("health_check", "ok", T(100)),
]

/** Steps 1–3 succeeded, step 4 (deploy) failed. */
export const failedAtDeployEvents = (): QmTenantEvent[] => [
  qmEvent("validate_model_key", "started", T(0)),
  qmEvent("validate_model_key", "ok", T(1)),
  qmEvent("reserve_slug", "started", T(1)),
  qmEvent("reserve_slug", "ok", T(2)),
  qmEvent("create_database", "started", T(2)),
  qmEvent("create_database", "ok", T(20)),
  qmEvent("deploy", "started", T(20)),
  qmEvent("deploy", "failed", T(50), "Image pull timed out after 30s"),
]

/** Still running: three done, deploy in progress. */
export const inProgressEvents = (): QmTenantEvent[] =>
  failedAtDeployEvents().slice(0, -1)

export const qmDetail = (
  tenant: QmTenant,
  events: QmTenantEvent[] = [],
): QmTenantDetailResponse => ({ tenant, events })
