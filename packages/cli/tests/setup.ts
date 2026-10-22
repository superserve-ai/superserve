import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Safety net: no test may write to the real ~/.superserve or send telemetry.
process.env.SUPERSERVE_CONFIG_DIR = mkdtempSync(
  join(tmpdir(), "superserve-cli-"),
)
process.env.SUPERSERVE_TELEMETRY = "0"
