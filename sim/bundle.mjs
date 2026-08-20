/** Bundle the TypeScript engine into plain ESM so Node can measure it directly. */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outfile = resolve(root, ".simbuild/game.mjs");

mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, "sim/entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile,
  logLevel: "warning",
});

export const bundlePath = outfile;
