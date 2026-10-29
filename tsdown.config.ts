// One build for every runtime: this package's code has nothing platform-specific. The Chargewire
// client it depends on is never bundled: it stays an import of @gizmodata/chargewire, whose own
// export conditions then pick its Node build (Node, Deno, Bun) or its browser build.
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "dist",
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2023",
  dts: true,
  sourcemap: false,
  clean: true,
  fixedExtension: true,
  deps: { neverBundle: ["@gizmodata/chargewire", "apache-arrow"] },
});
