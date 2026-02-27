import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
  },
  {
    entry: { react: "src/react/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    external: ["react"],
  },
])
