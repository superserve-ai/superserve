/** In-memory fake {@link SandboxClient} for tests (no network, no credentials). */

import { NotFoundError } from "@superserve/sdk"
import type { CommandResult, SandboxInfo, SandboxStatus } from "@superserve/sdk"

import type { SandboxClient, SandboxSummary } from "../src/client.js"
import type { DirEntry } from "../src/lib/listing.js"

interface FakeSandbox {
  id: string
  name: string
  status: SandboxStatus
  metadata: Record<string, string>
  files: Map<string, Uint8Array>
}

export interface FakeClient {
  client: SandboxClient
  sandboxes: Map<string, FakeSandbox>
}

export function createFakeClient(): FakeClient {
  const sandboxes = new Map<string, FakeSandbox>()
  let counter = 0

  const must = (id: string): FakeSandbox => {
    const sb = sandboxes.get(id)
    if (!sb) throw new NotFoundError(`Sandbox ${id} not found`)
    return sb
  }

  const summarize = (sb: FakeSandbox): SandboxSummary => ({
    id: sb.id,
    name: sb.name,
    status: sb.status,
    metadata: sb.metadata,
  })

  const client: SandboxClient = {
    async create(input) {
      const id = `sbx-${++counter}`
      const sb: FakeSandbox = {
        id,
        name: input.name ?? id,
        status: "active",
        metadata: input.metadata ?? {},
        files: new Map(),
      }
      sandboxes.set(id, sb)
      return summarize(sb)
    },

    async list(metadata) {
      let xs = [...sandboxes.values()]
      if (metadata) {
        xs = xs.filter((sb) =>
          Object.entries(metadata).every(([k, v]) => sb.metadata[k] === v),
        )
      }
      return xs.map(summarize)
    },

    async info(id) {
      const sb = must(id)
      const info: SandboxInfo = {
        id: sb.id,
        name: sb.name,
        status: sb.status,
        vcpuCount: 2,
        memoryMib: 2048,
        createdAt: new Date(0),
        timeoutSeconds: 3600,
        metadata: sb.metadata,
      }
      return info
    },

    async exec(id, command) {
      const sb = must(id)
      sb.status = "active"
      const result: CommandResult = command.startsWith("echo ")
        ? { stdout: `${command.slice(5)}\n`, stderr: "", exitCode: 0 }
        : { stdout: `ran: ${command}\n`, stderr: "", exitCode: 0 }
      return result
    },

    async readFile(id, path) {
      const sb = must(id)
      const data = sb.files.get(path)
      if (!data) throw new NotFoundError(`File ${path} not found`)
      return data
    },

    async writeFile(id, path, content) {
      const sb = must(id)
      sb.files.set(
        path,
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : content,
      )
    },

    async listDir(id, path) {
      const sb = must(id)
      const prefix = path.endsWith("/") ? path : `${path}/`
      const entries: DirEntry[] = []
      for (const [p, data] of sb.files) {
        if (!p.startsWith(prefix)) continue
        const rest = p.slice(prefix.length)
        if (rest.includes("/")) continue
        entries.push({
          name: rest,
          type: "file",
          size: data.byteLength,
          modified: new Date(0).toISOString(),
        })
      }
      return entries
    },

    async pause(id) {
      must(id).status = "paused"
    },

    async resume(id) {
      const sb = must(id)
      sb.status = "active"
      return summarize(sb)
    },

    async kill(id) {
      // Idempotent: deleting a missing sandbox is a no-op.
      sandboxes.delete(id)
    },
  }

  return { client, sandboxes }
}
