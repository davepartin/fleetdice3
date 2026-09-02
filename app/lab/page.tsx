"use client";

/**
 * A bench for looking at the board on its own.
 * Not linked from anywhere in the game — it exists so the art can be judged.
 *
 * ?view=sheet   contact sheet of every hull and every state
 * ?throw=1      roll on load
 * ?q=low        force a quality tier
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createStage, type Quality } from "@/lib/three/stage";
import { createDie, type Die, type DieKind } from "@/lib/three/die";
import { createBoard, cellCentre } from "@/lib/three/board";
import { displayFontFamily, waitForFonts } from "@/lib/three/fonts";

export default function Lab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view") ?? "board";
    const doThrow = params.get("throw") === "1";
    const quality = (params.get("q") as Quality) || "high";

    let stage: ReturnType<typeof createStage> | null = null;
    const dice: Die[] = [];
    let board: ReturnType<typeof createBoard> | null = null;
    let cancelled = false;

    (async () => {
      await waitForFonts();
      if (cancelled) return;
      stage = createStage(canvas, quality);
      const font = displayFontFamily();

      if (view === "faces") {
        // Every face of every hull, dead-on and static. If a die is showing the
        // wrong number or sitting at the wrong angle, it is obvious here.
        stage.setFrame(
          { pitch: 51, fitWidth: 26, fitDepth: 18, target: new THREE.Vector3(0, 0, 0), parallax: 0 },
          true,
        );
        const rows: DieKind[] = ["flag", 4, 6, 8, 10];
        rows.forEach((kind, row) => {
          const sides = kind === "flag" ? 6 : kind;
          for (let face = 1; face <= sides; face += 1) {
            const die = createDie(kind, font, 1.14);
            const x = (face - (sides + 1) / 2) * 2.4;
            const home = new THREE.Vector3(x, 0, (row - 2) * 2.9);
            home.y = die.seatHeight;
            die.setHome(home);
            die.object.position.copy(home);
            die.setFace(face);
            stage!.world.add(die.object);
            dice.push(die);
          }
        });
      } else if (view === "sheet") {
        stage.setFrame({ pitch: 2, fitWidth: 20, fitDepth: 12, target: new THREE.Vector3(0, 0, 0), parallax: 0.4 }, true);
        const place = (die: Die, x: number, y: number) => {
          const home = new THREE.Vector3(x, y, 0);
          die.setHome(home);
          die.object.position.copy(home);
          stage!.world.add(die.object);
          dice.push(die);
        };
        const kinds: DieKind[] = [4, 6, 8, 10, "flag"];
        kinds.forEach((kind, index) => {
          const die = createDie(kind, font, 1);
          place(die, (index - 2) * 3.5, 3.1);
          die.setFace(kind === "flag" ? 6 : (kind as number));
        });
        for (let i = 0; i < 5; i += 1) {
          const die = createDie(10, font, 0.9);
          place(die, (i - 2) * 3.5, -0.4);
          die.setFace(i * 2 + 2);
        }
        const states = [
          {},
          { selected: true },
          { inRun: true },
          { inLine: "col" as const },
          { disabled: true },
        ];
        states.forEach((state, index) => {
          const die = createDie(6, font, 0.9);
          place(die, (index - 2) * 3.5, -3.9);
          die.setFace(index + 1);
          die.setState(state);
        });
      } else {
        // The real thing: one fleet on its deck, seen from the commander's chair.
        stage.setFrame({ pitch: 50, fitWidth: 13, fitDepth: 13, target: new THREE.Vector3(0, 0.4, 0), parallax: 0.7 }, true);

        board = createBoard("you", font);
        stage.world.add(board.group);

        const layout: (DieKind | null)[] = [4, 6, 8, null, "flag", 10, 6, null, 4];
        const values = [1, 3, 5, 0, 4, 7, 2, 0, 4];
        layout.forEach((kind, cell) => {
          if (!kind) {
            board!.setCellOpen(cell, false);
            return;
          }
          board!.setCellOpen(cell, true);
          const die = createDie(kind, font, 1);
          const centre = cellCentre(cell);
          centre.y = die.seatHeight;
          die.setHome(centre);
          die.object.position.copy(centre);
          die.setFace(values[cell]!);
          stage!.world.add(die.object);
          dice.push(die);
        });
        dice[2]?.setState({ selected: true });
        board.setRunCells([0, 1, 2]);
        board.flashLine([0, 3, 6], 0xff4d4d);
      }

      stage.onFrame((dt, time) => {
        board?.update(dt, time);
        for (const die of dice) die.update(dt, time);
      });
      stage.start();
      setReady(true);

      if (doThrow) {
        window.setTimeout(() => {
          dice.forEach((die, index) => {
            die.throwTo(1 + Math.floor(Math.random() * die.sides), {
              delay: index * 0.05,
              duration: 0.85,
            });
          });
        }, 700);
      }
    })();

    return () => {
      cancelled = true;
      for (const die of dice) die.dispose();
      board?.dispose();
      stage?.dispose();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="stage-canvas" />
      <div className="hud">
        <div className="p-5">
          <p className="t-eyebrow">Bench</p>
          <h1 className="t-display text-3xl">Fleet Dice</h1>
          <p className="mt-1 text-sm c-dim">{ready ? "stage running" : "booting"}</p>
        </div>
      </div>
    </>
  );
}
