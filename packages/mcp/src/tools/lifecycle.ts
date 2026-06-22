/**
 * Lifecycle + discovery tools:
 * `sandbox_create`, `sandbox_list`, `sandbox_info`,
 * `sandbox_pause`, `sandbox_resume`, `sandbox_kill`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { SandboxClient } from "../client.js"
import { formatSdkError } from "../lib/errors.js"
import { toolError, toolOk } from "../lib/result.js"
import { defineTool } from "../lib/tool.js"

const metadataRecord = z.record(z.string(), z.string())

interface CreateArgs {
  name?: string
  from_template?: string
  from_snapshot?: string
  timeout_seconds?: number
  metadata?: Record<string, string>
  env_vars?: Record<string, string>
}

interface ListArgs {
  metadata?: Record<string, string>
}

interface IdArg {
  sandbox_id: string
}

export function registerLifecycleTools(
  server: McpServer,
  client: SandboxClient,
): void {
  defineTool<CreateArgs>(
    server,
    "sandbox_create",
    {
      title: "Create a sandbox",
      description:
        "Create a new Superserve sandbox (a Firecracker microVM). Returns the sandbox id to use in " +
        "subsequent tool calls. The sandbox is active and ready immediately.",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe("Human-readable name (auto-generated if omitted)."),
        from_template: z
          .string()
          .optional()
          .describe("Template name or ID to base the sandbox on."),
        from_snapshot: z
          .string()
          .optional()
          .describe("Snapshot ID to restore the sandbox from."),
        timeout_seconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Idle timeout before the sandbox is auto-paused."),
        metadata: metadataRecord
          .optional()
          .describe("Arbitrary key/value tags for filtering in sandbox_list."),
        env_vars: metadataRecord
          .optional()
          .describe(
            "Environment variables available to commands in the sandbox.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      name,
      from_template,
      from_snapshot,
      timeout_seconds,
      metadata,
      env_vars,
    }) => {
      try {
        const s = await client.create({
          name,
          fromTemplate: from_template,
          fromSnapshot: from_snapshot,
          timeoutSeconds: timeout_seconds,
          metadata,
          envVars: env_vars,
        })
        return toolOk(
          `created sandbox ${s.id} (${s.name}), status ${s.status}`,
          { ...s },
        )
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<ListArgs>(
    server,
    "sandbox_list",
    {
      title: "List sandboxes",
      description:
        "List your sandboxes (active and paused), optionally filtered by metadata. " +
        "Returns ids, names, and statuses.",
      inputSchema: {
        metadata: metadataRecord
          .optional()
          .describe(
            "Filter to sandboxes whose metadata matches these key/values.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ metadata }) => {
      try {
        const sandboxes = await client.list(metadata)
        const text = sandboxes.length
          ? sandboxes.map((s) => `${s.id}  ${s.status}\t${s.name}`).join("\n")
          : "(no sandboxes)"
        return toolOk(text, { sandboxes })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<IdArg>(
    server,
    "sandbox_info",
    {
      title: "Get sandbox details",
      description:
        "Get current details (status, resources, metadata, timeout) for one sandbox by id. " +
        "Read-only — does not resume a paused sandbox.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id }) => {
      try {
        const i = await client.info(sandbox_id)
        const structured: Record<string, unknown> = {
          id: i.id,
          name: i.name,
          status: i.status,
          vcpu_count: i.vcpuCount,
          memory_mib: i.memoryMib,
          created_at: i.createdAt.toISOString(),
          metadata: i.metadata,
        }
        if (i.timeoutSeconds !== undefined) {
          structured.timeout_seconds = i.timeoutSeconds
        }
        return toolOk(
          `${i.id} (${i.name}) — ${i.status}, ${i.vcpuCount} vCPU / ${i.memoryMib} MiB`,
          structured,
        )
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<IdArg>(
    server,
    "sandbox_pause",
    {
      title: "Pause a sandbox",
      description:
        "Pause a sandbox to save resources. State is preserved; resume it, or just run a command " +
        "(exec auto-resumes).",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox to pause."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id }) => {
      try {
        await client.pause(sandbox_id)
        return toolOk(`paused ${sandbox_id}`, {
          id: sandbox_id,
          status: "paused",
        })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<IdArg>(
    server,
    "sandbox_resume",
    {
      title: "Resume a sandbox",
      description:
        "Explicitly resume a paused sandbox. Usually unnecessary — sandbox_exec and the file tools " +
        "auto-resume a paused sandbox.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox to resume."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id }) => {
      try {
        const s = await client.resume(sandbox_id)
        return toolOk(`resumed ${s.id}`, { id: s.id, status: "active" })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<IdArg>(
    server,
    "sandbox_kill",
    {
      title: "Delete a sandbox",
      description:
        "Permanently delete a sandbox and all its state. Irreversible. Idempotent — deleting an " +
        "already-deleted sandbox succeeds.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox to delete."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id }) => {
      try {
        await client.kill(sandbox_id)
        return toolOk(`deleted ${sandbox_id}`, {
          id: sandbox_id,
          deleted: true,
        })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )
}
