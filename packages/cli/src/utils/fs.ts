import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { createGzip } from "node:zlib"
import { pack } from "tar-stream"

const EXCLUDE_DIRS = new Set([
  "__pycache__",
  ".git",
  ".venv",
  "venv",
  "node_modules",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "dist",
  "build",
])

const EXCLUDE_FILE_PREFIXES = [".env"]

function shouldExclude(
  filePath: string,
  rootDir: string,
  userIgnores?: Set<string>,
): boolean {
  const rel = relative(rootDir, filePath)
  const parts = rel.split(sep)

  // Check built-in directory exclusions
  for (const part of parts) {
    if (EXCLUDE_DIRS.has(part) || part.endsWith(".egg-info")) {
      return true
    }
  }

  // Check built-in file exclusions
  const fileName = parts[parts.length - 1]
  if (EXCLUDE_FILE_PREFIXES.some((p) => fileName.startsWith(p))) {
    return true
  }

  // Check user-specified ignore patterns
  if (userIgnores) {
    const relPosix = rel.split(sep).join("/")
    for (const pattern of userIgnores) {
      if (relPosix === pattern || relPosix.startsWith(`${pattern}/`)) {
        return true
      }
    }
  }

  return false
}

function collectFiles(
  dir: string,
  rootDir: string,
  userIgnores?: Set<string>,
): string[] {
  const files: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (shouldExclude(fullPath, rootDir, userIgnores)) continue

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, rootDir, userIgnores))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files.sort()
}

export async function makeTarball(
  projectDir: string,
  userIgnores?: Set<string>,
): Promise<Uint8Array> {
  const files = collectFiles(projectDir, projectDir, userIgnores)

  const tar = pack()
  const gzip = createGzip()
  const stream = tar.pipe(gzip)

  for (const filePath of files) {
    const rel = relative(projectDir, filePath).split(sep).join("/")
    const content = readFileSync(filePath)
    const stat = statSync(filePath)
    tar.entry({ name: rel, size: content.length, mode: stat.mode }, content)
  }
  tar.finalize()

  // Collect compressed chunks into a single Uint8Array
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) {
    chunks.push(chunk as Uint8Array)
  }

  let totalLength = 0
  for (const chunk of chunks) {
    totalLength += chunk.length
  }
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}
