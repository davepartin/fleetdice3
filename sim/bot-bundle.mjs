/** Bundle the room layer for Node, the way sim/bundle.mjs does the engine. */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outfile = resolve(root, `.simbuild/bot.${process.pid}.mjs`);
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, "sim/bot-entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile,
  logLevel: "warning",
  // Only our own TypeScript needs bundling. Firebase stays external so Node
  // resolves its real node build — bundling it drags in gRPC, which is
  // CommonJS and cannot be required from inside an ESM bundle.
  packages: "external",
});

export const botPath = outfile;
