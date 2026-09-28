/**
 * Snapshot class — a saved copy of a sandbox's memory and disk.
 *
 * A snapshot is taken on request and kept until deleted, whatever becomes of
 * the sandbox it came from. A sandbox created from it continues with the
 * processes that were running, on the same template and in the same region.
 *
 * ```typescript
 * import { Sandbox } from "@superserve/sdk"
 *
 * const snapshot = await sandbox.snapshot({ name: "before-upgrade" })
 * const fork = await Sandbox.create({ name: "fork", fromSnapshot: snapshot })
 * ```
 */

import { type ResolvedConfig, resolveConfig } from "./config.js"
import { NotFoundError, SandboxError, TimeoutError } from "./errors.js"
import { composeSignals, request, requestVoid, sleep } from "./http.js"
import type {
  ApiSnapshotResponse,
  ConnectionOptions,
  SnapshotInfo,
  SnapshotKind,
  SnapshotListOptions,
  SnapshotResources,
  SnapshotStatus,
  SnapshotWaitOptions,
} from "./types.js"
import { toSnapshotInfo } from "./types.js"

/** How long waiting for a snapshot to settle takes at most, by default. */
export const DEFAULT_SNAPSHOT_TIMEOUT_MS = 15 * 60_000
const DEFAULT_SNAPSHOT_POLL_MS = 2_000

export class Snapshot {
  readonly id: string
  /** The sandbox the snapshot was taken from. It may since have been deleted. */
  readonly sandboxId: string
  /** The template the captured sandbox was created from. */
  readonly templateId?: string
  readonly kind: SnapshotKind
  /** Status when this instance was fetched. Call getInfo() for the current one. */
  readonly status: SnapshotStatus
  readonly name?: string
  /** Bytes the snapshot holds on disk; 0 until ready. */
  readonly sizeBytes: number
  /** vCPU, memory and disk a sandbox created from it gets. */
  readonly resources: SnapshotResources
  readonly createdAt: Date
  readonly readyAt?: Date

  private readonly _config: ResolvedConfig

  /** @internal — use `sandbox.snapshot()` or `Snapshot.get()` instead. */
  constructor(info: SnapshotInfo, config: ResolvedConfig) {
    this.id = info.id
    this.sandboxId = info.sandboxId
    this.templateId = info.templateId
    this.kind = info.kind
    this.status = info.status
    this.name = info.name
    this.sizeBytes = info.sizeBytes
    this.resources = info.resources
    this.createdAt = info.createdAt
    this.readyAt = info.readyAt
    this._config = config
  }

  // -------------------------------------------------------------------------
  // Static factories
  // -------------------------------------------------------------------------

  /** Fetch a snapshot by ID. */
  static async get(
    snapshotId: string,
    options: ConnectionOptions = {},
  ): Promise<Snapshot> {
    const config = resolveConfig(options)
    return new Snapshot(
      await fetchSnapshot(config, snapshotId, options.signal),
      config,
    )
  }

  /**
   * List a sandbox's snapshots, newest first. Snapshots outlive their
   * sandbox, so this works for a deleted sandbox too.
   */
  static async list(
    sandboxId: string,
    options: SnapshotListOptions = {},
  ): Promise<SnapshotInfo[]> {
    const config = resolveConfig(options)
    const params = new URLSearchParams()
    if (options.limit !== undefined) params.set("limit", String(options.limit))
    if (options.offset !== undefined)
      params.set("offset", String(options.offset))
    const qs = params.toString() ? `?${params.toString()}` : ""
    const raw = await request<ApiSnapshotResponse[]>({
      method: "GET",
      url: `${config.baseUrl}/sandboxes/${sandboxId}/snapshots${qs}`,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })
    return raw.map(toSnapshotInfo)
  }

  /** Delete a snapshot by ID. Idempotent — no error if it's already gone. */
  static async deleteById(
    snapshotId: string,
    options: ConnectionOptions = {},
  ): Promise<void> {
    const config = resolveConfig(options)
    await deleteSnapshot(config, snapshotId, options.signal)
  }

  // -------------------------------------------------------------------------
  // Instance methods
  // -------------------------------------------------------------------------

  /** Re-fetch the latest state of this snapshot. */
  async getInfo(options: { signal?: AbortSignal } = {}): Promise<SnapshotInfo> {
    return fetchSnapshot(this._config, this.id, options.signal)
  }

  /** Rename this snapshot. Returns the renamed snapshot. */
  async rename(
    name: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<Snapshot> {
    const raw = await request<ApiSnapshotResponse>({
      method: "PATCH",
      url: `${this._config.baseUrl}/snapshots/${this.id}`,
      headers: { "X-API-Key": this._config.apiKey },
      body: { name },
      signal: options.signal,
    })
    return new Snapshot(toSnapshotInfo(raw), this._config)
  }

  /**
   * Delete this snapshot. Sandboxes already created from it are unaffected.
   * Idempotent.
   */
  async delete(options: { signal?: AbortSignal } = {}): Promise<void> {
    await deleteSnapshot(this._config, this.id, options.signal)
  }

  /**
   * Wait until the snapshot is `ready`. Resolves at once when it already is;
   * throws `SandboxError` when it failed or was deleted, and `TimeoutError`
   * when it is still settling after `timeoutMs`.
   */
  async waitUntilReady(options: SnapshotWaitOptions = {}): Promise<Snapshot> {
    return waitForSnapshot(this._config, this, options)
  }
}

async function fetchSnapshot(
  config: ResolvedConfig,
  snapshotId: string,
  signal?: AbortSignal,
): Promise<SnapshotInfo> {
  const raw = await request<ApiSnapshotResponse>({
    method: "GET",
    url: `${config.baseUrl}/snapshots/${snapshotId}`,
    headers: { "X-API-Key": config.apiKey },
    signal,
  })
  return toSnapshotInfo(raw)
}

async function deleteSnapshot(
  config: ResolvedConfig,
  snapshotId: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    // 202 means the host finishes the removal shortly; the snapshot is gone
    // from every read already.
    await requestVoid({
      method: "DELETE",
      url: `${config.baseUrl}/snapshots/${snapshotId}`,
      headers: { "X-API-Key": config.apiKey },
      signal,
    })
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err
  }
}

// The check that lands on the deadline still gets a request's worth of time,
// so a snapshot that became ready in the last interval is seen.
const FINAL_CHECK_MS = 5_000

/** @internal Polls a snapshot until it settles. */
export async function waitForSnapshot(
  config: ResolvedConfig,
  snapshot: Snapshot,
  options: SnapshotWaitOptions = {},
): Promise<Snapshot> {
  if (snapshot.status === "ready") return snapshot
  const timeoutMs = options.timeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS
  const pollMs = options.pollIntervalMs ?? DEFAULT_SNAPSHOT_POLL_MS
  const deadlineAt = Date.now() + timeoutMs
  const stillSettling = (status: string) =>
    new TimeoutError(
      `Snapshot ${snapshot.id} still ${status} after ${timeoutMs}ms`,
    )
  let current: SnapshotInfo = snapshot
  for (;;) {
    switch (current.status) {
      case "ready":
        return new Snapshot(current, config)
      case "failed":
        throw new SandboxError(`Snapshot ${snapshot.id} failed`)
      case "deleting":
        throw new SandboxError(`Snapshot ${snapshot.id} was deleted`)
    }
    const left = deadlineAt - Date.now()
    if (left <= 0) throw stillSettling(current.status)
    await sleep(Math.min(pollMs, left), options.signal)
    const budget = AbortSignal.timeout(
      Math.max(deadlineAt - Date.now(), FINAL_CHECK_MS),
    )
    const { signal, release } = composeSignals(budget, options.signal)
    try {
      current = await fetchSnapshot(config, snapshot.id, signal)
    } catch (err) {
      if (budget.aborted && !options.signal?.aborted) {
        throw stillSettling(current.status)
      }
      if (err instanceof NotFoundError) {
        throw new SandboxError(`Snapshot ${snapshot.id} was deleted`)
      }
      throw err
    } finally {
      release()
    }
  }
}
