/**
 * Bounded request-body reading for the hosted (HTTP) Superserve MCP server.
 *
 * The hosted server is multi-tenant: an authenticated but untrusted caller can
 * POST an arbitrarily large JSON-RPC body (e.g. a huge `sandbox_files_write`
 * payload) and exhaust the serverless/container process before Zod/tool
 * validation ever runs. Both HTTP entry points read the body through these
 * helpers, which stop pulling bytes the moment the running total exceeds the
 * cap — mirroring the SDK's own data-plane `readBodyWithLimit` defense.
 *
 * Transport-agnostic: the Node reader imports `node:http`'s `IncomingMessage`
 * as a type only, so importing this module never pulls `node:http` into the
 * Web / edge bundle.
 */

import type { IncomingMessage } from "node:http"

/** Outcome of a capped body read: the buffered bytes, or a too-large signal. */
export type CappedBody = { ok: true; bytes: Uint8Array } | { ok: false }

/** Shown when a request body exceeds the configured cap. */
export const PAYLOAD_TOO_LARGE_MESSAGE =
  "Request body too large. Inline tool-call content is size-limited — upload " +
  "large files with the Superserve SDK/CLI instead of embedding them in a request."

function joinChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** True when a present, parseable Content-Length already exceeds the cap. */
function contentLengthExceeds(
  header: string | null | undefined,
  maxBytes: number,
): boolean {
  if (!header) return false
  const n = Number(header)
  return Number.isFinite(n) && n > maxBytes
}

/**
 * Read a Web `Request` body, refusing to buffer more than `maxBytes`. Cancels
 * the stream as soon as the running total exceeds the cap.
 */
export async function readWebRequestBody(
  req: Request,
  maxBytes: number,
): Promise<CappedBody> {
  if (contentLengthExceeds(req.headers.get("content-length"), maxBytes)) {
    return { ok: false }
  }
  if (!req.body) {
    const buf = new Uint8Array(await req.arrayBuffer())
    return buf.byteLength > maxBytes ? { ok: false } : { ok: true, bytes: buf }
  }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return { ok: false }
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return { ok: true, bytes: joinChunks(chunks, total) }
}

/**
 * Read a Node `IncomingMessage` body, refusing to buffer more than `maxBytes`.
 * Destroys the stream as soon as the running total exceeds the cap; rejects on a
 * genuine stream error so the caller can map it to a 500.
 */
export function readNodeRequestBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<CappedBody> {
  if (contentLengthExceeds(req.headers["content-length"], maxBytes)) {
    return Promise.resolve({ ok: false })
  }
  return new Promise<CappedBody>((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let total = 0
    let settled = false
    const settle = (result: CappedBody): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    req.on("data", (chunk: Buffer) => {
      total += chunk.byteLength
      if (total > maxBytes) {
        settle({ ok: false })
        req.destroy()
        return
      }
      chunks.push(new Uint8Array(chunk))
    })
    req.on("end", () => settle({ ok: true, bytes: joinChunks(chunks, total) }))
    req.on("error", (err) => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}

/** Parse capped body bytes as JSON. Returns `null` when the body is not JSON. */
export function parseJsonBody(bytes: Uint8Array): { value: unknown } | null {
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return null
  }
}
