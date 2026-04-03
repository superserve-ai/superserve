import { defineConfig } from "tsup"
import pkg from "./package.json"

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
})
