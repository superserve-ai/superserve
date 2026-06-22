import { defineConfig } from "tsup"

// Library entry imported by the console / edge runtimes as `@superserve/mcp/http`.
// Built separately from the bins (`tsup.config.ts`) with NO shebang — a leading
// `#!` breaks some bundlers when the file is imported. `clean: false` appends to
// the bin build, which runs first and owns the output-folder clean; the `build`
// script chains the two with `&&` so the order is deterministic (a single
// concurrent array config would race the clean against this output).
export default defineConfig({
  entry: { http: "src/http.ts" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  dts: false,
  sourcemap: true,
  clean: false,
})
