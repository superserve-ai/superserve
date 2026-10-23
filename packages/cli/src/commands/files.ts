import {
  existsSync,
  openAsBlob,
  readdirSync,
  realpathSync,
  lstatSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, join, posix, resolve } from "node:path"

import { Sandbox, ValidationError } from "@superserve/sdk"
import type { Command } from "commander"

import { apiRequest, resolveSandboxId } from "../api"
import { collect, parseDuration, readStdin, sandboxPath } from "../args"
import { sdkOptions } from "../config"
import { CliError, EXIT, usageError } from "../errors"
import {
  formatBytes,
  formatDate,
  isJson,
  printJson,
  printTable,
  success,
  warn,
  withSpinner,
} from "../output"

const HOME = "/home/user"
const DEFAULT_TIMEOUT = "10m"
const UPLOAD_CONCURRENCY = 8

interface DirEntry {
  name: string
  is_dir: boolean
  size: number
  modified_unix: number
}

interface TransferOpts {
  timeout: string
  force?: boolean
  exclude?: string[]
  followSymlinks?: boolean
}

export function register(program: Command): void {
  const files = program
    .command("files")
    .alias("fs")
    .description("List, read, write, upload and download sandbox files")

  files
    .command("ls")
    .description("List a directory inside a sandbox")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("[path]", "Absolute directory path", HOME)
    .addHelpText(
      "after",
      "\nListing a paused sandbox resumes it, and it stays active afterward.",
    )
    .action(async (ref: string, path: string) => {
      const id = await resolveSandboxId(ref)
      const listing = await listDir(id, sandboxPath(path))
      if (isJson()) return printJson(listing)
      const rows = listing.entries.toSorted(
        (a, b) =>
          Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name),
      )
      printTable(
        rows,
        [
          { header: "type", value: (e) => (e.is_dir ? "dir" : "file") },
          { header: "name", value: (e) => (e.is_dir ? `${e.name}/` : e.name) },
          {
            header: "size",
            value: (e) => (e.is_dir ? "-" : formatBytes(e.size)),
          },
          {
            header: "modified",
            value: (e) =>
              e.modified_unix
                ? formatDate(new Date(e.modified_unix * 1000))
                : "-",
          },
        ],
        "Empty directory.",
      )
    })

  files
    .command("cat")
    .description("Print a file's raw bytes to stdout")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<path>", "Absolute file path")
    .option("--timeout <duration>", "Transfer timeout", DEFAULT_TIMEOUT)
    .action(async (ref: string, path: string, opts: TransferOpts) => {
      sandboxPath(path)
      const sb = await connect(ref)
      process.stdout.write(
        await sb.files.read(path, { timeoutMs: timeoutMs(opts) }),
      )
    })

  files
    .command("write")
    .description("Write stdin (or a local file) to a sandbox file")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<path>", "Absolute file path (overwritten if it exists)")
    .option("--from <file>", "Read the content from a local file")
    .option("--timeout <duration>", "Transfer timeout", DEFAULT_TIMEOUT)
    .addHelpText(
      "after",
      `
Examples:
  echo 'print("hi")' | superserve files write my-box /home/user/hi.py
  superserve files write my-box /home/user/data.bin --from ./data.bin`,
    )
    .action(
      async (
        ref: string,
        path: string,
        opts: TransferOpts & { from?: string },
      ) => {
        sandboxPath(path)
        let body: Blob | Buffer
        if (opts.from) {
          body = await localBlob(opts.from)
        } else if (process.stdin.isTTY) {
          throw usageError(
            "Pipe content on stdin or pass --from <file>.",
            `echo hello | superserve files write ${ref} ${path}`,
          )
        } else {
          body = await readStdin()
        }
        const sb = await connect(ref)
        await sb.files.write(path, body, { timeoutMs: timeoutMs(opts) })
        const bytes = body instanceof Blob ? body.size : body.length
        if (isJson()) return printJson({ sandbox_id: sb.id, path, bytes })
        success(`Wrote ${formatBytes(bytes)} to ${path}`)
      },
    )

  files
    .command("upload")
    .description("Upload a local file or directory (recursively)")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<local>", "Local file or directory")
    .argument(
      "[remote]",
      `Destination path (default: ${HOME}/<basename>; a trailing / puts a file inside that directory)`,
    )
    .option(
      "--exclude <glob>",
      "Skip matching paths (repeatable; *, ** and ? supported)",
      collect,
    )
    .option("--follow-symlinks", "Upload symlink targets instead of skipping")
    .option(
      "--timeout <duration>",
      "Per-file transfer timeout",
      DEFAULT_TIMEOUT,
    )
    .addHelpText(
      "after",
      `
Existing sandbox files are overwritten. A directory's contents land under
<remote>, e.g. ./src/app.ts → ${HOME}/src/app.ts. Empty directories are not
created. Files stream from disk, so size is bounded by --timeout, not memory.

An --exclude pattern without a / matches a name at any depth
(--exclude node_modules --exclude '*.log'); with a / it matches the path
relative to <local> (--exclude 'dist/**').`,
    )
    .action(
      (
        ref: string,
        local: string,
        remote: string | undefined,
        opts: TransferOpts,
      ) => upload(ref, local, remote, opts),
    )

  files
    .command("download")
    .description("Download a file, or a directory as a .zip")
    .argument("<sandbox>", "Sandbox ID or name")
    .argument("<remote>", "Absolute sandbox path")
    .argument(
      "[local]",
      "Local path or directory, or - for stdout (default: <basename>, or <basename>.zip for a directory)",
    )
    .option("-f, --force", "Overwrite an existing local file")
    .option("--timeout <duration>", "Transfer timeout", DEFAULT_TIMEOUT)
    .addHelpText("after", "\nDownloads are held in memory and capped at 2 GiB.")
    .action(
      (
        ref: string,
        remote: string,
        local: string | undefined,
        opts: TransferOpts,
      ) => download(ref, remote, local, opts),
    )

  program
    .command("cp")
    .description("Copy files between your machine and a sandbox")
    .argument("<src>", "Local path or <sandbox>:<path>")
    .argument("<dst>", "Local path or <sandbox>:<path>")
    .option("-f, --force", "Overwrite an existing local file")
    .option("--exclude <glob>", "Skip matching paths on upload", collect)
    .option("--follow-symlinks", "Upload symlink targets instead of skipping")
    .option("--timeout <duration>", "Transfer timeout", DEFAULT_TIMEOUT)
    .addHelpText(
      "after",
      `
Exactly one side is <sandbox>:<absolute path>. Behaves like \`files upload\`
and \`files download\`: directories upload recursively and download as a .zip.
  superserve cp ./src my-box:/home/user/src
  superserve cp my-box:/home/user/out.log .
Prefix a local path containing ":" with ./ to keep it local.`,
    )
    .action((src: string, dst: string, opts: TransferOpts) => {
      const from = remoteSpec(src)
      const to = remoteSpec(dst)
      if (from && to) {
        throw usageError("Copying between sandboxes is not supported.")
      }
      if (to) return upload(to.ref, src, to.path, opts)
      if (from) return download(from.ref, from.path, dst, opts)
      throw usageError(
        "One side must be <sandbox>:<path>, e.g. my-box:/home/user/file.txt.",
      )
    })
}

async function connect(ref: string): Promise<Sandbox> {
  return Sandbox.connect(await resolveSandboxId(ref), sdkOptions())
}

async function listDir(
  id: string,
  path: string,
): Promise<{ entries: DirEntry[] }> {
  const res = await apiRequest<{ entries?: DirEntry[] }>(
    "GET",
    `/sandboxes/${encodeURIComponent(id)}/files`,
    { query: { path } },
  )
  return { ...res, entries: res.entries ?? [] }
}

function timeoutMs(opts: { timeout: string }): number {
  return parseDuration(opts.timeout, "--timeout") * 1000
}

// File-backed Blob: fetch streams it from disk instead of buffering it.
async function localBlob(path: string): Promise<Blob> {
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw usageError(`${path} is not a file.`)
  }
  return openAsBlob(path)
}

/** `box:/abs/path` → { ref, path }; `./a:/b` and Windows drive paths stay local. */
export function remoteSpec(
  arg: string,
): { ref: string; path: string } | undefined {
  const m = /^([^/\\:]+):(\/.*)$/.exec(arg)
  if (!m || (process.platform === "win32" && /^[A-Za-z]$/.test(m[1]))) {
    return undefined
  }
  return { ref: m[1], path: m[2] }
}

export function globToRegExp(glob: string): RegExp {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*" && glob[i + 1] === "*") {
      i++
      if (glob[i + 1] === "/") {
        i++
        re += "(?:.*/)?"
      } else {
        re += ".*"
      }
    } else if (c === "*") re += "[^/]*"
    else if (c === "?") re += "[^/]"
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${re}$`)
}

/** Patterns without a `/` match a basename at any depth, like .gitignore. */
export function excluder(patterns: string[] = []): (rel: string) => boolean {
  const rules = patterns.map((p) => {
    const glob = p.replace(/^\.\//, "").replace(/\/+$/, "")
    return { re: globToRegExp(glob), byName: !glob.includes("/") }
  })
  return (rel) =>
    rules.some((r) => r.re.test(r.byName ? posix.basename(rel) : rel))
}

interface LocalFile {
  abs: string
  rel: string
  size: number
}

function walk(
  root: string,
  excluded: (rel: string) => boolean,
  follow: boolean,
): LocalFile[] {
  const out: LocalFile[] = []
  const skipped: string[] = []
  // Only ancestors count as a cycle; two aliases of one directory both upload.
  const ancestors = new Set<string>()
  const visit = (dir: string, rel: string) => {
    const real = realpathSync(dir)
    if (ancestors.has(real)) return
    ancestors.add(real)
    const entries = readdirSync(dir, { withFileTypes: true }).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const ent of entries) {
      const abs = join(dir, ent.name)
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (excluded(r)) continue
      const st =
        ent.isSymbolicLink() && !follow
          ? undefined
          : statSync(abs, { throwIfNoEntry: false })
      if (st?.isDirectory()) visit(abs, r)
      else if (st?.isFile()) out.push({ abs, rel: r, size: st.size })
      else skipped.push(r)
    }
    ancestors.delete(real)
  }
  visit(root, "")
  if (skipped.length) {
    const shown = skipped.slice(0, 5).join(", ")
    warn(
      `Skipped ${skipped.length} ${follow ? "broken links or special files" : "symlinks or special files"}: ${shown}${skipped.length > 5 ? ", …" : ""}${follow ? "" : " (--follow-symlinks uploads link targets)"}`,
    )
  }
  return out
}

async function upload(
  ref: string,
  local: string,
  remote: string | undefined,
  opts: TransferOpts,
): Promise<void> {
  const link = lstatSync(local, { throwIfNoEntry: false })
  if (!link) throw usageError(`${local} does not exist.`)
  if (link.isSymbolicLink() && !opts.followSymlinks) {
    throw usageError(
      `${local} is a symlink.`,
      "Pass --follow-symlinks to upload its target.",
    )
  }
  const st = statSync(local, { throwIfNoEntry: false })
  if (!st) throw usageError(`${local} is a broken symlink.`)
  // The user-supplied name, not a symlink target's; resolve() handles "." and "..".
  const name = basename(resolve(local))
  let dest = remote ? sandboxPath(remote) : `${HOME}/${name}`
  const timeout = timeoutMs(opts)

  if (!st.isDirectory()) {
    if (dest.endsWith("/")) dest += name
    const blob = await localBlob(local)
    const sb = await connect(ref)
    await withSpinner(`Uploading ${formatBytes(blob.size)}`, () =>
      sb.files.write(dest, blob, { timeoutMs: timeout }),
    )
    return report(sb.id, dest, 1, blob.size)
  }

  const files = walk(
    local,
    excluder(opts.exclude),
    Boolean(opts.followSymlinks),
  )
  if (files.length === 0) {
    throw new CliError(`No files to upload in ${local}.`, EXIT.USAGE)
  }
  const sb = await connect(ref)
  const total = files.reduce((n, f) => n + f.size, 0)
  const showProgress = Boolean(process.stderr.isTTY) && !isJson()
  let done = 0
  let bytes = 0
  const progress = () => {
    if (!showProgress) return
    process.stderr.write(
      `\r\x1b[2KUploading ${done}/${files.length} files (${formatBytes(bytes)} / ${formatBytes(total)})`,
    )
  }
  progress()

  // Fail fast: the first error aborts in-flight writes; their aborts are noise.
  const ac = new AbortController()
  let next = 0
  const worker = async () => {
    while (!ac.signal.aborted && next < files.length) {
      const f = files[next++]
      try {
        await sb.files.write(posix.join(dest, f.rel), await openAsBlob(f.abs), {
          timeoutMs: timeout,
          signal: ac.signal,
        })
      } catch (err) {
        if (ac.signal.aborted) return
        ac.abort()
        if (err instanceof Error) {
          err.message = `Failed to upload ${f.rel}: ${err.message}`
        }
        throw err
      }
      done++
      bytes += f.size
      progress()
    }
  }
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(UPLOAD_CONCURRENCY, files.length) },
        worker,
      ),
    )
  } finally {
    if (showProgress) process.stderr.write("\r\x1b[2K")
  }
  report(sb.id, dest, files.length, total)
}

function report(id: string, path: string, files: number, bytes: number): void {
  if (isJson()) return printJson({ sandbox_id: id, path, files, bytes })
  success(
    `Uploaded ${files === 1 ? "1 file" : `${files} files`} (${formatBytes(bytes)}) to ${path}`,
  )
}

async function download(
  ref: string,
  remote: string,
  local: string | undefined,
  opts: TransferOpts,
): Promise<void> {
  sandboxPath(remote)
  const timeout = timeoutMs(opts)
  const id = await resolveSandboxId(ref)
  const trimmed = remote.replace(/\/+$/, "")
  const name = posix.basename(trimmed)
  // Activate first: the listing also resumes a paused sandbox, and two
  // concurrent resumes race. The parent's listing tells a file from a directory.
  const sb = await Sandbox.connect(id, sdkOptions())
  const entry =
    trimmed === ""
      ? { is_dir: true }
      : (await listDir(id, posix.dirname(trimmed))).entries.find(
          (e) => e.name === name,
        )

  const targetFor = (dir: boolean): string => {
    const defaultName = dir ? `${name || "root"}.zip` : name
    let t = local ?? defaultName
    if (t !== "-" && statSync(t, { throwIfNoEntry: false })?.isDirectory()) {
      t = join(t, defaultName)
    }
    if (t !== "-" && !opts.force && existsSync(t)) {
      throw new CliError(
        `${t} already exists.`,
        EXIT.CONFLICT,
        "Pass --force to overwrite it.",
      )
    }
    return t
  }

  // Listings are lstat-based and capped at 10k entries, so only a directory entry
  // is trusted; anything else is read as a file and a 400 switches to zip.
  let isDir = entry?.is_dir === true
  // Check for a local collision up front only when the type is certain; an
  // unlisted entry may turn out to be a directory, whose target is <name>.zip.
  let target = entry ? targetFor(isDir) : undefined
  let bytes: Uint8Array | undefined
  if (!isDir) {
    try {
      bytes = await withSpinner(`Downloading ${remote}`, () =>
        sb.files.read(trimmed, { timeoutMs: timeout }),
      )
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err
      isDir = true
      target = targetFor(true)
    }
  }
  target ??= targetFor(isDir)
  if (!bytes) {
    try {
      bytes = await withSpinner(`Downloading ${remote}`, () =>
        sb.files.downloadDir(trimmed || "/", { timeoutMs: timeout }),
      )
    } catch (err) {
      // The server refuses to archive through a symlinked directory.
      if (err instanceof ValidationError && /symlink/i.test(err.message)) {
        throw new CliError(
          `${remote} is a symlink to a directory.`,
          EXIT.USAGE,
          `Download its target instead: superserve exec ${ref} -- readlink -f ${remote}`,
        )
      }
      throw err
    }
  }
  if (target === "-") {
    process.stdout.write(bytes)
    return
  }
  writeFileSync(target, bytes, { flag: opts.force ? "w" : "wx" })
  if (isJson()) {
    return printJson({
      sandbox_id: id,
      remote,
      local: target,
      format: isDir ? "zip" : "file",
      bytes: bytes.length,
    })
  }
  success(`Downloaded ${remote} → ${target} (${formatBytes(bytes.length)})`)
}
