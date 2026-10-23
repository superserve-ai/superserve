import { ConflictError, NotFoundError, Sandbox } from "@superserve/sdk"
import { type Command, Option } from "commander"

import {
  apiFetch,
  apiJson,
  apiRequest,
  isSandboxId,
  isUuid,
  resolveSandboxId,
} from "../api"
import {
  collect,
  confirm,
  parseDuration,
  parseInteger,
  parseKeyValues,
} from "../args"
import { sdkOptions } from "../config"
import { CliError, EXIT, reportBatch, usageError } from "../errors"
import {
  color,
  formatBytes,
  formatDate,
  formatSeconds,
  info,
  isJson,
  printFields,
  printJson,
  printTable,
  statusColor,
  success,
  withSpinner,
} from "../output"

interface SandboxItem {
  id: string
  name: string
  status: string
  vcpu_count?: number
  memory_mib?: number
  snapshot_id?: string
  source_snapshot_id?: string
  created_at?: string
  timeout_seconds?: number
  auto_delete_seconds?: number
  auto_delete_at?: string
  network?: { allow_out?: string[]; deny_out?: string[] }
  metadata?: Record<string, string>
  preview_access?: string
  routing_hint?: string
  access_token?: string
  secrets?: { env_key: string; secret_name: string; revoked?: boolean }[]
}

interface NetworkEvent {
  kind: string
  id: number
  ts: string
  host?: string
  dst_ip?: string
  dst_port?: number
  verdict?: string
  match_rule?: string
  bytes_sent?: number
  bytes_recv?: number
  method?: string
  path?: string
  status?: number
  latency_ms?: number
  secret_id?: string
  error_code?: string
}

interface NetworkEventPage {
  data?: NetworkEvent[]
  next_cursor: string | null
  has_more: boolean
}

const STATUSES = [
  "starting",
  "active",
  "pausing",
  "paused",
  "resuming",
  "migrating",
  "failed",
  "deleted",
]
const MAX_TIMEOUT = 7 * 86_400
const MAX_AUTO_DELETE = 30 * 86_400
const PAUSE_WAIT_MS = 5 * 60_000

const path = (id: string) => `/sandboxes/${encodeURIComponent(id)}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The access token is a data-plane credential the user didn't ask for. */
function withoutToken<T extends { access_token?: string }>(
  s: T,
): Omit<T, "access_token"> {
  const { access_token: _, ...rest } = s
  return rest
}

function seconds(
  input: string,
  flag: string,
  { min, max }: { min: number; max: number },
): number {
  const n = parseDuration(input, flag)
  if (n < min || n > max) {
    throw usageError(
      `${flag} must be between ${formatSeconds(min)} and ${formatSeconds(max)}.`,
    )
  }
  return n
}

/** `--timeout 2h` → seconds; `--timeout none` → null, which clears it. */
function secondsOrNone(
  input: string,
  flag: string,
  range: { min: number; max: number },
): number | null {
  return input === "none" ? null : seconds(input, flag, range)
}

function limitQuery(limit: string | undefined): string | undefined {
  return limit === undefined
    ? undefined
    : String(parseInteger(limit, "--limit", { min: 1, max: 200 }))
}

function shape(s: { vcpu_count?: number; memory_mib?: number }): string {
  if (s.vcpu_count === undefined || s.memory_mib === undefined) return "-"
  return `${s.vcpu_count} vCPU, ${formatBytes(s.memory_mib * 1024 * 1024)}`
}

function keyValues(m: Record<string, string> | undefined): string | undefined {
  const entries = Object.entries(m ?? {})
  return entries.length
    ? entries.map(([k, v]) => `${k}=${v}`).join(", ")
    : undefined
}

const previewAccessOption = () =>
  new Option(
    "--preview-access <mode>",
    "Default access for newly published preview ports",
  ).choices(["public", "private"])

async function postPause(id: string, async: boolean): Promise<number> {
  const res = await apiFetch("POST", `${path(id)}/pause`, {
    headers: async ? { Prefer: "respond-async" } : undefined,
    timeoutMs: async ? 30_000 : 120_000,
  })
  return res.status
}

/** Poll until the pause lands. Deleted meanwhile (auto-delete 0) counts as done. */
/** Resolves "deleted" when auto-delete removed it as soon as it paused. */
async function waitPaused(id: string): Promise<"paused" | "deleted"> {
  const started = Date.now()
  const deadline = started + PAUSE_WAIT_MS
  const stillPausing = () =>
    new CliError(
      `Sandbox ${id} is still pausing; it will finish in the background.`,
      EXIT.TIMEOUT,
      `Check with: superserve sandbox get ${id}`,
      "timeout",
    )
  for (;;) {
    let status: string
    try {
      status = (
        await apiRequest<SandboxItem>("GET", path(id), {
          signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)),
        })
      ).status
    } catch (err) {
      if (err instanceof NotFoundError) return "deleted"
      if (Date.now() >= deadline) throw stillPausing()
      throw err
    }
    if (status === "paused" || status === "deleted") return status
    // A pause accepted after a timed-out request can still read "active" at first.
    const early = status === "active" && Date.now() - started < 3_000
    if (status !== "pausing" && !early) {
      throw new CliError(`Sandbox ${id} did not pause: status is ${status}.`)
    }
    const left = deadline - Date.now()
    if (left <= 0) throw stillPausing()
    await sleep(Math.min(1_000, left))
  }
}

/** `--since 15m` (ago) or an RFC 3339 timestamp. */
function sinceTimestamp(input: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) {
    const t = Date.parse(input)
    if (Number.isNaN(t)) throw usageError(`Invalid --since "${input}".`)
    return new Date(t).toISOString()
  }
  const ago = parseDuration(input, "--since") * 1000
  return new Date(Date.now() - ago).toISOString()
}

function eventTarget(e: NetworkEvent): string {
  const host = e.host ?? e.dst_ip ?? "-"
  return e.dst_port ? `${host}:${e.dst_port}` : host
}

function eventResult(e: NetworkEvent): string {
  if (e.verdict) return e.verdict
  return e.status !== undefined ? String(e.status) : "-"
}

function eventDetails(e: NetworkEvent): string {
  const parts: string[] = []
  if (e.kind === "request") {
    if (e.method) parts.push(`${e.method} ${e.path ?? ""}`.trim())
    if (e.latency_ms !== undefined) parts.push(`${e.latency_ms}ms`)
    if (e.secret_id) parts.push(`secret ${e.secret_id}`)
  } else {
    if (e.match_rule) parts.push(`rule ${e.match_rule}`)
    if (e.bytes_sent !== undefined || e.bytes_recv !== undefined) {
      parts.push(
        `sent ${formatBytes(e.bytes_sent ?? 0)}, recv ${formatBytes(e.bytes_recv ?? 0)}`,
      )
    }
  }
  if (e.error_code) parts.push(e.error_code)
  return parts.join("  ")
}

export function register(program: Command): void {
  const sandbox = program
    .command("sandbox")
    .alias("sandboxes")
    .alias("sb")
    .description("Create, inspect and manage sandboxes")

  sandbox
    .command("create")
    .description("Create a sandbox")
    .option("-n, --name <name>", "Sandbox name (default: sandbox-<random>)")
    .option(
      "-t, --template <template>",
      "Template name or ID to boot from (default: superserve/base)",
    )
    .option("--snapshot <snapshot-id>", "Fork a saved snapshot instead")
    .option(
      "--timeout <duration>",
      "Auto-pause after this long active, e.g. 30m (max 7d)",
    )
    .option(
      "--auto-delete <duration>",
      "Delete after this long paused, e.g. 7d; 0 deletes on pause (max 30d)",
    )
    .option("-m, --metadata <key=value>", "Metadata tag (repeatable)", collect)
    .option(
      "-e, --env <key=value>",
      "Environment variable (repeatable)",
      collect,
    )
    .option(
      "-s, --secret <env=secret>",
      "Bind a stored secret to an env var (repeatable)",
      collect,
    )
    .option(
      "--allow-out <rule>",
      "Allow egress to a domain or CIDR (repeatable)",
      collect,
    )
    .option(
      "--deny-out <cidr>",
      "Deny egress to a CIDR (repeatable); 0.0.0.0/0 also blocks DNS, so allow 1.1.1.1/32 or 8.8.8.8/32 when using domain rules",
      collect,
    )
    .addOption(previewAccessOption())
    .addHelpText(
      "after",
      `
The sandbox's access token is never printed, --json included.

Examples:
  superserve sandbox create --name dev -t superserve/python-3.11
  superserve sandbox create --timeout 30m --auto-delete 7d -m env=ci
  superserve sandbox create -s OPENAI_API_KEY=openai-prod --allow-out api.openai.com --deny-out 0.0.0.0/0
  superserve sandbox create --snapshot <snapshot-id>      # fork a snapshot`,
    )
    .action(
      async (opts: {
        name?: string
        template?: string
        snapshot?: string
        timeout?: string
        autoDelete?: string
        metadata?: string[]
        env?: string[]
        secret?: string[]
        allowOut?: string[]
        denyOut?: string[]
        previewAccess?: string
      }) => {
        if (opts.template && opts.snapshot) {
          throw usageError("Use either --template or --snapshot, not both.")
        }
        if (opts.snapshot && !isUuid(opts.snapshot)) {
          throw usageError(
            `--snapshot must be a snapshot ID, got "${opts.snapshot}".`,
            "Run `superserve snapshot list <sandbox>` to find one.",
          )
        }
        const name =
          opts.name ??
          `sandbox-${Buffer.from(crypto.getRandomValues(new Uint8Array(3))).toString("hex")}`
        if (name.length < 1 || name.length > 64) {
          throw usageError("--name must be 1-64 characters.")
        }
        // Commands treat an ID-shaped reference as an ID, so such a name
        // could never be looked up by name.
        if (isSandboxId(name)) {
          throw usageError("--name can't look like a sandbox ID.")
        }
        const body = {
          name,
          from_template: opts.template,
          from_snapshot: opts.snapshot,
          timeout_seconds:
            opts.timeout === undefined
              ? undefined
              : seconds(opts.timeout, "--timeout", {
                  min: 1,
                  max: MAX_TIMEOUT,
                }),
          auto_delete_seconds:
            opts.autoDelete === undefined
              ? undefined
              : seconds(opts.autoDelete, "--auto-delete", {
                  min: 0,
                  max: MAX_AUTO_DELETE,
                }),
          metadata: parseKeyValues(opts.metadata, "--metadata"),
          env_vars: parseKeyValues(opts.env, "--env"),
          secrets: parseKeyValues(opts.secret, "--secret"),
          network:
            opts.allowOut || opts.denyOut
              ? { allow_out: opts.allowOut, deny_out: opts.denyOut }
              : undefined,
          preview_access: opts.previewAccess,
        }
        // A fork restores memory, so allow longer than the default 30s.
        const created = await withSpinner(`Creating sandbox ${name}`, () =>
          apiRequest<SandboxItem>("POST", "/sandboxes", {
            body,
            timeoutMs: 120_000,
          }),
        )
        if (isJson()) {
          printJson(withoutToken(created))
          return
        }
        success(`Created sandbox ${created.name}`)
        printFields([
          ["ID", created.id],
          ["Name", created.name],
          ["Status", created.status, statusColor],
          [
            "From",
            opts.snapshot
              ? `snapshot ${opts.snapshot}`
              : (opts.template ?? "superserve/base"),
          ],
          ["Shape", shape(created)],
        ])
        info(
          color.dim(
            `\nRun a command: superserve exec ${created.id} -- echo hello`,
          ),
        )
      },
    )

  sandbox
    .command("list")
    .alias("ls")
    .description("List sandboxes")
    .option(
      "--status <status>",
      `Only these statuses, comma-separated or repeated (${STATUSES.join(", ")})`,
      collect,
    )
    .option(
      "-m, --metadata <key=value>",
      "Only sandboxes with this metadata tag (repeatable, all must match)",
      collect,
    )
    .option("-q, --search <text>", "Case-insensitive substring of the name")
    .option("--limit <n>", "Page size (1-200)")
    .option("--offset <n>", "Rows to skip")
    .addOption(
      new Option("--sort <field>", "Sort by").choices([
        "created_at",
        "name",
        "status",
      ]),
    )
    .addOption(
      new Option("--order <dir>", "Sort direction").choices(["asc", "desc"]),
    )
    .addHelpText(
      "after",
      `
Examples:
  superserve sandbox list --status active,paused
  superserve sandbox list -m env=prod -q agent --limit 20`,
    )
    .action(
      async (opts: {
        status?: string[]
        metadata?: string[]
        search?: string
        limit?: string
        offset?: string
        sort?: string
        order?: string
      }) => {
        const statuses = opts.status
          ?.flatMap((s) => s.split(","))
          .map((s) => s.trim())
        for (const s of statuses ?? []) {
          if (!STATUSES.includes(s)) {
            throw usageError(
              `Unknown status "${s}". Use one of: ${STATUSES.join(", ")}.`,
            )
          }
        }
        const query: Record<string, string | undefined> = {
          status: statuses?.join(","),
          q: opts.search,
          limit: limitQuery(opts.limit),
          offset:
            opts.offset === undefined
              ? undefined
              : String(parseInteger(opts.offset, "--offset", { min: 0 })),
          sort: opts.sort,
          order: opts.order,
        }
        for (const [k, v] of Object.entries(
          parseKeyValues(opts.metadata, "--metadata") ?? {},
        )) {
          query[`metadata.${k}`] = v
        }
        const { data: rows, headers } = await apiJson<SandboxItem[]>(
          "GET",
          "/sandboxes",
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
            { header: "Name", value: (s) => s.name },
            { header: "Status", value: (s) => s.status, style: statusColor },
            { header: "CPU/Mem", value: shape },
            {
              header: "Timeout",
              value: (s) =>
                s.timeout_seconds ? formatSeconds(s.timeout_seconds) : "-",
            },
            { header: "Created", value: (s) => formatDate(s.created_at) },
          ],
          "No sandboxes.",
        )
        const total = Number(headers.get("X-Total-Count") ?? Number.NaN)
        if (rows.length && total > rows.length) {
          const from = Number(query.offset ?? 0)
          info(
            color.dim(`Showing ${from + 1}-${from + rows.length} of ${total}`),
          )
        }
      },
    )

  sandbox
    .command("get")
    .alias("info")
    .description("Show a sandbox's details")
    .argument("<sandbox>", "Sandbox ID or name")
    .addHelpText(
      "after",
      "\nThe sandbox's access token is omitted, --json included.",
    )
    .action(async (ref: string) => {
      const raw = await apiRequest<SandboxItem>(
        "GET",
        path(await resolveSandboxId(ref)),
      )
      // Omitted on older sandboxes, which predate per-port publication.
      const s = {
        ...raw,
        preview_access: raw.preview_access ?? "legacy_public",
      }
      if (isJson()) {
        printJson(withoutToken(s))
        return
      }
      const secrets = s.secrets?.length
        ? s.secrets
            .map(
              (b) =>
                `${b.env_key}=${b.secret_name}${b.revoked ? " (revoked)" : ""}`,
            )
            .join(", ")
        : undefined
      printFields([
        ["ID", s.id],
        ["Name", s.name],
        ["Status", s.status, statusColor],
        ["Shape", shape(s)],
        ["Created", formatDate(s.created_at)],
        [
          "Timeout",
          s.timeout_seconds ? formatSeconds(s.timeout_seconds) : "none",
        ],
        [
          "Auto-delete",
          s.auto_delete_seconds === undefined
            ? "none"
            : formatSeconds(s.auto_delete_seconds),
        ],
        [
          "Deletes",
          s.auto_delete_at ? formatDate(s.auto_delete_at) : undefined,
        ],
        ["Preview access", s.preview_access],
        ["Allow out", s.network?.allow_out?.join(", ") || undefined],
        ["Deny out", s.network?.deny_out?.join(", ") || undefined],
        ["Metadata", keyValues(s.metadata)],
        ["Secrets", secrets],
        ["Source snapshot", s.source_snapshot_id],
      ])
    })

  sandbox
    .command("update")
    .description(
      "Change a sandbox's metadata, timeouts, egress rules or preview access",
    )
    .argument("<sandbox>", "Sandbox ID or name")
    .option(
      "-m, --metadata <key=value>",
      "Metadata tag (repeatable); replaces ALL existing metadata",
      collect,
    )
    .option(
      "--timeout <duration>",
      'Auto-pause after this long active (max 7d), or "none"',
    )
    .option(
      "--auto-delete <duration>",
      'Delete after this long paused (0 = on pause, max 30d), or "none"',
    )
    .option(
      "--allow-out <rule>",
      "Allowed domain or CIDR (repeatable); replaces all egress rules",
      collect,
    )
    .option(
      "--deny-out <cidr>",
      "Denied CIDR (repeatable); replaces all egress rules. 0.0.0.0/0 also blocks DNS, so allow 1.1.1.1/32 or 8.8.8.8/32 when using domain rules",
      collect,
    )
    .option("--clear-network", "Remove all egress rules")
    .option("--clear-metadata", "Remove all metadata tags")
    .addOption(previewAccessOption())
    .addHelpText(
      "after",
      `
Metadata and egress rules are full replacements: keys and rules you don't pass
are removed. Egress rules can only change while the sandbox is active.

Examples:
  superserve sandbox update dev --timeout 1h --auto-delete none
  superserve sandbox update dev -m env=prod -m owner=ci
  superserve sandbox update dev --allow-out api.openai.com --deny-out 0.0.0.0/0`,
    )
    .action(
      async (
        ref: string,
        opts: {
          metadata?: string[]
          timeout?: string
          autoDelete?: string
          allowOut?: string[]
          denyOut?: string[]
          clearNetwork?: boolean
          clearMetadata?: boolean
          previewAccess?: string
        },
      ) => {
        if (opts.clearNetwork && (opts.allowOut || opts.denyOut)) {
          throw usageError(
            "Use either --clear-network or --allow-out/--deny-out, not both.",
          )
        }
        if (opts.clearMetadata && opts.metadata) {
          throw usageError(
            "Use either --clear-metadata or --metadata, not both.",
          )
        }
        const body: Record<string, unknown> = {}
        if (opts.metadata) {
          body.metadata = parseKeyValues(opts.metadata, "--metadata")
        }
        if (opts.clearMetadata) body.metadata = {}
        if (opts.timeout !== undefined) {
          body.timeout_seconds = secondsOrNone(opts.timeout, "--timeout", {
            min: 1,
            max: MAX_TIMEOUT,
          })
        }
        if (opts.autoDelete !== undefined) {
          body.auto_delete_seconds = secondsOrNone(
            opts.autoDelete,
            "--auto-delete",
            { min: 0, max: MAX_AUTO_DELETE },
          )
        }
        if (opts.clearNetwork || opts.allowOut || opts.denyOut) {
          body.network = {
            allow_out: opts.allowOut ?? [],
            deny_out: opts.denyOut ?? [],
          }
        }
        if (opts.previewAccess) body.preview_access = opts.previewAccess
        if (Object.keys(body).length === 0) {
          throw usageError(
            "Nothing to update.",
            "Pass at least one of --metadata, --clear-metadata, --timeout, --auto-delete, --allow-out, --deny-out, --clear-network, --preview-access.",
          )
        }
        const id = await resolveSandboxId(ref)
        await apiRequest("PATCH", path(id), { body })
        if (isJson()) {
          printJson({ id, ...body })
          return
        }
        success(`Updated sandbox ${ref}`)
      },
    )

  sandbox
    .command("pause")
    .description("Pause a sandbox, keeping its memory, processes and files")
    .argument("<sandbox>", "Sandbox ID or name")
    .option("--no-wait", "Return as soon as the pause is accepted")
    .addHelpText(
      "after",
      `
A paused sandbox uses no compute. Resume it with \`superserve sandbox resume\`;
\`superserve exec\` also resumes it automatically.`,
    )
    .action(async (ref: string, opts: { wait: boolean }) => {
      const id = await resolveSandboxId(ref)
      const outcome = await withSpinner(`Pausing ${ref}`, async () => {
        let code: number
        try {
          code = await postPause(id, !opts.wait)
        } catch (err) {
          if (err instanceof ConflictError) {
            let status: string
            try {
              ;({ status } = await apiRequest<SandboxItem>("GET", path(id)))
            } catch (lookup) {
              // An --auto-delete 0 sandbox can vanish as its pause lands.
              if (lookup instanceof NotFoundError) return "deleted"
              throw lookup
            }
            if (status === "paused") return "already"
            if (status !== "pausing") throw err
            code = 202
          } else if (
            opts.wait &&
            err instanceof Error &&
            err.name === "TimeoutError"
          ) {
            // The held request gave up first; the pause may still land.
            code = 202
          } else {
            throw err
          }
        }
        if (code !== 202) return "paused"
        if (!opts.wait) return "pausing"
        return await waitPaused(id)
      })
      if (isJson()) {
        printJson({
          id,
          status: outcome === "already" ? "paused" : outcome,
        })
      } else if (outcome === "already") {
        success(`Sandbox ${ref} is already paused`)
      } else if (outcome === "pausing") {
        success(`Pausing sandbox ${ref} in the background`)
      } else if (outcome === "deleted") {
        success(`Paused sandbox ${ref}; auto-delete then removed it`)
      } else {
        success(`Paused sandbox ${ref}`)
      }
    })

  sandbox
    .command("resume")
    .description("Resume a paused sandbox where it left off")
    .argument("<sandbox>", "Sandbox ID or name")
    .action(async (ref: string) => {
      const id = await resolveSandboxId(ref)
      const deadline = Date.now() + 60_000
      const resumed = await withSpinner(`Resuming ${ref}`, async () => {
        for (;;) {
          try {
            return await apiRequest<SandboxItem>("POST", `${path(id)}/resume`, {
              timeoutMs: 120_000,
            })
          } catch (err) {
            if (!(err instanceof ConflictError)) throw err
            // The server already waited briefly; a pause still finishing gets a bit longer.
            if (err.code === "sandbox_pausing" && Date.now() < deadline) {
              await sleep(1_000)
              continue
            }
            const { status } = await apiRequest<SandboxItem>("GET", path(id))
            if (status === "active") return undefined
            // A pause that has (or is about to) land: resuming is still valid.
            if (
              (status === "paused" || status === "pausing") &&
              Date.now() < deadline
            ) {
              await sleep(1_000)
              continue
            }
            throw err
          }
        }
      })
      if (isJson()) {
        printJson(resumed ? withoutToken(resumed) : { id, status: "active" })
      } else {
        success(
          resumed
            ? `Resumed sandbox ${ref}`
            : `Sandbox ${ref} is already active`,
        )
      }
    })

  sandbox
    .command("delete")
    .alias("rm")
    .alias("kill")
    .description("Delete one or more sandboxes")
    .argument("<sandbox...>", "Sandbox IDs or names")
    .option("-y, --yes", "Skip the confirmation prompt")
    .addHelpText(
      "after",
      `
Deleting a sandbox discards its memory and disk; its snapshots are kept.

Examples:
  superserve sandbox delete dev
  superserve sandbox rm $(superserve sandbox ls --status failed --json | jq -r '.[].id') --yes`,
    )
    .action(async (refs: string[], opts: { yes?: boolean }) => {
      const ids = await Promise.all(refs.map(resolveSandboxId))
      await confirm(
        refs.length === 1
          ? `Delete sandbox ${refs[0]}?`
          : `Delete ${refs.length} sandboxes (${refs.join(", ")})?`,
        opts.yes,
      )
      // killById treats 404 as done and retries the 409 of a mid-transition sandbox.
      const results = await withSpinner("Deleting", () =>
        Promise.allSettled(ids.map((id) => Sandbox.killById(id, sdkOptions()))),
      )
      reportBatch(ids, refs, results, (ref) => `Deleted ${ref}`, "deleted")
    })

  sandbox
    .command("network-log")
    .description("Show a sandbox's outbound connections and requests")
    .argument("<sandbox>", "Sandbox ID or name")
    .addOption(
      new Option(
        "--verdict <verdict>",
        "Only connections with this verdict",
      ).choices(["allowed", "blocked", "failed"]),
    )
    .option(
      "--since <time>",
      "Only events newer than a duration ago (15m, 2h) or an RFC 3339 time",
    )
    .option(
      "--before <cursor|time>",
      "Only events older than an RFC 3339 time, or a page cursor",
    )
    .option("--limit <n>", "Events per page (1-200, default 50)")
    .option("--all", "Fetch every page")
    .addHelpText(
      "after",
      `
Reading the log never resumes a paused sandbox.

Examples:
  superserve sandbox network-log dev --verdict blocked --since 1h
  superserve sandbox network-log dev --all --json`,
    )
    .action(
      async (
        ref: string,
        opts: {
          verdict?: string
          since?: string
          before?: string
          limit?: string
          all?: boolean
        },
      ) => {
        const query = {
          verdict: opts.verdict,
          since: opts.since ? sinceTimestamp(opts.since) : undefined,
          before: opts.before,
          limit: limitQuery(opts.limit),
        }
        const url = `${path(await resolveSandboxId(ref))}/network`
        let page = await apiRequest<NetworkEventPage>("GET", url, { query })
        const events = [...(page.data ?? [])]
        while (opts.all && page.has_more && page.next_cursor) {
          page = await apiRequest<NetworkEventPage>("GET", url, {
            query: { ...query, before: page.next_cursor },
          })
          events.push(...(page.data ?? []))
        }
        if (isJson()) {
          printJson({ ...page, data: events })
          return
        }
        printTable(
          events,
          [
            { header: "Time", value: (e) => e.ts.replace(/\.\d+/, "") },
            { header: "Kind", value: (e) => e.kind },
            { header: "Host", value: eventTarget },
            { header: "Result", value: eventResult, style: statusColor },
            { header: "Details", value: eventDetails },
          ],
          "No network events.",
        )
        if (page.has_more && page.next_cursor) {
          info(
            color.dim(
              `More events: --before ${page.next_cursor}, or --all for every page`,
            ),
          )
        }
      },
    )
}
