/** Bundle the TypeScript engine into plain ESM so Node can measure it directly. */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
// node --test runs each test file as its own process, and more than one file
// imports this module — a shared output path lets two esbuild writes race on
// the same file. Every process gets its own, so nobody else can step on it.
const outfile = resolve(root, `.simbuild/game.${process.pid}.mjs`);

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
