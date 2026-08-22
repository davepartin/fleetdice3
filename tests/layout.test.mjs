/**
 * The home screen and both battle modes share one stylesheet.
 * If the root layout stops importing it, the dice still draw and every
 * menu falls below them — which is exactly how the live home page broke.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the root layout still loads the design stylesheet", () => {
  const src = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(src, /import ["']\.\/globals\.css["']/);
});
