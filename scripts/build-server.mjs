import { build } from "esbuild";
await build({
  entryPoints: ["apps/server/src/main.ts"],
  bundle: true, platform: "node", format: "esm", target: "node20",
  outfile: "apps/server/dist/server.mjs", sourcemap: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
