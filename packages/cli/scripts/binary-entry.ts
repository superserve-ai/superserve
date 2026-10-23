// src/index.ts without top-level await: compiled binaries are built as CJS,
// the only format `--bytecode` accepts on every Bun 1.3 release.
import { installPipeGuard, run } from "../src/cli"

installPipeGuard()

void run(process.argv.slice(2)).then((code) => {
  process.exitCode = code
})
