/** `sandbox_files_read`, `sandbox_files_write`, `sandbox_files_list`. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { SandboxClient } from "../client.js"
import { MAX_FILE_BYTES } from "../constants.js"
import { formatSdkError } from "../lib/errors.js"
import { toolError, toolOk } from "../lib/result.js"
import { defineTool } from "../lib/tool.js"

type Encoding = "text" | "base64"

interface ReadArgs {
  sandbox_id: string
  path: string
  encoding: Encoding
}

interface WriteArgs {
  sandbox_id: string
  path: string
  content: string
  encoding: Encoding
}

interface ListArgs {
  sandbox_id: string
  path: string
}

const encoding = z
  .enum(["text", "base64"])
  .default("text")
  .describe('"text" for UTF-8 (default), "base64" for binary content.')

const absolutePath = z
  .string()
  .describe('Absolute path inside the sandbox, e.g. "/app/main.py".')

export function registerFileTools(
  server: McpServer,
  client: SandboxClient,
): void {
  defineTool<ReadArgs>(
    server,
    "sandbox_files_read",
    {
      title: "Read a file from a sandbox",
      description:
        "Read a file from a sandbox. Returns UTF-8 text by default, or base64 when encoding is set to base64 " +
        "(use it for binary files). Large files are truncated.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
        path: absolutePath,
        encoding,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, path, encoding: enc }) => {
      try {
        const bytes = await client.readFile(sandbox_id, path)
        const truncated = bytes.byteLength > MAX_FILE_BYTES
        const slice = truncated ? bytes.subarray(0, MAX_FILE_BYTES) : bytes
        const content =
          enc === "base64"
            ? Buffer.from(slice).toString("base64")
            : new TextDecoder().decode(slice)
        const structured = {
          path,
          content,
          encoding: enc,
          bytes: bytes.byteLength,
          truncated,
        }
        const note = truncated ? " (truncated)" : ""
        return toolOk(
          `read ${bytes.byteLength} bytes from ${path}${note}\n${content}`,
          structured,
        )
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<WriteArgs>(
    server,
    "sandbox_files_write",
    {
      title: "Write a file to a sandbox",
      description:
        "Write a file to a sandbox, creating or overwriting it. Parent directories are created automatically. " +
        "Set encoding to base64 to write binary content.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
        path: absolutePath,
        content: z
          .string()
          .describe(
            "File content (UTF-8 text, or base64 when encoding=base64).",
          ),
        encoding,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, path, content, encoding: enc }) => {
      try {
        const data =
          enc === "base64"
            ? new Uint8Array(Buffer.from(content, "base64"))
            : content
        await client.writeFile(sandbox_id, path, data)
        const bytes =
          typeof data === "string"
            ? Buffer.byteLength(data, "utf8")
            : data.byteLength
        return toolOk(`wrote ${bytes} bytes to ${path}`, { path, bytes })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )

  defineTool<ListArgs>(
    server,
    "sandbox_files_list",
    {
      title: "List a directory in a sandbox",
      description:
        "List directory contents in a sandbox. Returns name, type (file/directory/symlink), size, and " +
        "modification time for each entry.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the sandbox."),
        path: absolutePath.describe(
          'Absolute directory path to list, e.g. "/app".',
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sandbox_id, path }) => {
      try {
        const entries = await client.listDir(sandbox_id, path)
        const text = entries.length
          ? entries
              .map(
                (e) =>
                  `${e.type === "directory" ? "d" : "-"} ${e.size}\t${e.name}`,
              )
              .join("\n")
          : "(empty directory)"
        return toolOk(`${path}\n${text}`, { path, entries })
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )
}
