/**
 * The platform surface the MCP tools depend on, plus the real implementation
 * backed by `@superserve/sdk`.
 *
 * Tools talk to {@link SandboxClient} (not the SDK directly) so they can be
 * tested against an in-memory fake. The real client reuses the SDK, which keeps
 * the per-sandbox data-plane access token internal and rotates it on resume —
 * the MCP server only ever holds the control-plane API key.
 *
 * Targeting is per-call `sandbox_id` → `Sandbox.connect(id)`, which activates
 * (auto-resuming a paused sandbox) and rotates the token. No cross-call session
 * cache: each call reconnects so the token is always fresh (the SDK's file ops
 * do not auto-retry on a stale token).
 */

import { NotFoundError, Sandbox, SandboxError, Template } from "@superserve/sdk"
import type { CommandResult, SandboxInfo, TemplateInfo } from "@superserve/sdk"

import type { ClientConfig } from "./config.js"
import {
  buildFallbackCommand,
  buildFindCommand,
  buildLsCommand,
  type DirEntry,
  parseFindOutput,
  parseLsOutput,
  validateAbsolutePath,
} from "./lib/listing.js"

export interface SandboxSummary {
  id: string
  name: string
  status: string
  metadata: Record<string, string>
}

export interface TemplateSummary {
  id: string
  name: string
  status: string
  vcpu: number
  memoryMib: number
  diskMib: number
}

export interface CreateInput {
  name?: string
  fromTemplate?: string
  fromSnapshot?: string
  timeoutSeconds?: number
  metadata?: Record<string, string>
  envVars?: Record<string, string>
}

export interface ExecInput {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

export interface SandboxClient {
  create(input: CreateInput): Promise<SandboxSummary>
  list(metadata?: Record<string, string>): Promise<SandboxSummary[]>
  listTemplates(namePrefix?: string): Promise<TemplateSummary[]>
  info(id: string): Promise<SandboxInfo>
  exec(id: string, command: string, opts: ExecInput): Promise<CommandResult>
  readFile(id: string, path: string): Promise<Uint8Array>
  writeFile(
    id: string,
    path: string,
    content: string | Uint8Array,
  ): Promise<void>
  listDir(id: string, path: string): Promise<DirEntry[]>
  pause(id: string): Promise<void>
  resume(id: string): Promise<SandboxSummary>
  kill(id: string): Promise<void>
}

function defaultName(): string {
  return `sandbox-${Date.now().toString(36)}`
}

function toSummary(s: SandboxInfo): SandboxSummary {
  return { id: s.id, name: s.name, status: s.status, metadata: s.metadata }
}

function toTemplateSummary(t: TemplateInfo): TemplateSummary {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    vcpu: t.vcpu,
    memoryMib: t.memoryMib,
    diskMib: t.diskMib,
  }
}

/** Real client backed by `@superserve/sdk`. */
export function createSdkClient(config: ClientConfig): SandboxClient {
  const conn = { apiKey: config.apiKey, baseUrl: config.baseUrl }

  return {
    async create(input) {
      const sb = await Sandbox.create({
        name: input.name ?? defaultName(),
        fromTemplate: input.fromTemplate,
        fromSnapshot: input.fromSnapshot,
        timeoutSeconds: input.timeoutSeconds,
        metadata: input.metadata,
        envVars: input.envVars,
        ...conn,
      })
      return {
        id: sb.id,
        name: sb.name,
        status: sb.status,
        metadata: sb.metadata,
      }
    },

    async list(metadata) {
      const xs = await Sandbox.list({ metadata, ...conn })
      return xs.map(toSummary)
    },

    // Control-plane, team-scoped (API key) — templates are not sandbox output.
    async listTemplates(namePrefix) {
      const xs = await Template.list({ namePrefix, ...conn })
      return xs.map(toTemplateSummary)
    },

    // Read-only: resolved via list() so it never resumes a paused sandbox
    // (the SDK has no static single-sandbox get, and connect() would activate).
    async info(id) {
      const xs = await Sandbox.list({ ...conn })
      const found = xs.find((s) => s.id === id)
      if (!found) throw new NotFoundError(`Sandbox ${id} not found`)
      return found
    },

    async exec(id, command, opts) {
      const sb = await Sandbox.connect(id, conn)
      return sb.commands.run(command, opts)
    },

    async readFile(id, path) {
      const sb = await Sandbox.connect(id, conn)
      return sb.files.read(path)
    },

    async writeFile(id, path, content) {
      const sb = await Sandbox.connect(id, conn)
      await sb.files.write(path, content)
    },

    async listDir(id, path) {
      validateAbsolutePath(path)
      const sb = await Sandbox.connect(id, conn)
      const found = await sb.commands.run(buildFindCommand(path))
      if (found.exitCode === 0) return parseFindOutput(found.stdout)
      // `find -printf` unavailable (e.g. BusyBox) — fall back to `ls`.
      const ls = await sb.commands.run(buildLsCommand(path))
      if (ls.exitCode === 0) return parseLsOutput(ls.stdout)
      // Neither GNU find nor `ls --time-style` (e.g. BusyBox/Alpine): last
      // resort is a pure-POSIX shell loop, parsed like find's output.
      const posix = await sb.commands.run(buildFallbackCommand(path))
      if (posix.exitCode === 0) return parseFindOutput(posix.stdout)
      const detail = (found.stderr || ls.stderr || posix.stderr || "").trim()
      throw new SandboxError(
        `Could not list ${path}${detail ? `: ${detail}` : ""}`,
      )
    },

    async pause(id) {
      const sb = await Sandbox.connect(id, conn)
      await sb.pause()
    },

    // connect() performs the activate/resume; that alone guarantees active.
    async resume(id) {
      const sb = await Sandbox.connect(id, conn)
      return {
        id: sb.id,
        name: sb.name,
        status: "active",
        metadata: sb.metadata,
      }
    },

    async kill(id) {
      await Sandbox.killById(id, conn)
    },
  }
}
