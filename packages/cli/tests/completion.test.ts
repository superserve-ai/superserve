import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runCli } from "./harness"

const hasShell = (shell: string) =>
  spawnSync(shell, ["-c", "true"]).status === 0

describe("completion", () => {
  // The scripts embed every command and description; one stray quote in a
  // help string would break the user's shell startup.
  for (const shell of ["bash", "zsh"]) {
    test.skipIf(!hasShell(shell))(`${shell} script parses`, async () => {
      const r = await runCli(["completion", shell])
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain("'sandbox:list')")
      const file = join(mkdtempSync(join(tmpdir(), "completion-")), shell)
      writeFileSync(file, r.stdout)
      const check = spawnSync(shell, ["-n", file], { encoding: "utf8" })
      expect(check.stderr).toBe("")
      expect(check.status).toBe(0)
    })
  }
})
