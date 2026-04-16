/**
 * Files sub-module for uploading/downloading files to/from a sandbox.
 *
 * Hits the data-plane directly at `boxd-{id}.sandbox.superserve.ai`
 * using the per-sandbox access token. The control-plane API key is
 * not used for file operations.
 *
 * Accessed as `sandbox.files.write(...)` / `sandbox.files.read(...)`.
 */

import { dataPlaneUrl } from "./config.js"
import { downloadBytes, uploadBytes } from "./http.js"
import type { FileInput } from "./types.js"

export class Files {
  private readonly _dataPlaneBaseUrl: string

  /** @internal */
  constructor(
    sandboxId: string,
    sandboxHost: string,
    private readonly _accessToken: string,
  ) {
    this._dataPlaneBaseUrl = dataPlaneUrl(sandboxId, sandboxHost)
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
    timeoutMs?: number,
  ): Promise<void> {
    const body = toBody(content)
    const url = `${this._dataPlaneBaseUrl}/files?path=${encodeURIComponent(path)}`
    await uploadBytes({
      url,
      headers: { "X-Access-Token": this._accessToken },
      body,
      timeoutMs,
    })
  }

  /**
   * Read a file from the sandbox as raw bytes.
   *
   * @example
   * ```typescript
   * const bytes = await sandbox.files.read("/app/config.json")
   * ```
   */
  async read(path: string, timeoutMs?: number): Promise<Uint8Array> {
    const url = `${this._dataPlaneBaseUrl}/files?path=${encodeURIComponent(path)}`
    return downloadBytes({
      url,
      headers: { "X-Access-Token": this._accessToken },
      timeoutMs,
    })
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
  async readText(path: string, timeoutMs?: number): Promise<string> {
    const bytes = await this.read(path, timeoutMs)
    return new TextDecoder().decode(bytes)
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
  // Uint8Array or Buffer — copy into a plain ArrayBuffer to avoid
  // SharedArrayBuffer type incompatibility with BlobPart
  if (content instanceof Uint8Array) {
    const copy = new ArrayBuffer(content.byteLength)
    new Uint8Array(copy).set(content)
    return new Blob([copy])
  }
  return new Blob([content as BlobPart])
}
