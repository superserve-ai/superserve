/**
 * files — data-plane file operations for the sandbox file manager.
 *
 * Everything here talks directly to the per-sandbox data plane
 * (`boxd-{id}.{SANDBOX_HOST}/files`) with the `X-Access-Token`, the same
 * surface the upload/download panels have always used. The control-plane proxy
 * is not involved.
 *
 * Pure helpers (path math, header parsing) live here too so the UI and tests
 * share one implementation.
 */

import type { SandboxResponse } from "@/lib/api/types"

const SANDBOX_HOST =
  process.env.NEXT_PUBLIC_SANDBOX_HOST ?? "sandbox.superserve.ai"

/** A single entry in a directory listing (boxd `format=json` shape). */
export interface DirEntry {
  name: string
  is_dir: boolean
  size: number
  modified_unix: number
}

/** The subset of a sandbox a data-plane file call needs. */
type FileSandbox = Pick<SandboxResponse, "id" | "access_token">

/**
 * Thrown when the data plane can't list directories yet — an old boxd (before
 * `format=json`) 400s a directory with the legacy "use FilesystemService"
 * message. Surfaced as its own type so the UI can show "not available yet"
 * rather than a hard error, letting the console ship ahead of the boxd rollout.
 */
export class FileListingUnavailableError extends Error {
  constructor() {
    super("Directory listing is not available for this sandbox yet.")
    this.name = "FileListingUnavailableError"
  }
}

export function filesUrl(
  sandboxId: string,
  path: string,
  params?: Record<string, string>,
): string {
  let url = `https://boxd-${sandboxId}.${SANDBOX_HOST}/files?path=${encodeURIComponent(path)}`
  for (const [key, value] of Object.entries(params ?? {})) {
    url += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  }
  return url
}

export function isValidAbsolutePath(path: string): boolean {
  if (!path.startsWith("/")) return false
  for (const segment of path.split("/")) {
    if (segment === ".." || segment === ".") return false
  }
  return true
}

/** Join a directory path and a child name into an absolute path. */
export function joinPath(dir: string, name: string): string {
  const base = dir.endsWith("/") ? dir : `${dir}/`
  return `${base}${name}`
}

/**
 * The parent directory of an absolute path. Bottoms out at root:
 * parentPath("/a/b") === "/a", parentPath("/a") === "/", parentPath("/") === "/".
 */
export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "")
  if (trimmed === "") return "/"
  const idx = trimmed.lastIndexOf("/")
  return idx <= 0 ? "/" : trimmed.slice(0, idx)
}

/** Absolute path → ordered breadcrumbs (root excluded). */
export function pathSegments(path: string): { name: string; path: string }[] {
  const crumbs: { name: string; path: string }[] = []
  let acc = ""
  for (const part of path.split("/").filter(Boolean)) {
    acc += `/${part}`
    crumbs.push({ name: part, path: acc })
  }
  return crumbs
}

export function fileNameFromPath(path: string): string {
  const clean = path.split(/[?#]/)[0]
  const parts = clean.split("/").filter(Boolean)
  return parts[parts.length - 1] || "download"
}

/**
 * Pull the filename out of a Content-Disposition header. boxd controls the
 * format (`attachment; filename="<name>"`), so a simple match is enough. The
 * data plane runs untrusted user code, so treat its filename as untrusted:
 * reduce it to a basename and reject `.`/`..` so it can't steer the saved path.
 * Returns null when absent, unparseable, or not a usable basename.
 */
export function filenameFromContentDisposition(
  header: string | null,
): string | null {
  if (!header) return null
  const match = /filename=(?:"([^"]*)"|([^;]+))/i.exec(header)
  const trimmed = (match?.[1] ?? match?.[2])?.trim()
  if (!trimmed) return null
  const base = trimmed.slice(
    Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1,
  )
  if (!base || base === "." || base === "..") return null
  return base
}

/**
 * Pull a human-readable message out of a data-plane error response. Bodies are
 * JSON like {"error":"..."} or {"error":{"code","message"}}; fall back to the
 * raw text, then a generic message. Keeps internal error strings out of toasts.
 */
export async function errorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  const text = await res.text().catch(() => "")
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const err = parsed.error
    if (typeof err === "string") return err
    if (err && typeof err === "object" && "message" in err) {
      const message = (err as { message?: unknown }).message
      if (typeof message === "string") return message
    }
    if (typeof parsed.message === "string") return parsed.message
    return fallback
  } catch {
    // Body wasn't JSON; fall through to the raw text.
  }
  return text || fallback
}

/** Directories first, then files; each group sorted case-insensitively. */
export function sortEntries(entries: DirEntry[]): DirEntry[] {
  return entries.toSorted((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })
}

/**
 * List a directory's immediate children (non-recursive) via boxd's
 * `?format=json` listing, returned dirs-first then alpha.
 */
export async function listDir(
  sandbox: FileSandbox,
  path: string,
  signal?: AbortSignal,
): Promise<DirEntry[]> {
  const res = await fetch(filesUrl(sandbox.id, path, { format: "json" }), {
    method: "GET",
    headers: { "X-Access-Token": sandbox.access_token },
    signal,
  })
  if (!res.ok) {
    const detail = await errorMessage(
      res,
      `Could not list ${path} (${res.status})`,
    )
    if (res.status === 400 && /FilesystemService|director/i.test(detail)) {
      throw new FileListingUnavailableError()
    }
    if (res.status === 404) {
      throw new Error(`Folder not found: ${path}`)
    }
    throw new Error(detail)
  }
  const data = (await res.json()) as { entries?: DirEntry[] }
  return sortEntries(Array.isArray(data.entries) ? data.entries : [])
}

/**
 * Upload a browser File into `dirPath`, saved as `<dirPath>/<file.name>`.
 * Returns the absolute target path on success. Validates the target is absolute
 * and traversal-free before hitting the network.
 */
export async function uploadFileTo(
  sandbox: FileSandbox,
  dirPath: string,
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  const target = joinPath(dirPath, file.name)
  if (!isValidAbsolutePath(target)) {
    throw new Error("Upload path must be absolute and free of '..' segments")
  }
  const res = await fetch(filesUrl(sandbox.id, target), {
    method: "POST",
    headers: { "X-Access-Token": sandbox.access_token },
    body: file,
    signal,
  })
  if (!res.ok) {
    throw new Error(await errorMessage(res, `Upload failed (${res.status})`))
  }
  return target
}
