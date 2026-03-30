import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
  outExtension: () => ({
    js: ".mjs",
  }),
  banner: {
    js: "#!/usr/bin/env node",
  },
});
