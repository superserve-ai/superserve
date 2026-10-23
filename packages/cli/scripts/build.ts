import { rmSync } from "node:fs"
import { resolve } from "node:path"

// `bun run build`: a self-contained node bundle for npm. `--binaries`: standalone
// executables named the way install.sh and the Homebrew formula expect.

const root = resolve(import.meta.dir, "..")
const dist = resolve(root, "dist")

const targets = [
  "bun-linux-x64",
  "bun-linux-x64-baseline",
  "bun-linux-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
]

function build(label: string, args: string[]): void {
  console.log(`Building ${label}...`)
  const proc = Bun.spawnSync(["bun", "build", ...args], {
    stdout: "inherit",
    stderr: "inherit",
  })
  if (proc.exitCode !== 0) {
    console.error(`Build failed: ${label}`)
    process.exit(1)
  }
}

rmSync(dist, { recursive: true, force: true })

build("dist/index.js", [
  "--target=node",
  "--format=esm",
  "--minify",
  `--outfile=${resolve(dist, "index.js")}`,
  resolve(root, "src/index.ts"),
])

if (process.argv.includes("--binaries")) {
  for (const target of targets) {
    const ext = target.includes("windows") ? ".exe" : ""
    build(target, [
      "--compile",
      "--minify",
      "--bytecode",
      "--format=cjs",
      `--target=${target}`,
      `--outfile=${resolve(dist, `superserve-${target}${ext}`)}`,
      resolve(root, "scripts/binary-entry.ts"),
    ])
  }
}
