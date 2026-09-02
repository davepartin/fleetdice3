"use client";

/**
 * The front-page hero: a handful of hulls turning slowly in deep space.
 *
 * It is the same renderer, the same dice and the same lighting the match uses,
 * so the first thing anyone sees is honest about what the game looks like.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createStage } from "@/lib/three/stage";
import { createDie, type Die, type DieKind } from "@/lib/three/die";
import { displayFontFamily, waitForFonts } from "@/lib/three/fonts";

/**
 * How far up the scene the dice sit, in world units.
 *
 * They were centred in the viewport, which put them behind the mode cards. The
 * gap between the key art and the first button is where they are actually
 * visible, so the cluster is lifted into it.
 *
 * Measured rather than guessed: `window.__fdHero.positions()` reports where
 * every die lands in CSS pixels, and one world unit is worth 22px on an 844px
 * screen — so 1.82 raises the cluster by the 40px asked for.
 *
 * A CSS transform would have been easier and is forbidden here: Safari paints
 * a transformed WebGL canvas over every menu, which is why `.stage-canvas` is
 * never transformed. Moving the dice in the scene keeps them behind the page.
 */
const HERO_LIFT = 1.82;

const CAST: { kind: DieKind; at: [number, number, number]; scale: number; spin: number }[] = [
  { kind: "flag", at: [0, 0.4, 1.6], scale: 1.5, spin: 0.16 },
  { kind: 10, at: [-4.3, 1.9, -1.4], scale: 1.15, spin: -0.22 },
  { kind: 8, at: [4.1, 2.4, -0.6], scale: 1.1, spin: 0.26 },
  { kind: 6, at: [-3.1, -2.4, 0.8], scale: 1.05, spin: 0.3 },
  { kind: 4, at: [3.4, -2.1, 1.2], scale: 1.0, spin: -0.34 },
  { kind: 6, at: [-6.4, -0.4, -3.4], scale: 0.85, spin: 0.2 },
  { kind: 10, at: [6.2, -0.9, -3.0], scale: 0.9, spin: -0.18 },
];

export function HeroStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let stage: ReturnType<typeof createStage> | null = null;
    const dice: Die[] = [];

    (async () => {
      await waitForFonts();
      if (cancelled || !canvasRef.current) return;
      stage = createStage(canvasRef.current);
      stage.setFrame(
        { pitch: 6, fitWidth: 17, fitDepth: 10, target: new THREE.Vector3(0, 0, 0), parallax: 1.4 },
        true,
      );
      const font = displayFontFamily();

      for (const entry of CAST) {
        const die = createDie(entry.kind, font, entry.scale);
        const home = new THREE.Vector3(entry.at[0], entry.at[1] + HERO_LIFT, entry.at[2]);
        die.setHome(home);
        die.object.position.copy(home);
        die.setFace(1 + Math.floor(Math.random() * die.sides));
        die.object.userData.spin = entry.spin;
        stage.world.add(die.object);
        dice.push(die);
      }

      // A hatch for the screenshot harness, mirroring `__fd3` on the match
      // board: where each die actually lands in CSS pixels. "Move them up 40px"
      // is answerable with a number rather than a squint.
      if (typeof window !== "undefined") {
        (window as unknown as { __fdHero?: unknown }).__fdHero = {
          positions() {
            const cam = stage!.camera;
            const rect = canvasRef.current!.getBoundingClientRect();
            return dice.map((die) => {
              const v = die.object.position.clone().project(cam);
              return {
                x: Math.round(((v.x + 1) / 2) * rect.width),
                y: Math.round(((1 - v.y) / 2) * rect.height),
              };
            });
          },
        };
      }

      // Drift, and reroll one die every couple of seconds so it feels alive.
      let next = 1.2;
      stage.onFrame((dt, time) => {
        for (const die of dice) {
          die.update(dt, time);
          if (!die.rolling) {
            die.object.rotateY(dt * (die.object.userData.spin as number));
          }
        }
        if (time > next) {
          next = time + 1.6 + Math.random() * 2.2;
          const die = dice[Math.floor(Math.random() * dice.length)];
          die?.throwTo(1 + Math.floor(Math.random() * die.sides), {
            duration: 1.05,
            arc: 1.1,
            from: new THREE.Vector3(0, 3.5, 2.5),
          });
        }
      });
      stage.start();
    })();

    return () => {
      cancelled = true;
      for (const die of dice) die.dispose();
      stage?.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="stage-canvas" aria-hidden />;
}
