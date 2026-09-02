#!/usr/bin/env node
/**
 * Publish the game to ministrybag.com/fleetdice.
 *
 * The same game is served from two places: GitHub Pages at
 * davepartin.github.io/fleetdice3/ (deployed automatically on every push to
 * main) and ministrybag.com/fleetdice (this script). Two copies is how a site
 * goes stale, so this exists to make the second one a single command:
 *
 *     pnpm publish:ministrybag
 *
 * It builds with BASE_PATH=/fleetdice, replaces the `fleetdice` folder in the
 * ministrybag1 repo, and pushes. Nothing outside that folder is touched, and
 * the check below refuses to continue if that ever stops being true — that
 * repo is a live ministry site with dozens of other things on it.
 *
 * Three files from the page that used to live there are preserved at their old
 * paths, so links already shared keep their icon and preview image.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "https://github.com/davepartin/ministrybag1.git";
const FOLDER = "fleetdice";
const SITE = "https://ministrybag.com";
/** Files from the old landing page kept so shared links do not break. */
const KEEP = ["favicon.svg", "apple-touch-icon.png", "fleet-dice-key-art.png"];

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", env: process.env });
const out = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", env: process.env }).trim();

const root = process.cwd();

console.log(`\nBuilding for ${SITE}/${FOLDER} …`);
execFileSync("pnpm", ["build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, BASE_PATH: `/${FOLDER}`, SITE_URL: SITE },
});

const work = mkdtempSync(join(tmpdir(), "ministrybag-"));
const repo = join(work, "ministrybag1");
console.log(`\nCloning the site into ${repo} …`);
run("git", ["clone", "--depth=1", REPO, repo], work);

const target = join(repo, FOLDER);
const keepDir = join(work, "keep");
mkdirSync(keepDir, { recursive: true });
for (const f of KEEP) {
  const from = join(target, f);
  if (existsSync(from)) cpSync(from, join(keepDir, f));
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(join(root, "out"), target, { recursive: true });
for (const f of KEEP) {
  const from = join(keepDir, f);
  if (existsSync(from)) cpSync(from, join(target, f));
}

run("git", ["add", "-A"], repo);
const changed = out("git", ["status", "--short"], repo);
if (!changed) {
  console.log("\nNothing to publish — the site already matches this build.\n");
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

// The guard that matters: this repo is a live ministry site.
const stray = changed
  .split("\n")
  .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""))
  .filter((path) => path && !path.startsWith(`${FOLDER}/`));
if (stray.length) {
  console.error(`\nREFUSING TO PUSH — changes outside ${FOLDER}/:\n  ${stray.join("\n  ")}\n`);
  console.error(`The clone is at ${repo} if you want to look.\n`);
  process.exit(1);
}

console.log(`\n${changed.split("\n").length} files changed, all inside ${FOLDER}/. Pushing …`);
run("git", ["commit", "-q", "-m", "Update Fleet Dice at /fleetdice"], repo);
run("git", ["push", "origin", "HEAD"], repo);
rmSync(work, { recursive: true, force: true });
console.log(`\nPublished. It takes GitHub Pages a minute: ${SITE}/${FOLDER}/\n`);
