/**
 * `sandbox.files` - read and write files inside a sandbox.
 *
 * Hits the data plane with the per-sandbox access token. The control-plane API
 * key is not used for file operations. A paused sandbox (401 stale token, or
 * 503 because the VM isn't running) is transparently resumed via
 * `POST /activate` and the op is retried once — see `tokenRetry.ts`.
 *
 * Accessed as `sandbox.files.write(...)` / `sandbox.files.read(...)`.
 */

import { dataPlaneTarget } from "./config.js"
import { ValidationError } from "./errors.js"
import { downloadBytes, uploadBytes } from "./http.js"
import { withTokenRetry } from "./tokenRetry.js"
import type { FileInput } from "./types.js"

function validatePath(path: string): void {
  if (!path.startsWith("/")) {
    throw new ValidationError(`Path must start with "/": ${path}`)
  }
  if (path.split("/").some((seg) => seg === "..")) {
    throw new ValidationError(`Path must not contain ".." segments: ${path}`)
  }
}

/** @internal Live token accessor + slow-path resume, supplied by Sandbox. */
export interface FilesDeps {
  sandboxId: string
  sandboxHost: string
  getAccessToken: () => string
  refreshActivate: () => Promise<string>
}

export class Files {
  private readonly _dataPlaneBaseUrl: string
  private readonly _routingHeaders: Record<string, string>

  /** @internal */
  constructor(private readonly _deps: FilesDeps) {
    const target = dataPlaneTarget(_deps.sandboxId, _deps.sandboxHost)
    this._dataPlaneBaseUrl = target.url
    this._routingHeaders = target.headers
  }

  /**
   * Write a file to the sandbox at the given absolute path.
   *
   * Parent directories are created automatically by the sandbox agent.
   * The path must start with `/` and must not contain `..` segments.
   *
   * @example
   * ```typescript
   * await sandbox.files.write("/app/config.json", '{"key": "value"}')
   * await sandbox.files.write("/app/binary.dat", buffer)
   * ```
   */
  async write(
    path: string,
    content: FileInput,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<void> {
    validatePath(path)
    const body = toBody(content)
    const url = `${this._dataPlaneBaseUrl}/files?path=${encodeURIComponent(path)}`
    await withTokenRetry(this._deps, (token) =>
      uploadBytes({
        url,
        headers: { ...this._routingHeaders, "X-Access-Token": token },
        body,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      }),
    )
  }

  /**
   * Read a file from the sandbox as raw bytes.
   *
   * Downloads are capped at 2 GiB by default; override via `maxBytes`.
   *
   * @example
   * ```typescript
   * const bytes = await sandbox.files.read("/app/config.json")
   * ```
   */
  async read(
    path: string,
    options: {
      timeoutMs?: number
      signal?: AbortSignal
      maxBytes?: number
    } = {},
  ): Promise<Uint8Array> {
    validatePath(path)
    const url = `${this._dataPlaneBaseUrl}/files?path=${encodeURIComponent(path)}`
    return withTokenRetry(this._deps, (token) =>
      downloadBytes({
        url,
        headers: { ...this._routingHeaders, "X-Access-Token": token },
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        maxBytes: options.maxBytes,
      }),
    )
  }

  /**
   * Read a file from the sandbox as a UTF-8 string.
   *
   * @example
   * ```typescript
   * const text = await sandbox.files.readText("/app/config.json")
   * console.log(text) // '{"key": "value"}'
   * ```
   */
  async readText(
    path: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<string> {
    const bytes = await this.read(path, options)
    return new TextDecoder().decode(bytes)
  }

  /**
   * Download a directory from the sandbox as a ZIP archive.
   *
   * Returns the raw bytes of a zip file whose entries are prefixed with the
   * directory's base name (e.g. `<dir>/file.txt`). Symlinks are skipped.
   *
   * The server decides file-vs-directory: if `path` points at a regular file,
   * its bytes are streamed back as-is (not zipped) — use `read()` for files.
   *
   * Large directories can exceed the default 30s timeout; pass `timeoutMs`
   * to allow more time.
   *
   * Downloads are capped at 2 GiB by default; override via `maxBytes`.
   *
   * @example
   * ```typescript
   * import { writeFileSync } from "node:fs"
   *
   * const zip = await sandbox.files.downloadDir("/app/output")
   * writeFileSync("output.zip", zip)
   * ```
   */
  async downloadDir(
    path: string,
    options: {
      timeoutMs?: number
      signal?: AbortSignal
      maxBytes?: number
    } = {},
  ): Promise<Uint8Array> {
    validatePath(path)
    const url = `${this._dataPlaneBaseUrl}/files?path=${encodeURIComponent(
      path,
    )}&format=zip`
    return withTokenRetry(this._deps, (token) =>
      downloadBytes({
        url,
        headers: { ...this._routingHeaders, "X-Access-Token": token },
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        maxBytes: options.maxBytes,
      }),
    )
  }
}

/** Convert FileInput to a value suitable for fetch body. */
function toBody(content: FileInput): Blob {
  if (typeof content === "string") {
    return new Blob([content])
  }
  if (content instanceof Blob) {
    return content
  }
  if (content instanceof ArrayBuffer) {
    return new Blob([content])
  }
  // Uint8Array (or Buffer, which extends Uint8Array) — copy into a plain
  // ArrayBuffer to avoid SharedArrayBuffer type incompatibility with BlobPart
  if (content instanceof Uint8Array) {
    const copy = new ArrayBuffer(content.byteLength)
    new Uint8Array(copy).set(content)
    return new Blob([copy])
  }
  return new Blob([content as BlobPart])
}
