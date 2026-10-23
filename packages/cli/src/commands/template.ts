import { readFileSync } from "node:fs"

import {
  BuildError,
  ConflictError,
  NotFoundError,
  SandboxError,
  Template,
  TimeoutError,
  type BuildLogEvent,
} from "@superserve/sdk"
import type { Command } from "commander"

import { apiRequest, isUuid } from "../api"
import { confirm, parseDuration, parseInteger, readStdin } from "../args"
import { sdkOptions } from "../config"
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
  spinner,
  statusColor,
  success,
} from "../output"

interface TemplateRow {
  id: string
  name: string
  status: string
  vcpu: number
  memory_mib: number
  disk_mib: number
  size_bytes?: number
  error_message?: string
  created_at?: string
  built_at?: string
  build_id?: string
}

interface BuildRow {
  id: string
  template_id: string
  status: string
  error_message?: string
  started_at?: string
  finalized_at?: string
  created_at?: string
}

type Step =
  | { run: string }
  | { env: { key: string; value: string } }
  | { workdir: string }
  | { user: { name: string; sudo?: boolean } }

const NAME_RE = /^[a-z0-9]([a-z0-9._/-]*[a-z0-9])?$/
const USER_RE = /^[a-z_][a-z0-9_-]{0,30}$/
const IN_FLIGHT = new Set(["pending", "building", "snapshotting"])
const SPEC_KEYS = [
  "from",
  "steps",
  "start_cmd",
  "ready_cmd",
  "vcpu",
  "memory_mib",
  "disk_mib",
]

const tpath = (id: string) => `/templates/${encodeURIComponent(id)}`
const bpath = (id: string, buildId: string) =>
  `${tpath(id)}/builds/${encodeURIComponent(buildId)}`

/** An ID is used as-is; a name costs one list call. */
async function lookupTemplate(
  ref: string,
): Promise<{ id: string; row?: TemplateRow }> {
  if (isUuid(ref)) return { id: ref }
  const row = (
    await apiRequest<TemplateRow[]>("GET", "/templates", { query: { q: ref } })
  ).find((t) => t.name === ref)
  if (!row) {
    throw new CliError(
      `No template named "${ref}".`,
      EXIT.NOT_FOUND,
      "Run `superserve template list` to see your templates.",
      "not_found",
    )
  }
  return { id: row.id, row }
}

export async function resolveTemplateId(ref: string): Promise<string> {
  return (await lookupTemplate(ref)).id
}

/** `2048` / `2048M` / `2GiB` / `1.5G` → MiB. */
function parseMib(input: string, flag: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(m|mi|mib|mb|g|gi|gib|gb)?$/i.exec(input.trim())
  const mib = m ? Number(m[1]) * (/^g/i.test(m[2] ?? "") ? 1024 : 1) : NaN
  if (!Number.isInteger(mib)) {
    throw usageError(
      `Invalid ${flag} "${input}": use MiB (2048) or a size like 512M, 2G, 8GiB.`,
    )
  }
  return mib
}

function checkRange(v: unknown, what: string, min: number, max: number) {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
    throw usageError(`${what} must be an integer between ${min} and ${max}.`)
  }
}

function fmtMib(mib: number | undefined): string {
  if (mib === undefined) return "-"
  return mib % 1024 === 0 ? `${mib / 1024}G` : `${mib}M`
}

function validateStep(step: unknown, i: number): Step {
  const s = step as Record<string, unknown>
  const keys = s && typeof s === "object" ? Object.keys(s) : []
  const bad = (why: string) => usageError(`Build step ${i + 1}: ${why}`)
  if (
    keys.length !== 1 ||
    !["run", "env", "workdir", "user"].includes(keys[0])
  ) {
    throw bad("must have exactly one of run, env, workdir, user.")
  }
  const v = s[keys[0]] as Record<string, unknown>
  if (keys[0] === "run" || keys[0] === "workdir") {
    if (typeof v !== "string" || !v) throw bad(`${keys[0]} must be a string.`)
  } else if (keys[0] === "env") {
    if (typeof v?.key !== "string" || !v.key || typeof v.value !== "string") {
      throw bad("env must be { key, value } strings.")
    }
  } else {
    if (typeof v?.name !== "string" || !USER_RE.test(v.name)) {
      throw bad(
        "user.name must start with a lowercase letter or _, use only [a-z0-9_-], and be at most 31 chars.",
      )
    }
    if (v.sudo !== undefined && typeof v.sudo !== "boolean") {
      throw bad("user.sudo must be a boolean.")
    }
  }
  return s as Step
}

async function readSpecFile(path: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text =
      path === "-"
        ? (await readStdin()).toString("utf8")
        : readFileSync(path, "utf8")
  } catch (err) {
    throw usageError(`Cannot read ${path}: ${(err as Error).message}`)
  }
  let spec: unknown
  try {
    spec = JSON.parse(text)
  } catch (err) {
    throw usageError(`${path} is not valid JSON: ${(err as Error).message}`)
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw usageError(`${path} must contain a JSON object.`)
  }
  // Catches camelCase (startCmd) and SDK-shaped files that would silently drop.
  const unknown = Object.keys(spec).filter((k) => !SPEC_KEYS.includes(k))
  if (unknown.length) {
    throw usageError(
      `Unknown field(s) in ${path}: ${unknown.join(", ")}.`,
      `Allowed: ${SPEC_KEYS.join(", ")}.`,
    )
  }
  return spec as Record<string, unknown>
}

interface CreateOpts {
  file?: string
  from?: string
  sudo?: boolean
  startCmd?: string
  readyCmd?: string
  vcpu?: string
  memory?: string
  disk?: string
  wait: boolean
}

async function buildCreateBody(
  name: string,
  opts: CreateOpts,
  flagSteps: Step[],
): Promise<Record<string, unknown>> {
  // References that look like UUIDs are treated as IDs, never looked up by name.
  if (isUuid(name)) {
    throw usageError(`Template name "${name}" can't look like a template ID.`)
  }
  if (name.length > 128 || !NAME_RE.test(name)) {
    throw usageError(
      `Invalid template name "${name}".`,
      "Use lowercase letters, digits and . _ / - (start and end with a letter or digit, at most 128 chars).",
    )
  }
  if (name.startsWith("superserve/")) {
    throw usageError(`"superserve/" names are reserved for system templates.`)
  }
  if (opts.sudo && !flagSteps.some((s) => "user" in s)) {
    throw usageError("--sudo needs a --user.")
  }
  for (const s of flagSteps) if ("user" in s && opts.sudo) s.user.sudo = true
  const file = opts.file ? await readSpecFile(opts.file) : {}
  if (file.steps !== undefined && !Array.isArray(file.steps)) {
    throw usageError("steps must be an array.")
  }
  const steps = [...((file.steps as unknown[]) ?? []), ...flagSteps].map(
    validateStep,
  )
  const from = opts.from ?? file.from
  if (typeof from !== "string" || !from) {
    throw usageError(
      'A base image is required: pass --from <image> or set "from" in --file.',
    )
  }
  const buildSpec: Record<string, unknown> = { from }
  if (steps.length) buildSpec.steps = steps
  const startCmd = opts.startCmd ?? file.start_cmd
  const readyCmd = opts.readyCmd ?? file.ready_cmd
  if (startCmd !== undefined) buildSpec.start_cmd = startCmd
  if (readyCmd !== undefined) buildSpec.ready_cmd = readyCmd

  const body: Record<string, unknown> = { name, build_spec: buildSpec }
  const vcpu =
    opts.vcpu !== undefined ? parseInteger(opts.vcpu, "--vcpu") : file.vcpu
  const memory =
    opts.memory !== undefined
      ? parseMib(opts.memory, "--memory")
      : file.memory_mib
  const disk =
    opts.disk !== undefined ? parseMib(opts.disk, "--disk") : file.disk_mib
  if (vcpu !== undefined) {
    checkRange(vcpu, "vcpu", 1, 32)
    body.vcpu = vcpu
  }
  if (memory !== undefined) {
    checkRange(memory, "Memory (MiB)", 256, 131_072)
    body.memory_mib = memory
  }
  if (disk !== undefined) {
    checkRange(disk, "Disk (MiB)", 1024, 131_072)
    body.disk_mib = disk
  }
  return body
}

function logWriter(out: NodeJS.WriteStream): (ev: BuildLogEvent) => void {
  const c = color.createColors(Boolean(out.isTTY) && color.isColorSupported)
  return (ev) => {
    const text = ev.text.replace(/\n$/, "")
    const styled =
      ev.stream === "system"
        ? c.cyan(text)
        : ev.stream === "stderr"
          ? c.yellow(text)
          : text
    out.write(`${styled}\n`)
  }
}

/** Resolves after `ms` or on abort, whichever is first; never leaves a listener behind. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
}

/** Ctrl-C aborts `fn` (stop watching) instead of killing the process. */
async function onInterrupt<T>(
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ac = new AbortController()
  const handler = () => ac.abort()
  process.once("SIGINT", handler)
  try {
    return await fn(ac.signal)
  } finally {
    process.off("SIGINT", handler)
  }
}

function stoppedFollowing(ref: string, buildId: string): CliError {
  return new CliError(
    "Stopped following. The build continues on the server.",
    EXIT.INTERRUPTED,
    `Watch it:  superserve template logs ${ref} --build ${buildId} -f\nCancel it: superserve template cancel ${ref} ${buildId}`,
    "interrupted",
  )
}

// Same "<code>: <detail>" convention the SDK's waitUntilReady parses.
function buildFailure(templateId: string, build: BuildRow): BuildError {
  const m = /^(\w+):\s*(.+)$/s.exec(build.error_message ?? "")
  const code = m?.[1] ?? "build_failed"
  const detail = m?.[2].trim() ?? build.error_message ?? "no details"
  return new BuildError(`Build failed (${code}): ${detail}`, {
    code,
    buildId: build.id,
    templateId,
  })
}

// The build row decides the outcome (SSE says "ready" slightly early), and the
// SDK's waitUntilReady can't target a specific build ID.
async function waitForBuild(
  ref: string,
  templateId: string,
  buildId: string,
  {
    logs,
    timeoutSec,
    known,
  }: { logs: boolean; timeoutSec?: number; known?: BuildRow },
): Promise<TemplateRow> {
  const deadline =
    timeoutSec === undefined ? Infinity : Date.now() + timeoutSec * 1000
  const timedOut = (status: string) =>
    new CliError(
      `Timed out after ${timeoutSec}s; the build is still ${status}.`,
      EXIT.TIMEOUT,
      `The build continues. Check again: superserve template wait ${ref}`,
      "timeout",
    )
  return onInterrupt(async (interrupted) => {
    const logAbort = new AbortController()
    let streamed: Promise<void> = Promise.resolve()
    if (logs) {
      const tpl = await Template.connect(templateId, {
        ...sdkOptions(),
        signal: interrupted,
      })
      // Best effort: a dropped stream never fails the wait.
      streamed = tpl
        .streamBuildLogs({
          buildId,
          signal: AbortSignal.any([interrupted, logAbort.signal]),
          onEvent: logWriter(process.stderr),
        })
        .catch(() => {})
    }
    const spin = logs ? undefined : spinner("Waiting for the build")
    try {
      // A row the caller already fetched answers the first check, so
      // --timeout 0 still reports a build that has already finished.
      let first = known
      for (;;) {
        if (interrupted.aborted) throw stoppedFollowing(ref, buildId)
        // Ctrl-C and the deadline also cut a slow poll short.
        const signal = Number.isFinite(deadline)
          ? AbortSignal.any([
              interrupted,
              AbortSignal.timeout(Math.max(deadline - Date.now(), 0)),
            ])
          : interrupted
        let build: BuildRow
        try {
          build =
            first ??
            (await apiRequest<BuildRow>("GET", bpath(templateId, buildId), {
              signal,
            }))
          first = undefined
        } catch (err) {
          if (interrupted.aborted) throw stoppedFollowing(ref, buildId)
          if (Date.now() >= deadline) throw timedOut("building")
          throw err
        }
        if (!IN_FLIGHT.has(build.status)) {
          // Let the log tail arrive; the stream closes itself at terminal.
          const tail = new AbortController()
          await Promise.race([
            streamed,
            sleep(3000, AbortSignal.any([interrupted, tail.signal])),
          ])
          // Stop the losing timer so it can't hold the process open.
          tail.abort()
          if (build.status === "failed") throw buildFailure(templateId, build)
          if (build.status === "cancelled") {
            throw new CliError(
              "The build was cancelled.",
              EXIT.ERROR,
              undefined,
              "cancelled",
            )
          }
          return await apiRequest<TemplateRow>("GET", tpath(templateId), {
            signal: interrupted,
          })
        }
        if (Date.now() >= deadline) throw timedOut(build.status)
        await sleep(Math.min(2000, deadline - Date.now()), interrupted)
      }
    } finally {
      spin?.stop()
      logAbort.abort()
      await streamed
    }
  })
}

function reportReady(tpl: TemplateRow): void {
  if (isJson()) {
    printJson(tpl)
    return
  }
  const size =
    tpl.size_bytes !== undefined ? ` (${formatBytes(tpl.size_bytes)})` : ""
  success(`Template ${tpl.name} is ready${size}.`)
}

async function followNewBuild(
  ref: string,
  templateId: string,
  buildId: string,
): Promise<void> {
  info(
    color.dim(
      `Build ${buildId} queued. Ctrl-C stops watching; the build keeps going.`,
    ),
  )
  // JSON mode keeps stderr clean, so no live logs there.
  reportReady(await waitForBuild(ref, templateId, buildId, { logs: !isJson() }))
}

async function latestBuild(templateId: string): Promise<BuildRow | undefined> {
  return (
    await apiRequest<BuildRow[]>("GET", `${tpath(templateId)}/builds`, {
      query: { limit: "1" },
    })
  )[0]
}

function noBuilds(ref: string): CliError {
  return new CliError(
    `Template ${ref} has no builds.`,
    EXIT.NOT_FOUND,
    `Start one: superserve template rebuild ${ref}`,
    "not_found",
  )
}

function duration(b: BuildRow): string {
  if (!b.started_at) return "-"
  const end = b.finalized_at ? Date.parse(b.finalized_at) : Date.now()
  return `${Math.max(0, Math.round((end - Date.parse(b.started_at)) / 1000))}s`
}

function printQueued(
  fields: [string, string | undefined][],
  ref: string,
): void {
  printFields(fields)
  info(color.dim(`Follow it: superserve template logs ${ref} -f`))
}

export function register(program: Command): void {
  const template = program
    .command("template")
    .alias("templates")
    .description("Build and manage templates (reusable sandbox images)")

  // Commander keeps one value per option and loses the order between --run,
  // --env, --workdir and --user; option events fire in command-line order.
  const flagSteps: Step[] = []
  const create = template
    .command("create")
    .description("Create a template and build it, streaming the build log")
    .argument("<name>", "Template name, unique in your team")
    .option(
      "-f, --file <path>",
      "JSON build spec: BuildSpec fields plus vcpu, memory_mib, disk_mib (- for stdin)",
    )
    .option("--from <image>", "Base OCI image, e.g. python:3.11 (linux/amd64)")
    .option("--run <cmd>", "Build step: run a shell command (repeatable)")
    .option(
      "--env <KEY=VALUE>",
      "Build step: set an env var for later steps and sandboxes (repeatable)",
    )
    .option(
      "--workdir <dir>",
      "Build step: working directory for later steps and sandboxes",
    )
    .option(
      "--user <name>",
      "Build step: run later steps and sandboxes as this user (created if missing)",
    )
    .option("--sudo", "Give the --user passwordless sudo")
    .option(
      "--start-cmd <cmd>",
      "Process started after the build, captured running in the snapshot",
    )
    .option(
      "--ready-cmd <cmd>",
      "Readiness probe polled after --start-cmd until it exits 0",
    )
    .option("--vcpu <n>", "vCPUs, 1-32 (default 1)")
    .option(
      "--memory <size>",
      "Memory in MiB or with a unit, e.g. 2G; 256M-128G (default 1G)",
    )
    .option(
      "--disk <size>",
      "Disk in MiB or with a unit, e.g. 8G; 1G-128G (default 4G)",
    )
    .option("--no-wait", "Return once the build is queued")
    .addHelpText(
      "after",
      `
Build steps run in command-line order, after any steps from --file. Flags
override the file's other fields. The file is JSON (YAML is not supported):
  {"from": "python:3.11", "steps": [{"run": "pip install numpy"}],
   "start_cmd": "python -m http.server 8000", "memory_mib": 2048}

Examples:
  superserve template create py-data --from python:3.11 \\
    --run "pip install numpy pandas" --env DEBUG=1 --workdir /app
  superserve template create web -f template.json --memory 2G --no-wait`,
    )
    .action(async (name: string, opts: CreateOpts) => {
      const body = await buildCreateBody(name, opts, flagSteps)
      const res = await apiRequest<TemplateRow>("POST", "/templates", { body })
      if (opts.wait) {
        await followNewBuild(name, res.id, res.build_id as string)
      } else if (isJson()) {
        printJson(res)
      } else {
        printQueued(
          [
            ["Template", res.id],
            ["Build", res.build_id],
            ["Status", res.status],
          ],
          name,
        )
      }
    })
  create.on("option:run", (v: string) => flagSteps.push({ run: v }))
  create.on("option:workdir", (v: string) => flagSteps.push({ workdir: v }))
  create.on("option:user", (v: string) => flagSteps.push({ user: { name: v } }))
  create.on("option:env", (v: string) => {
    const eq = v.indexOf("=")
    if (eq <= 0) throw usageError(`Invalid --env "${v}": expected KEY=VALUE.`)
    flagSteps.push({ env: { key: v.slice(0, eq), value: v.slice(eq + 1) } })
  })

  template
    .command("list")
    .alias("ls")
    .description("List your team's templates and the system templates")
    .option("--team", "Only your team's templates")
    .option("--system", "Only system (superserve/*) templates")
    .action(async (opts: { team?: boolean; system?: boolean }) => {
      if (opts.team && opts.system) {
        throw usageError("--team and --system are mutually exclusive.")
      }
      const owner = opts.team ? "team" : opts.system ? "system" : undefined
      const rows = await apiRequest<TemplateRow[]>("GET", "/templates", {
        query: { owner },
      })
      if (isJson()) {
        printJson(rows)
        return
      }
      printTable(
        rows,
        [
          { header: "name", value: (t) => t.name },
          { header: "id", value: (t) => t.id },
          {
            header: "status",
            value: (t) => t.status,
            style: (s) => statusColor(s),
          },
          {
            header: "cpu/mem/disk",
            value: (t) =>
              `${t.vcpu}/${fmtMib(t.memory_mib)}/${fmtMib(t.disk_mib)}`,
          },
          { header: "size", value: (t) => formatBytes(t.size_bytes) },
          { header: "built", value: (t) => formatDate(t.built_at) },
        ],
        "No templates.",
      )
    })

  template
    .command("get")
    .description("Show a template")
    .argument("<template>", "Template name or ID")
    .action(async (ref: string) => {
      const found = await lookupTemplate(ref)
      const t =
        found.row ?? (await apiRequest<TemplateRow>("GET", tpath(found.id)))
      if (isJson()) {
        printJson(t)
        return
      }
      printFields([
        ["Name", t.name],
        ["ID", t.id],
        ["Status", t.status, statusColor],
        ["vCPU", String(t.vcpu)],
        ["Memory", fmtMib(t.memory_mib)],
        ["Disk", fmtMib(t.disk_mib)],
        [
          "Size",
          t.size_bytes !== undefined ? formatBytes(t.size_bytes) : undefined,
        ],
        ["Error", t.error_message],
        ["Created", t.created_at && formatDate(t.created_at)],
        ["Built", t.built_at && formatDate(t.built_at)],
      ])
    })

  template
    .command("delete")
    .alias("rm")
    .description("Delete templates")
    .argument("<template...>", "Template names or IDs")
    .option("-y, --yes", "Skip the confirmation")
    .action(async (refs: string[], opts: { yes?: boolean }) => {
      const ids = await Promise.all(refs.map(resolveTemplateId))
      await confirm(
        refs.length === 1
          ? `Delete template ${refs[0]}?`
          : `Delete ${refs.length} templates (${refs.join(", ")})?`,
        opts.yes,
      )
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          try {
            await apiRequest("DELETE", tpath(id))
          } catch (err) {
            if (err instanceof ConflictError) {
              throw new CliError(
                err.message,
                EXIT.CONFLICT,
                "Active or paused sandboxes created from it, or an in-flight build, block deletion. Delete those sandboxes or cancel the build (superserve template cancel), then retry.",
                err.code ?? "conflict",
              )
            }
            // Already gone counts as deleted.
            if (!(err instanceof NotFoundError)) throw err
          }
        }),
      )
      reportBatch(ids, refs, results, (ref) => `Deleted ${ref}`, "deleted")
    })

  template
    .command("rebuild")
    .description(
      "Start a new build (returns the in-flight build if one is running)",
    )
    .argument("<template>", "Template name or ID")
    .option("--no-wait", "Return once the build is queued")
    .action(async (ref: string, opts: { wait: boolean }) => {
      const id = await resolveTemplateId(ref)
      const build = await apiRequest<BuildRow>("POST", `${tpath(id)}/builds`)
      if (opts.wait) await followNewBuild(ref, id, build.id)
      else if (isJson()) printJson(build)
      else {
        printQueued(
          [
            ["Build", build.id],
            ["Status", build.status],
          ],
          ref,
        )
      }
    })

  template
    .command("builds")
    .description("List a template's builds, newest first")
    .argument("<template>", "Template name or ID")
    .option("--limit <n>", "Builds to show, 1-100", "20")
    .action(async (ref: string, opts: { limit: string }) => {
      const limit = parseInteger(opts.limit, "--limit", { min: 1, max: 100 })
      const id = await resolveTemplateId(ref)
      const rows = await apiRequest<BuildRow[]>("GET", `${tpath(id)}/builds`, {
        query: { limit: String(limit) },
      })
      if (isJson()) {
        printJson(rows)
        return
      }
      printTable(
        rows,
        [
          { header: "id", value: (b) => b.id },
          {
            header: "status",
            value: (b) => b.status,
            style: (s) => statusColor(s),
          },
          { header: "created", value: (b) => formatDate(b.created_at) },
          { header: "duration", value: duration },
          { header: "error", value: (b) => b.error_message ?? "" },
        ],
        "No builds.",
      )
    })

  template
    .command("build")
    .description("Show one build of a template")
    .argument("<template>", "Template name or ID")
    .argument("<build-id>", "Build ID")
    .action(async (ref: string, buildId: string) => {
      const id = await resolveTemplateId(ref)
      const b = await apiRequest<BuildRow>("GET", bpath(id, buildId))
      if (isJson()) {
        printJson(b)
        return
      }
      printFields([
        ["ID", b.id],
        ["Template", b.template_id],
        ["Status", b.status, statusColor],
        ["Error", b.error_message],
        ["Created", b.created_at && formatDate(b.created_at)],
        ["Started", b.started_at && formatDate(b.started_at)],
        ["Finished", b.finalized_at && formatDate(b.finalized_at)],
        ["Duration", duration(b)],
      ])
    })

  template
    .command("cancel")
    .description("Cancel an in-flight build (default: the latest build)")
    .argument("<template>", "Template name or ID")
    .argument("[build-id]", "Build ID")
    .action(async (ref: string, buildId?: string) => {
      const id = await resolveTemplateId(ref)
      if (!buildId) {
        const latest = await latestBuild(id)
        if (!latest || !IN_FLIGHT.has(latest.status)) {
          if (isJson()) printJson({ cancelled: null })
          else info(`No build of ${ref} is in progress.`)
          return
        }
        buildId = latest.id
      }
      await apiRequest("DELETE", bpath(id, buildId))
      if (isJson()) printJson({ cancelled: buildId })
      else success(`Cancelled build ${buildId}`)
    })

  template
    .command("logs")
    .description(
      "Stream a running build's log (default: the latest build); logs aren't kept after a build ends",
    )
    .argument("<template>", "Template name or ID")
    .option("--build <id>", "Build ID")
    .option("-f, --follow", "Keep streaming until the build finishes")
    .addHelpText(
      "after",
      "\nThe log goes to stdout; with --json, one event per line.",
    )
    .action(async (ref: string, opts: { build?: string; follow?: boolean }) => {
      const id = await resolveTemplateId(ref)
      const build = opts.build
        ? await apiRequest<BuildRow>("GET", bpath(id, opts.build))
        : await latestBuild(id)
      if (!build) throw noBuilds(ref)
      // The API streams logs only while a build runs; nothing is kept after.
      if (!IN_FLIGHT.has(build.status)) {
        info(
          `Build ${build.id} is ${build.status}; logs are only available while a build runs.`,
        )
        if (build.error_message) info(build.error_message)
        return
      }
      const tpl = await Template.connect(id, sdkOptions())
      const write = isJson()
        ? (ev: BuildLogEvent) => process.stdout.write(`${JSON.stringify(ev)}\n`)
        : logWriter(process.stdout)
      // The stream replays history then goes live with no marker
      // between; without --follow on a running build, stop once it goes quiet.
      const stopWhenQuiet = !opts.follow && IN_FLIGHT.has(build.status)
      await onInterrupt(async (interrupted) => {
        const quiet = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        // A slow connect gets 10s; once events flow, 1.5s of quiet ends it.
        const arm = (ms: number) => {
          if (!stopWhenQuiet) return
          clearTimeout(timer)
          timer = setTimeout(() => quiet.abort(), ms)
        }
        arm(10_000)
        // A stream can end before the build does (a proxy or server restart);
        // with --follow, reconnect while it runs. Each connection replays the
        // history from the start, so skip up to what was already printed.
        let last = -1
        let printedAtLast = 0
        try {
          for (;;) {
            let replayedAtLast = 0
            const stream = tpl.streamBuildLogs({
              buildId: build.id,
              signal: AbortSignal.any([interrupted, quiet.signal]),
              onEvent: (ev) => {
                const at = ev.timestamp.getTime()
                if (at < last) return
                if (at === last) {
                  if (++replayedAtLast <= printedAtLast) return
                  printedAtLast++
                } else {
                  last = at
                  printedAtLast = 1
                  replayedAtLast = 1
                }
                write(ev)
                arm(1500)
              },
            })
            // With --follow, an idle timeout (a long silent step) or a dropped
            // connection is a reconnect, like a clean end of stream.
            await (opts.follow
              ? stream.catch((err) => {
                  // Transport failures (reset, proxy drop) carry no HTTP status;
                  // API errors do, and those stay fatal.
                  const transient =
                    err instanceof TimeoutError ||
                    (err instanceof SandboxError &&
                      err.statusCode === undefined)
                  if (interrupted.aborted || !transient) throw err
                })
              : stream)
            if (!opts.follow) break
            const now = await apiRequest<BuildRow>("GET", bpath(id, build.id), {
              signal: interrupted,
            })
            if (!IN_FLIGHT.has(now.status)) break
            await sleep(2000, interrupted)
          }
        } catch (err) {
          if (interrupted.aborted) throw stoppedFollowing(ref, build.id)
          if (!quiet.signal.aborted || !(err instanceof SandboxError)) throw err
          info(
            color.dim(
              `The build is still ${build.status}. Follow it: superserve template logs ${ref} -f`,
            ),
          )
        } finally {
          clearTimeout(timer)
        }
      })
    })

  template
    .command("wait")
    .description(
      "Wait for the latest build to finish; exits non-zero unless it is ready",
    )
    .argument("<template>", "Template name or ID")
    .option("--timeout <duration>", "Give up after this long, e.g. 10m")
    .action(async (ref: string, opts: { timeout?: string }) => {
      const timeoutSec =
        opts.timeout !== undefined
          ? parseDuration(opts.timeout, "--timeout")
          : undefined
      const id = await resolveTemplateId(ref)
      const build = await latestBuild(id)
      if (!build) throw noBuilds(ref)
      reportReady(
        await waitForBuild(ref, id, build.id, {
          logs: false,
          timeoutSec,
          known: build,
        }),
      )
    })
}
