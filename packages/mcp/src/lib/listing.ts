/**
 * Directory listing shim. The SDK's `files` module has no `list` operation yet,
 * so `sandbox_files_list` runs a deterministic shell command and parses it.
 *
 * Primary path: GNU `find -printf` (tab-delimited, no JSON-in-shell hazards).
 * Fallback: `ls -la` for images without GNU findutils.
 *
 * When the data plane gains a first-class `files.list` endpoint, swap the
 * implementation behind the same `DirEntry[]` contract — no tool-schema change.
 */

import { ValidationError } from "@superserve/sdk"

export interface DirEntry {
  name: string
  /** "file" | "directory" | "symlink" | "block-device" | "char-device" | "fifo" | "socket" | "other" */
  type: string
  /** Size in bytes. */
  size: number
  /** ISO-8601 modification time, when the listing exposed it. */
  modified?: string
}

const TYPE_BY_CHAR: Record<string, string> = {
  d: "directory",
  f: "file",
  l: "symlink",
  b: "block-device",
  c: "char-device",
  p: "fifo",
  s: "socket",
  "-": "file",
}

/** Validate an absolute, traversal-free path (mirrors the SDK's file rules). */
export function validateAbsolutePath(path: string): void {
  if (!path.startsWith("/")) {
    throw new ValidationError(`Path must be absolute (start with "/"): ${path}`)
  }
  if (path.split("/").some((seg) => seg === "..")) {
    throw new ValidationError(`Path must not contain ".." segments: ${path}`)
  }
  if (path.includes("\0")) {
    throw new ValidationError("Path must not contain null bytes")
  }
}

/** Single-quote a path for safe interpolation into a shell command. */
export function shellQuote(path: string): string {
  return `'${path.split("'").join("'\\''")}'`
}

export function buildFindCommand(path: string): string {
  return `find ${shellQuote(path)} -maxdepth 1 -mindepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n'`
}

export function buildLsCommand(path: string): string {
  return `ls -la --time-style=long-iso ${shellQuote(path)}`
}

/**
 * Pure-POSIX directory listing for images without GNU findutils/coreutils
 * (e.g. BusyBox/Alpine, where `find -printf` and `ls --time-style` are absent).
 * Emits the same tab-delimited `type\tsize\tmtime\tname` rows as
 * `buildFindCommand` so `parseFindOutput` consumes it unchanged. Size and mtime
 * are left empty — this fallback can't read them portably — so they parse as
 * size `0` and no `modified` rather than fabricated values. Uses `printf` (not
 * `echo`, whose `\t` handling is shell-dependent) and lists by file-type test.
 */
export function buildFallbackCommand(path: string): string {
  const q = shellQuote(path)
  return (
    `cd ${q} && for f in * .*; do ` +
    `[ "$f" = "." ] && continue; ` +
    `[ "$f" = ".." ] && continue; ` +
    `[ -e "$f" ] || [ -L "$f" ] || continue; ` +
    `if [ -L "$f" ]; then t=l; ` +
    `elif [ -d "$f" ]; then t=d; ` +
    `elif [ -p "$f" ]; then t=p; ` +
    `elif [ -S "$f" ]; then t=s; ` +
    `elif [ -b "$f" ]; then t=b; ` +
    `elif [ -c "$f" ]; then t=c; ` +
    `else t=f; fi; ` +
    `printf '%s\\t\\t\\t%s\\n' "$t" "$f"; ` +
    `done`
  )
}

function epochToIso(seconds: string): string | undefined {
  const n = Number.parseFloat(seconds)
  if (!Number.isFinite(n)) return undefined
  return new Date(n * 1000).toISOString()
}

/** Parse `find -printf '%y\t%s\t%T@\t%f\n'` output. */
export function parseFindOutput(stdout: string): DirEntry[] {
  const entries: DirEntry[] = []
  for (const line of stdout.split("\n")) {
    if (!line) continue
    const parts = line.split("\t")
    if (parts.length < 4) continue
    const [typeChar, size, mtime, ...nameParts] = parts
    // %f never contains a tab, but rejoin defensively.
    const name = nameParts.join("\t")
    if (!name || name === "." || name === "..") continue
    entries.push({
      name,
      type: TYPE_BY_CHAR[typeChar] ?? "other",
      size: Number.parseInt(size, 10) || 0,
      modified: epochToIso(mtime),
    })
  }
  return entries
}

const LS_LINE =
  /^([dlbcps-])\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s+(.*)$/

/** Best-effort parse of `ls -la --time-style=long-iso` output (fallback path). */
export function parseLsOutput(stdout: string): DirEntry[] {
  const entries: DirEntry[] = []
  for (const line of stdout.split("\n")) {
    if (!line || line.startsWith("total ")) continue
    const m = line.match(LS_LINE)
    if (!m) continue
    const [, typeChar, size, modified, rawName] = m
    let name = rawName
    if (name === "." || name === "..") continue
    if (typeChar === "l") {
      const arrow = name.indexOf(" -> ")
      if (arrow >= 0) name = name.slice(0, arrow)
    }
    entries.push({
      name,
      type: TYPE_BY_CHAR[typeChar] ?? "other",
      size: Number.parseInt(size, 10) || 0,
      modified: modified.replace(" ", "T"),
    })
  }
  return entries
}
