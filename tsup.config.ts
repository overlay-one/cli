import { defineConfig } from "tsup";

export default defineConfig({
  entry: { overlay: "src/index.ts" },
  format: "esm",
  outDir: "dist",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
