/**
 * The command deck: a real slab the fleet sits on, with nine cells, an edge
 * you can see, and the lines that light up when a formation fires.
 *
 * It is a lit, shadow-receiving object rather than a glowing plane, because the
 * single strongest cue that a die is *on* something is the shadow it casts.
 */

import * as THREE from "three";
import { DECK_PALETTE, PLAY_FRACTION, cellOffset, paintDeck } from "./deckArt";

export type BoardSide = "you" | "enemy";

/** Width of the whole deck plate in world units. */
export const DECK_SIZE = 11.4;
/** Distance between cell centres. */
export const CELL = (DECK_SIZE * PLAY_FRACTION) / 3;
export const DECK_THICKNESS = 0.42;

export type Board = {
  group: THREE.Group;
  /** Local position of the centre of a 3×3 cell, 0–8, on the deck surface. */
  cellPosition(cell: number): THREE.Vector3;
  setCellOpen(cell: number, open: boolean): void;
  /** Highlight a row or column while a formation pays out. */
  flashLine(cells: number[], color: THREE.ColorRepresentation): void;
  /** Which cells are part of the straight. */
  setRunCells(cells: number[]): void;
  /** Ripple the deck when something lands on it. */
  impact(cell: number, strength: number): void;
  update(dt: number, time: number): void;
  dispose(): void;
};

export function cellCentre(cell: number): THREE.Vector3 {
  const offset = cellOffset(cell);
  return new THREE.Vector3(offset.x * DECK_SIZE, 0, offset.z * DECK_SIZE);
}

/* ------------------------------------------------------------------ */

export function createBoard(side: BoardSide, font: string): Board {
  const palette = DECK_PALETTE[side];
  const rim = new THREE.Color(palette.rim);
  const group = new THREE.Group();

  const albedo = new THREE.CanvasTexture(paintDeck(palette, "albedo", font));
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 8;
  const emissive = new THREE.CanvasTexture(paintDeck(palette, "emissive", font));
  emissive.colorSpace = THREE.SRGBColorSpace;

  const topMaterial = new THREE.MeshPhysicalMaterial({
    map: albedo,
    emissiveMap: emissive,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.48,
    roughness: 0.46,
    metalness: 0.45,
    clearcoat: 0.35,
    clearcoatRoughness: 0.45,
    envMapIntensity: 0.9,
  });
  const sideMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(palette.plateDark),
    roughness: 0.55,
    metalness: 0.6,
  });

  // Box faces are ordered +X, −X, +Y, −Y, +Z, −Z, so the painted plate goes on +Y.
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(DECK_SIZE, DECK_THICKNESS, DECK_SIZE),
    [sideMaterial, sideMaterial, topMaterial, sideMaterial, sideMaterial, sideMaterial],
  );
  slab.position.y = -DECK_THICKNESS / 2;
  slab.receiveShadow = true;
  group.add(slab);

  // A lit strip running around the edge of the slab.
  const trimGeometry = new THREE.BoxGeometry(DECK_SIZE + 0.16, 0.07, DECK_SIZE + 0.16);
  const trimMaterial = new THREE.MeshBasicMaterial({ color: rim, transparent: true, opacity: 0.55 });
  const trim = new THREE.Mesh(trimGeometry, trimMaterial);
  trim.position.y = -0.05;
  group.add(trim);

  // The pool of light the deck floats in.
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(DECK_SIZE * 2.1, DECK_SIZE * 2.1),
    new THREE.MeshBasicMaterial({
      color: rim,
      transparent: true,
      opacity: 0.045,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: softDisc(),
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -DECK_THICKNESS - 0.02;
  halo.renderOrder = -3;
  group.add(halo);

  // Locked cells get a dark cap so they read as sealed rather than empty.
  const capMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x05080f),
    roughness: 0.85,
    metalness: 0.2,
    transparent: true,
    opacity: 0.94,
  });
  const caps: THREE.Mesh[] = [];
  for (let cell = 0; cell < 9; cell += 1) {
    const cap = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92),
      capMaterial.clone(),
    );
    cap.rotation.x = -Math.PI / 2;
    const centre = cellCentre(cell);
    cap.position.set(centre.x, 0.006, centre.z);
    cap.visible = false;
    group.add(cap);
    caps.push(cap);
  }

  // The orange bar that marks a die as part of the straight.
  const runBars: THREE.Mesh[] = [];
  for (let cell = 0; cell < 9; cell += 1) {
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.7, 0.13),
      new THREE.MeshBasicMaterial({
        color: 0xff9d2e,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    bar.rotation.x = -Math.PI / 2;
    const centre = cellCentre(cell);
    bar.position.set(centre.x, 0.014, centre.z + CELL * 0.4);
    bar.visible = false;
    group.add(bar);
    runBars.push(bar);
  }

  const lineFlashes: { mesh: THREE.Mesh; life: number }[] = [];
  const ripples: { mesh: THREE.Mesh; life: number; strength: number }[] = [];

  const board: Board = {
    group,
    cellPosition(cell) {
      return cellCentre(cell);
    },
    setCellOpen(cell, open) {
      const cap = caps[cell];
      if (cap) cap.visible = !open;
    },
    flashLine(cells, color) {
      if (cells.length < 2) return;
      const first = cellCentre(cells[0]!);
      const last = cellCentre(cells[cells.length - 1]!);
      const horizontal = Math.abs(first.z - last.z) < 0.01;
      const length = CELL * 3.05;
      const mesh = new THREE.Mesh(
        horizontal
          ? new THREE.PlaneGeometry(length, CELL * 0.46)
          : new THREE.PlaneGeometry(CELL * 0.46, length),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.38,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          map: softBar(horizontal),
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((first.x + last.x) / 2, 0.022, (first.z + last.z) / 2);
      group.add(mesh);
      lineFlashes.push({ mesh, life: 1 });
    },
    setRunCells(cells) {
      const wanted = new Set(cells);
      runBars.forEach((bar, cell) => {
        bar.visible = wanted.has(cell);
      });
    },
    impact(cell, strength) {
      const centre = cellCentre(cell);
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.34, 40),
        new THREE.MeshBasicMaterial({
          color: rim,
          transparent: true,
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(centre.x, 0.03, centre.z);
      group.add(mesh);
      ripples.push({ mesh, life: 1, strength });
    },
    update(dt, time) {
      trimMaterial.opacity = 0.4 + Math.sin(time * 0.8) * 0.08;

      for (let i = lineFlashes.length - 1; i >= 0; i -= 1) {
        const flash = lineFlashes[i]!;
        flash.life -= dt * 0.85;
        const material = flash.mesh.material as THREE.MeshBasicMaterial;
        material.opacity = Math.max(0, flash.life) * 0.38;
        if (flash.life <= 0) {
          group.remove(flash.mesh);
          flash.mesh.geometry.dispose();
          material.map?.dispose();
          material.dispose();
          lineFlashes.splice(i, 1);
        }
      }

      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        const ripple = ripples[i]!;
        ripple.life -= dt * 2.4;
        const material = ripple.mesh.material as THREE.MeshBasicMaterial;
        const grow = (1 - ripple.life) * 4.2 * ripple.strength;
        ripple.mesh.scale.setScalar(1 + grow);
        material.opacity = Math.max(0, ripple.life) * 0.6;
        if (ripple.life <= 0) {
          group.remove(ripple.mesh);
          ripple.mesh.geometry.dispose();
          material.dispose();
          ripples.splice(i, 1);
        }
      }

      for (const bar of runBars) {
        if (!bar.visible) continue;
        (bar.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(time * 4.5) * 0.3;
      }
    },
    dispose() {
      albedo.dispose();
      emissive.dispose();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) for (const entry of material) entry.dispose();
          else material.dispose();
        }
      });
      group.removeFromParent();
    },
  };

  for (let cell = 0; cell < 9; cell += 1) board.setCellOpen(cell, true);
  return board;
}

/* ------------------------------------------------------------------ */

let disc: THREE.CanvasTexture | null = null;
function softDisc(): THREE.CanvasTexture {
  if (disc) return disc;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.3)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  disc = new THREE.CanvasTexture(canvas);
  return disc;
}

function softBar(horizontal: boolean): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = horizontal
    ? ctx.createLinearGradient(0, 0, 0, size)
    : ctx.createLinearGradient(0, 0, size, 0);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.5, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
