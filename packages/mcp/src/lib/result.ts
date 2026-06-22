/**
 * Helpers for building MCP tool results: every result carries a human-readable
 * `text` block plus machine-readable `structuredContent`, and large text is
 * truncated head+tail so it stays token-efficient.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"

export interface Truncation {
  text: string
  truncated: boolean
  /** Original size in bytes before any truncation. */
  bytes: number
}

/**
 * Truncate `text` to roughly `maxBytes`, keeping the head and tail with a
 * marker in between. Returns the (possibly unchanged) text plus whether it was
 * truncated and the original byte length.
 */
export function truncateText(text: string, maxBytes: number): Truncation {
  const bytes = Buffer.byteLength(text, "utf8")
  if (bytes <= maxBytes) {
    return { text, truncated: false, bytes }
  }
  // Budget characters from the byte cap (approximation is fine for a marker).
  const headChars = Math.floor(maxBytes * 0.6)
  const tailChars = Math.floor(maxBytes * 0.35)
  const head = text.slice(0, headChars)
  const tail = text.slice(text.length - tailChars)
  const dropped = bytes - Buffer.byteLength(head + tail, "utf8")
  return {
    text: `${head}\n… [${dropped} bytes truncated] …\n${tail}`,
    truncated: true,
    bytes,
  }
}

/** A successful tool result: text content + structured content. */
export function toolOk(
  text: string,
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  }
}

/** An error tool result. `isError` lets the model self-correct. */
export function toolError(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
  }
}
