import { NotFoundError } from "@superserve/sdk"
import type { Command } from "commander"

import { apiFetch, apiJson, apiRequest, isUuid, resolveSandboxId } from "../api"
import { confirm, parseInteger } from "../args"
import { CliError, EXIT, reportBatch, usageError } from "../errors"
import {
  color,
  formatBytes,
  formatDate,
  info,
  isJson,
  printFields,
  printJson,
  printTable,
  statusColor,
  success,
  withSpinner,
} from "../output"

interface SnapshotItem {
  id: string
  sandbox_id: string
  template_id?: string | null
  kind: string
  status: string
  name?: string | null
  size_bytes: number
  resources?: { vcpu_count?: number; memory_mib?: number; disk_mib?: number }
  created_at: string
  ready_at?: string | null
}

const WAIT_MS = 15 * 60_000
const path = (id: string) => `/snapshots/${encodeURIComponent(id)}`

function snapshotId(id: string): string {
  if (!isUuid(id)) {
    throw usageError(
      `"${id}" is not a snapshot ID.`,
      "Run `superserve snapshot list <sandbox>` to find one.",
    )
  }
  return id
}

function nameArg(name: string): string {
  if (name.length < 1 || name.length > 64) {
    throw usageError("Snapshot names must be 1-64 characters.")
  }
  return name
}

function resources(s: SnapshotItem): string | undefined {
  const r = s.resources
  if (r?.vcpu_count === undefined || r.memory_mib === undefined)
    return undefined
  const disk =
    r.disk_mib === undefined
      ? ""
      : `, ${formatBytes(r.disk_mib * 1024 * 1024)} disk`
  return `${r.vcpu_count} vCPU, ${formatBytes(r.memory_mib * 1024 * 1024)}${disk}`
}

/** Poll until the snapshot settles; a failed or deleted one is an error. */
async function waitReady(
  snap: SnapshotItem,
  deadline = Date.now() + WAIT_MS,
): Promise<SnapshotItem> {
  const timedOut = () =>
    new CliError(
      `Snapshot ${snap.id} is still creating.`,
      EXIT.TIMEOUT,
      `Check again with: superserve snapshot wait ${snap.id}`,
      "timeout",
    )
  let current = snap
  while (current.status === "creating") {
    const left = deadline - Date.now()
    if (left <= 0) throw timedOut()
    await new Promise((r) => setTimeout(r, Math.min(2_000, left)))
    try {
      current = await apiRequest<SnapshotItem>("GET", path(snap.id), {
        signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)),
      })
    } catch (err) {
      if (Date.now() >= deadline) throw timedOut()
      throw err
    }
  }
  if (current.status !== "ready") {
    throw new CliError(
      `Snapshot ${snap.id} is ${current.status}.`,
      EXIT.ERROR,
      undefined,
      `snapshot_${current.status}`,
    )
  }
  return current
}

function show(s: SnapshotItem): void {
  if (isJson()) {
    printJson(s)
    return
  }
  printFields([
    ["ID", s.id],
    ["Name", s.name ?? undefined],
    ["Status", s.status, statusColor],
    ["Sandbox", s.sandbox_id],
    ["Template", s.template_id ?? undefined],
    ["Resources", resources(s)],
    ["Size", formatBytes(s.size_bytes)],
    ["Created", formatDate(s.created_at)],
    ["Ready", s.ready_at ? formatDate(s.ready_at) : undefined],
  ])
}

export function register(program: Command): void {
  const snapshot = program
    .command("snapshot")
    .alias("snapshots")
    .description(
      "Save a sandbox's memory and disk, and fork new sandboxes from it",
    )
    .addHelpText(
      "after",
      `
Fork a snapshot into a new sandbox with:
  superserve sandbox create --snapshot <snapshot-id>`,
    )

  snapshot
    .command("create")
    .description("Snapshot a sandbox (a running sandbox pauses briefly)")
    .argument("<sandbox>", "Sandbox ID or name")
    .option("-n, --name <name>", "Snapshot name")
    .option(
      "--idempotency-key <key>",
      "Retries with the same key return the first request's snapshot (default: a fresh key per run)",
    )
    .option("--no-wait", "Don't wait for a snapshot that is still creating")
    .addHelpText(
      "after",
      `
Examples:
  superserve snapshot create dev --name with-deps
  superserve sandbox create --snapshot $(superserve snapshot create dev --json | jq -r .id)`,
    )
    .action(
      async (
        ref: string,
        opts: { name?: string; idempotencyKey?: string; wait: boolean },
      ) => {
        const body = {
          name: opts.name === undefined ? undefined : nameArg(opts.name),
          // A lost response then can't create a second snapshot on retry.
          idempotency_key: opts.idempotencyKey ?? crypto.randomUUID(),
        }
        const id = await resolveSandboxId(ref)
        const snap = await withSpinner(`Snapshotting ${ref}`, async () => {
          // The request holds until the snapshot is ready; a 202 means the
          // host's answer was lost and it settles shortly. One budget covers both.
          const deadline = Date.now() + WAIT_MS
          const { data: created } = await apiJson<SnapshotItem>(
            "POST",
            `/sandboxes/${encodeURIComponent(id)}/snapshot`,
            { body, timeoutMs: WAIT_MS },
          )
          return opts.wait ? waitReady(created, deadline) : created
        })
        if (!isJson()) {
          success(
            snap.status === "ready"
              ? `Snapshot ${snap.id} is ready`
              : `Snapshot ${snap.id} is ${snap.status}`,
          )
        }
        show(snap)
        if (!isJson()) {
          info(
            color.dim(
              `\nFork it: superserve sandbox create --snapshot ${snap.id}`,
            ),
          )
        }
      },
    )

  snapshot
    .command("list")
    .alias("ls")
    .description("List a sandbox's snapshots, newest first")
    .argument("<sandbox>", "Sandbox ID or name (an ID also works once deleted)")
    .option("--limit <n>", "Page size (1-200)")
    .option("--offset <n>", "Rows to skip")
    .action(async (ref: string, opts: { limit?: string; offset?: string }) => {
      const query = {
        limit:
          opts.limit === undefined
            ? undefined
            : String(parseInteger(opts.limit, "--limit", { min: 1, max: 200 })),
        offset:
          opts.offset === undefined
            ? undefined
            : String(parseInteger(opts.offset, "--offset", { min: 0 })),
      }
      const id = await resolveSandboxId(ref)
      const rows = await apiRequest<SnapshotItem[]>(
        "GET",
        `/sandboxes/${encodeURIComponent(id)}/snapshots`,
        { query },
      )
      if (isJson()) {
        printJson(rows)
        return
      }
      printTable(
        rows,
        [
          { header: "ID", value: (s) => s.id },
          { header: "Name", value: (s) => s.name ?? "-" },
          { header: "Status", value: (s) => s.status, style: statusColor },
          { header: "Size", value: (s) => formatBytes(s.size_bytes) },
          { header: "Created", value: (s) => formatDate(s.created_at) },
        ],
        "No snapshots.",
      )
    })

  snapshot
    .command("get")
    .alias("info")
    .description("Show a snapshot's details")
    .argument("<snapshot-id>", "Snapshot ID")
    .action(async (id: string) => {
      show(await apiRequest<SnapshotItem>("GET", path(snapshotId(id))))
    })

  snapshot
    .command("rename")
    .description("Rename a snapshot")
    .argument("<snapshot-id>", "Snapshot ID")
    .argument("<name>", "New name")
    .action(async (id: string, name: string) => {
      const renamed = await apiRequest<SnapshotItem>(
        "PATCH",
        path(snapshotId(id)),
        { body: { name: nameArg(name) } },
      )
      if (isJson()) printJson(renamed)
      else success(`Renamed snapshot ${id} to ${name}`)
    })

  snapshot
    .command("delete")
    .alias("rm")
    .description("Delete one or more snapshots")
    .argument("<snapshot-id...>", "Snapshot IDs")
    .option("-y, --yes", "Skip the confirmation prompt")
    .addHelpText(
      "after",
      "\nSandboxes already created from a snapshot are unaffected.",
    )
    .action(async (ids: string[], opts: { yes?: boolean }) => {
      ids.forEach(snapshotId)
      await confirm(
        ids.length === 1
          ? `Delete snapshot ${ids[0]}?`
          : `Delete ${ids.length} snapshots (${ids.join(", ")})?`,
        opts.yes,
      )
      const results = await withSpinner("Deleting", () =>
        Promise.allSettled(
          ids.map(async (id) => {
            try {
              // 202: marked deleting; its files go shortly. Done either way.
              await apiFetch("DELETE", path(id))
            } catch (err) {
              if (!(err instanceof NotFoundError)) throw err
            }
          }),
        ),
      )
      reportBatch(
        ids,
        ids,
        results,
        (id) => `Deleted snapshot ${id}`,
        "deleted",
      )
    })

  snapshot
    .command("wait")
    .description("Wait until a snapshot is ready (exits non-zero if it failed)")
    .argument("<snapshot-id>", "Snapshot ID")
    .action(async (id: string) => {
      const snap = await withSpinner(`Waiting for snapshot ${id}`, async () =>
        waitReady(await apiRequest<SnapshotItem>("GET", path(snapshotId(id)))),
      )
      if (isJson()) printJson(snap)
      else success(`Snapshot ${id} is ready`)
    })
}
