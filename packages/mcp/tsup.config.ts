import { defineConfig } from "tsup"

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  // No d.ts: this is an executable (bin), not a library anyone imports types
  // from. Generating declarations would type-check the entire MCP SDK surface
  // (multi-minute), so it is intentionally disabled.
  dts: false,
  sourcemap: true,
  clean: true,
  // Shebang so the published `bin` is directly executable via npx.
  banner: { js: "#!/usr/bin/env node" },
})
