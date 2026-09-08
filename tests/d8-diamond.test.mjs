/**
 * The resting d8 must read as a square turned 45° — a playing-card diamond —
 * not two equilateral triangles tip-to-tip (the tall needle a regular
 * octahedron makes when it sits on an edge).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as THREE from "three";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the live die tips with the same angle the solid was built for", () => {
  const die = readFileSync(new URL("../lib/three/die.ts", import.meta.url), "utf8");
  assert.match(die, /d8DiamondTip/, "the rest pose and the inscription must share the tip");
  assert.doesNotMatch(
    die,
    /atan\(1\s*\/\s*Math\.sqrt\(2\)\)/,
    "the regular-octahedron tip belongs to the tall needle we just left",
  );
});

test("the hull icon diamond is a square on its point", () => {
  const src = readFileSync(new URL("../components/HullShape.tsx", import.meta.url), "utf8");
  const path = src.match(/8:\s*"([^"]+)"/)?.[1];
  assert.ok(path, "HULL_PATHS[8] should be a path string");
  const points = [...path.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  assert.equal(points.length, 4, "the d8 icon is a four-point diamond");
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  assert.equal(width, height, `icon diamond should be square-on-point, got ${width}×${height}`);
});

test("the resting d8 silhouette is a square-on-point diamond", async () => {
  mkdirSync(resolve(root, ".simbuild"), { recursive: true });
  const outfile = resolve(root, `.simbuild/d8-diamond.${process.pid}.mjs`);
  await build({
    entryPoints: [resolve(root, "lib/three/polyhedron.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    outfile,
    logLevel: "warning",
  });
  const { buildDie, d8DiamondTip } = await import(outfile);
  const built = buildDie(8, 1, 4, 2);
  const tip = d8DiamondTip();

  for (let face = 0; face < built.frames.length; face += 1) {
    const pose = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -tip);
    pose.multiply(built.frames[face].quaternion);
    const bounds = new THREE.Box3();
    const positions = built.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i += 1) {
      bounds.expandByPoint(
        new THREE.Vector3().fromBufferAttribute(positions, i).applyQuaternion(pose),
      );
    }
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;
    const ratio = height / width;
    assert.ok(
      Math.abs(ratio - 1) < 0.04,
      `face ${face + 1} rest diamond should be square-on-point, h/w=${ratio.toFixed(3)}`,
    );
  }
});
