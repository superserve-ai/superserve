import { readFileSync } from "node:fs"

import { NotFoundError } from "@superserve/sdk"
import type { Command } from "commander"

import { apiRequest, resolveSandboxId } from "../api"
import {
  collect,
  confirm,
  isInteractive,
  parseInteger,
  readSecret,
} from "../args"
import { reportBatch, usageError } from "../errors"
import {
  color,
  formatDate,
  info,
  isJson,
  printFields,
  printJson,
  printTable,
  statusColor,
  success,
} from "../output"

interface SecretRow {
  id: string
  name: string
  auth_type: string
  auth_config: Record<string, unknown>
  provider_shortcut?: string | null
  hosts?: string[]
  created_at: string
  updated_at: string
  last_used_at?: string | null
}

interface ProviderRow {
  name: string
  display: string
  auth_type: string
  hosts?: string[]
  token_shape: string
}

interface AuditRow {
  id: number
  ts: string
  sandbox_id: string
  sandbox_name?: string | null
  method: string
  host: string
  path: string
  status: number
  upstream_status?: number | null
  latency_ms?: number | null
  error_code?: string | null
}

interface BindingRow {
  sandbox_id: string
  sandbox_name: string
  env_key: string
  status: string
}

const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const AUTH_TYPES = ["bearer", "api-key", "basic", "custom"]
const AUDIT_STATUSES = ["2xx", "3xx", "4xx", "5xx", "errors"]
const MAX_VALUE = 8192

const spath = (name: string) => `/secrets/${encodeURIComponent(name)}`

function checkSecretName(name: string): void {
  if (name.length > 128 || !SECRET_NAME_RE.test(name)) {
    throw usageError(
      `Invalid secret name "${name}".`,
      "Start with a letter or _, then letters, digits, _ or - (at most 128 chars).",
    )
  }
}

async function readValue(prompt: string): Promise<string> {
  const value = await readSecret(prompt)
  if (value.length > MAX_VALUE) {
    throw usageError(`The value is longer than ${MAX_VALUE} characters.`)
  }
  return value
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[b.length]
}

async function checkProvider(name: string): Promise<void> {
  const names = (await apiRequest<ProviderRow[]>("GET", "/providers")).map(
    (p) => p.name,
  )
  if (names.includes(name)) return
  const close = names.filter(
    (n) =>
      levenshtein(n, name.toLowerCase()) <= 2 ||
      n.includes(name.toLowerCase()) ||
      name.toLowerCase().includes(n),
  )
  throw usageError(
    `Unknown provider "${name}".`,
    close.length
      ? `Did you mean ${close.join(", ")}?`
      : "Run `superserve provider list` to see the built-in providers.",
  )
}

interface CreateOpts {
  provider?: string
  host?: string[]
  auth?: string
  header?: string
  prefix?: string
  username?: string
  headerTemplate?: string[]
  file?: string
}

function readAuthFile(path: string): Record<string, unknown> {
  // stdin carries the secret value, so the auth file can't come from it.
  if (path === "-")
    throw usageError("--file must be a path; stdin carries the value.")
  let auth: unknown
  try {
    auth = JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    throw usageError(`Cannot read ${path} as JSON: ${(err as Error).message}`)
  }
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
    throw usageError(`${path} must contain a JSON auth object.`)
  }
  const a = auth as Record<string, unknown>
  if (a.per_host !== undefined) {
    if (!Array.isArray(a.per_host) || a.per_host.length === 0) {
      throw usageError("per_host must be a non-empty array of rules.")
    }
    for (const rule of a.per_host as Record<string, unknown>[]) {
      if (
        !Array.isArray(rule?.hosts) ||
        !AUTH_TYPES.includes(rule.type as string)
      ) {
        throw usageError(
          `Each per_host rule needs "hosts" (array) and "type" (${AUTH_TYPES.join(", ")}).`,
        )
      }
    }
  } else if (!AUTH_TYPES.includes(a.type as string)) {
    throw usageError(
      `${path} needs "type" (${AUTH_TYPES.join(", ")}) or "per_host".`,
    )
  }
  return a
}

function authFields(opts: CreateOpts): Record<string, unknown> {
  const authFlags = [
    ["--host", opts.host],
    ["--auth", opts.auth],
    ["--header", opts.header],
    ["--prefix", opts.prefix],
    ["--username", opts.username],
    ["--header-template", opts.headerTemplate],
    ["--file", opts.file],
  ].filter(([, v]) => v !== undefined)
  if (opts.provider) {
    if (authFlags.length) {
      throw usageError(
        `--provider can't be combined with ${authFlags.map(([f]) => f).join(", ")}.`,
        "A provider sets the auth scheme and hosts for you.",
      )
    }
    return { provider: opts.provider }
  }
  if (!authFlags.length) {
    throw usageError(
      "Say how the secret authenticates: --provider <name>, or --host and --auth.",
      "Run `superserve provider list` for built-in providers.",
    )
  }
  let hosts = opts.host ?? []
  let auth: Record<string, unknown>
  if (opts.file) {
    const extra = authFlags.filter(([f]) => f !== "--file" && f !== "--host")
    if (extra.length) {
      throw usageError(
        `--file holds the whole auth object; drop ${extra.map(([f]) => f).join(", ")}.`,
      )
    }
    auth = readAuthFile(opts.file)
    // Every per_host host must also be allow-listed; default to exactly those.
    if (!hosts.length && Array.isArray(auth.per_host)) {
      hosts = [
        ...new Set(
          (auth.per_host as { hosts: string[] }[]).flatMap((r) => r.hosts),
        ),
      ]
    }
  } else {
    const type = opts.auth
    if (!type)
      throw usageError(`--auth is required (${AUTH_TYPES.join(", ")}).`)
    if (!AUTH_TYPES.includes(type)) {
      throw usageError(`--auth must be one of ${AUTH_TYPES.join(", ")}.`)
    }
    const only = (flag: string, set: unknown, forType: string) => {
      if (set !== undefined && type !== forType) {
        throw usageError(`${flag} only applies to --auth ${forType}.`)
      }
    }
    only("--header", opts.header, "api-key")
    only("--prefix", opts.prefix, "api-key")
    only("--username", opts.username, "basic")
    only("--header-template", opts.headerTemplate, "custom")
    auth = { type }
    if (type === "api-key") {
      if (!opts.header)
        throw usageError("--auth api-key needs --header <name>.")
      auth.header = opts.header
      if (opts.prefix !== undefined) auth.prefix = opts.prefix
    }
    if (type === "basic" && opts.username !== undefined) {
      auth.username = opts.username
    }
    if (type === "custom") {
      if (!opts.headerTemplate?.length) {
        throw usageError(
          "--auth custom needs at least one --header-template 'Name: {{ value }}'.",
        )
      }
      const headers: Record<string, string> = {}
      for (const t of opts.headerTemplate) {
        const colon = t.indexOf(":")
        if (colon <= 0) {
          throw usageError(
            `Invalid --header-template "${t}": expected 'Name: template'.`,
          )
        }
        headers[t.slice(0, colon).trim()] = t.slice(colon + 1).trim()
      }
      if (Object.keys(headers).length > 8) {
        throw usageError("At most 8 --header-template headers.")
      }
      auth.headers = headers
    }
  }
  if (!hosts.length) {
    throw usageError("Custom auth needs at least one --host to allow.")
  }
  if (hosts.length > 16) throw usageError("At most 16 --host entries.")
  return { auth, hosts }
}

function printSecret(s: SecretRow): void {
  printFields([
    ["Name", s.name],
    ["ID", s.id],
    ["Provider", s.provider_shortcut ?? undefined],
    ["Auth", s.auth_type],
    ["Auth config", JSON.stringify(s.auth_config)],
    ["Hosts", (s.hosts ?? []).join(", ")],
    ["Created", formatDate(s.created_at)],
    ["Updated", formatDate(s.updated_at)],
    ["Last used", s.last_used_at ? formatDate(s.last_used_at) : "never"],
  ])
}

export function register(program: Command): void {
  const secret = program
    .command("secret")
    .alias("secrets")
    .description(
      "Store credentials that sandboxes use without ever seeing the real value",
    )

  secret
    .command("create")
    .description("Store a secret")
    .argument("<name>", "Secret name, used when binding it to a sandbox")
    .option(
      "--provider <name>",
      "Built-in provider (sets auth and hosts); see `superserve provider list`",
    )
    .option(
      "--host <host>",
      "Allowed upstream host, e.g. api.example.com or *.example.com (repeatable)",
      collect,
    )
    .option(
      "--auth <type>",
      "How to attach the value: bearer, api-key, basic, custom",
    )
    .option("--header <name>", "Header name for --auth api-key")
    .option("--prefix <prefix>", "Value prefix for --auth api-key")
    .option("--username <user>", "Fixed username for --auth basic")
    .option(
      "--header-template <'Name: tmpl'>",
      "Header for --auth custom; reference the value as {{ value }} (repeatable)",
      collect,
    )
    .option(
      "-f, --file <path>",
      'JSON auth object, e.g. per-host rules: {"per_host": [...]}',
    )
    .addHelpText(
      "after",
      `
The value is read from a hidden prompt, or from stdin when piped. It is
never accepted as an argument and never shown again.

Examples:
  superserve secret create openai-prod --provider openai
  printf %s "$LINEAR_KEY" | superserve secret create linear \\
    --host api.linear.app --auth api-key --header Authorization
  superserve secret create gh --file github-auth.json   # hosts default to the per_host hosts`,
    )
    .action(async (name: string, opts: CreateOpts) => {
      checkSecretName(name)
      const fields = authFields(opts)
      if (opts.provider) await checkProvider(opts.provider)
      const value = await readValue(`Value for ${name}: `)
      const s = await apiRequest<SecretRow>("POST", "/secrets", {
        body: { name, value, ...fields },
      })
      if (isJson()) {
        printJson(s)
        return
      }
      success(
        `Created secret ${s.name} (${s.auth_type} → ${(s.hosts ?? []).join(", ")})`,
      )
      info(
        color.dim(
          `Bind it: superserve secret attach <sandbox> ENV_VAR ${s.name}`,
        ),
      )
    })

  secret
    .command("list")
    .alias("ls")
    .description("List secrets (metadata only)")
    .action(async () => {
      const rows = await apiRequest<SecretRow[]>("GET", "/secrets")
      if (isJson()) {
        printJson(rows)
        return
      }
      printTable(
        rows,
        [
          { header: "name", value: (s) => s.name },
          { header: "auth", value: (s) => s.auth_type },
          { header: "hosts", value: (s) => (s.hosts ?? []).join(",") },
          { header: "provider", value: (s) => s.provider_shortcut ?? "-" },
          {
            header: "last used",
            value: (s) =>
              s.last_used_at ? formatDate(s.last_used_at) : "never",
          },
          { header: "created", value: (s) => formatDate(s.created_at) },
        ],
        "No secrets.",
      )
    })

  secret
    .command("get")
    .description("Show a secret's metadata (the value is never returned)")
    .argument("<name>", "Secret name")
    .action(async (name: string) => {
      const s = await apiRequest<SecretRow>("GET", spath(name))
      if (isJson()) printJson(s)
      else printSecret(s)
    })

  secret
    .command("rotate")
    .description(
      "Replace a secret's value; bound sandboxes use it on their next request",
    )
    .argument("<name>", "Secret name")
    .addHelpText(
      "after",
      "\nThe new value is read from a hidden prompt, or from stdin when piped.",
    )
    .action(async (name: string) => {
      const value = await readValue(`New value for ${name}: `)
      const s = await apiRequest<SecretRow>("PATCH", spath(name), {
        body: { value },
      })
      if (isJson()) printJson(s)
      else success(`Rotated ${s.name}`)
    })

  secret
    .command("delete")
    .alias("rm")
    .description(
      "Delete secrets; sandboxes bound to them start failing immediately",
    )
    .argument("<name...>", "Secret names")
    .option("-y, --yes", "Skip the confirmation")
    .action(async (names: string[], opts: { yes?: boolean }) => {
      let bound = ""
      if (!opts.yes && isInteractive()) {
        // Only worth the round trips when someone will read the prompt.
        const counts = await Promise.all(
          names.map((n) =>
            apiRequest<BindingRow[]>("GET", `${spath(n)}/sandboxes`).then(
              (b) => b.length,
              () => 0,
            ),
          ),
        )
        const total = counts.reduce((a, b) => a + b, 0)
        if (total) {
          bound = ` ${total} bound sandbox${total === 1 ? "" : "es"} will start failing requests that use ${names.length === 1 ? "it" : "them"} immediately.`
        }
      }
      await confirm(
        `Delete secret${names.length === 1 ? "" : "s"} ${names.join(", ")}?${bound}`,
        opts.yes,
      )
      const results = await Promise.allSettled(
        names.map(async (n) => {
          try {
            await apiRequest("DELETE", spath(n))
          } catch (err) {
            // Already gone counts as deleted.
            if (!(err instanceof NotFoundError)) throw err
          }
        }),
      )
      reportBatch(names, names, results, (n) => `Deleted ${n}`, "deleted")
    })

  secret
    .command("audit")
    .description("Show outbound requests that used a secret, newest first")
    .argument("<name>", "Secret name")
    .option(
      "--status <class>",
      "Only 2xx, 3xx, 4xx or 5xx responses, or errors (requests that failed before reaching the service)",
    )
    .option("--limit <n>", "Events per page, 1-200", "50")
    .option("--before <id>", "Only events older than this event ID")
    .option("--all", "Fetch every page")
    .action(
      async (
        name: string,
        opts: {
          status?: string
          limit: string
          before?: string
          all?: boolean
        },
      ) => {
        if (opts.status && !AUDIT_STATUSES.includes(opts.status)) {
          throw usageError(
            `--status must be one of ${AUDIT_STATUSES.join(", ")}.`,
          )
        }
        const limit = parseInteger(opts.limit, "--limit", { min: 1, max: 200 })
        let before =
          opts.before !== undefined
            ? parseInteger(opts.before, "--before", { min: 1 })
            : undefined
        const rows: AuditRow[] = []
        for (;;) {
          const page = await apiRequest<AuditRow[]>(
            "GET",
            `${spath(name)}/audit`,
            {
              query: {
                status: opts.status,
                limit: String(limit),
                before: before?.toString(),
              },
            },
          )
          rows.push(...page)
          if (!opts.all || page.length < limit) break
          before = page[page.length - 1].id
        }
        if (isJson()) {
          printJson(rows)
          return
        }
        printTable(
          rows,
          [
            { header: "id", value: (e) => String(e.id) },
            { header: "time", value: (e) => formatDate(e.ts) },
            { header: "sandbox", value: (e) => e.sandbox_name ?? e.sandbox_id },
            { header: "method", value: (e) => e.method },
            { header: "host", value: (e) => e.host },
            { header: "path", value: (e) => e.path },
            {
              header: "status",
              value: (e) => String(e.status),
              style: (s, e) => (e.status >= 400 ? color.red(s) : s),
            },
            {
              header: "latency",
              value: (e) => (e.latency_ms != null ? `${e.latency_ms}ms` : "-"),
            },
            { header: "error", value: (e) => e.error_code ?? "" },
          ],
          "No requests have used this secret.",
        )
        if (!opts.all && rows.length === limit) {
          info(
            color.dim(
              `More may exist: --before ${rows[rows.length - 1].id}, or --all.`,
            ),
          )
        }
      },
    )

  secret
    .command("sandboxes")
    .description("List sandboxes a secret is bound to")
    .argument("<name>", "Secret name")
    .action(async (name: string) => {
      const rows = await apiRequest<BindingRow[]>(
        "GET",
        `${spath(name)}/sandboxes`,
      )
      if (isJson()) {
        printJson(rows)
        return
      }
      printTable(
        rows,
        [
          { header: "sandbox", value: (b) => b.sandbox_name },
          { header: "id", value: (b) => b.sandbox_id },
          { header: "env key", value: (b) => b.env_key },
          {
            header: "status",
            value: (b) => b.status,
            style: (s) => statusColor(s),
          },
        ],
        "Not bound to any sandbox.",
      )
    })

  const bindingNote = `
Bindings apply to processes started after the change; a process already
running keeps its environment. Detaching revokes the stand-in token, so a
running process loses access within about a minute. A paused sandbox applies
either change when it resumes.`

  secret
    .command("attach")
    .description("Bind a secret to a sandbox under an environment variable")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<ENV_KEY>", "Environment variable the sandbox sees")
    .argument("<secret-name>", "Secret to bind")
    .addHelpText("after", bindingNote)
    .action(async (ref: string, envKey: string, secretName: string) => {
      if (!ENV_KEY_RE.test(envKey)) {
        throw usageError(`Invalid environment variable name "${envKey}".`)
      }
      const id = await resolveSandboxId(ref)
      const res = await apiRequest<{ env_key: string; secret_name: string }>(
        "POST",
        `/sandboxes/${encodeURIComponent(id)}/secrets`,
        { body: { env_key: envKey, secret_name: secretName } },
      )
      if (isJson()) {
        printJson(res)
        return
      }
      success(`Bound ${secretName} to ${ref} as $${envKey}`)
      info(
        color.dim("New processes see it; restart running ones to pick it up."),
      )
    })

  secret
    .command("detach")
    .description("Remove a secret binding from a sandbox")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<ENV_KEY>", "Environment variable the secret is bound under")
    .addHelpText("after", bindingNote)
    .action(async (ref: string, envKey: string) => {
      const id = await resolveSandboxId(ref)
      await apiRequest(
        "DELETE",
        `/sandboxes/${encodeURIComponent(id)}/secrets/${encodeURIComponent(envKey)}`,
      )
      if (isJson()) printJson({ detached: envKey })
      else success(`Detached $${envKey} from ${ref}`)
    })

  program
    .command("provider")
    .alias("providers")
    .description("Built-in providers for `secret create --provider`")
    .command("list")
    .alias("ls")
    .description("List built-in providers")
    .action(async () => {
      const rows = await apiRequest<ProviderRow[]>("GET", "/providers")
      if (isJson()) {
        printJson(rows)
        return
      }
      printTable(
        rows,
        [
          { header: "name", value: (p) => p.name },
          { header: "hosts", value: (p) => (p.hosts ?? []).join(",") },
          { header: "auth", value: (p) => p.auth_type },
          { header: "token shape", value: (p) => p.token_shape },
        ],
        "No providers.",
      )
    })
}
