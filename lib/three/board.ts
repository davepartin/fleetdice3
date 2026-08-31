/**
 * The command deck: a real slab the fleet sits on, with nine cells, an edge
 * you can see, and the lines that light up when a formation fires.
 *
 * It is a lit, shadow-receiving object rather than a glowing plane, because the
 * single strongest cue that a die is *on* something is the shadow it casts.
 */

import * as THREE from "three";
import { DECK_PALETTE, PLAY_FRACTION, cellOffset, paintDeck, paintEmptyMarker, paintLockCap } from "./deckArt";

export type BoardSide = "you" | "enemy";

/** Width of the whole deck plate in world units. */
export const DECK_SIZE = 11.4;
/** Distance between cell centres. */
export const CELL = (DECK_SIZE * PLAY_FRACTION) / 3;
export const DECK_THICKNESS = 0.42;

export type BoardFormation = {
  kind: "row" | "col";
  cells: number[];
  amount: number;
};

export type Board = {
  group: THREE.Group;
  /** Local position of the centre of a 3×3 cell, 0–8, on the deck surface. */
  cellPosition(cell: number): THREE.Vector3;
  setCellOpen(cell: number, open: boolean): void;
  /** An open cell with no ship in it yet: a soft plus, not a dark square. */
  setCellEmpty(cell: number, empty: boolean): void;
  /** Highlight a row or column while a formation pays out. */
  flashLine(cells: number[], color: THREE.ColorRepresentation): void;
  /** Which cells are part of the straight. */
  setRunCells(cells: number[]): void;
  /** Persistent line and payoff label for matching rows and columns. */
  setFormations(formations: BoardFormation[]): void;
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
    emissive: new THREE.Color(0xffffff), // --color-white
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

  // The deck used to just end at its own edge and hang there — a flat plate
  // in black space. A glow plate sitting just under it, wider than the deck
  // itself, bleeds a lit fringe out past the slab's own silhouette on every
  // side — the cue that reads as "resting on a lit platform" from directly
  // overhead (this game's normal phone angle occludes a true underside view,
  // so anything placed *under* the slab only helps if it peeks out past its
  // edges) as well as from the shallower wide result-screen camera.
  const padTexture = padGlowTexture();
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(DECK_SIZE * 1.28, DECK_SIZE * 1.28),
    new THREE.MeshBasicMaterial({
      map: padTexture,
      color: rim,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = -DECK_THICKNESS - 0.16;
  pad.renderOrder = -3;
  group.add(pad);

  // The painted play mat is the frame. An additional emissive strip and halo
  // outside it created a second cyan rectangle and wasted the phone's edge
  // pixels on decoration instead of dice.

  // Locked cells get a sealed hatch — hazard stripes and a padlock, not just
  // a dark square that could be mistaken for an empty or unlit cell.
  const lockTexture = new THREE.CanvasTexture(paintLockCap());
  lockTexture.colorSpace = THREE.SRGBColorSpace;
  // Half-lit on purpose. A locked bay is the least important thing on the
  // board — it is where nothing is happening — and at full strength the
  // hazard stripes pulled the eye away from the dice on every screen.
  const capMaterial = new THREE.MeshPhysicalMaterial({
    map: lockTexture,
    roughness: 0.85,
    metalness: 0.2,
    transparent: true,
    opacity: 0.45,
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

  // An open cell with no ship yet: a soft plus on bare deck, matching the
  // shipyard's own "Open bay" glyph — never a locked hatch, never a hull.
  const emptyTexture = new THREE.CanvasTexture(paintEmptyMarker());
  emptyTexture.colorSpace = THREE.SRGBColorSpace;
  const emptyMaterial = new THREE.MeshBasicMaterial({
    map: emptyTexture,
    transparent: true,
    depthWrite: false,
  });
  const emptyMarkers: THREE.Mesh[] = [];
  for (let cell = 0; cell < 9; cell += 1) {
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.55, CELL * 0.55),
      emptyMaterial.clone(),
    );
    marker.rotation.x = -Math.PI / 2;
    const centre = cellCentre(cell);
    marker.position.set(centre.x, 0.008, centre.z);
    marker.visible = false;
    group.add(marker);
    emptyMarkers.push(marker);
  }

  // The orange bar that marks a die as part of the straight.
  const runBars: THREE.Mesh[] = [];
  for (let cell = 0; cell < 9; cell += 1) {
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 0.7, 0.13),
      new THREE.MeshBasicMaterial({
        color: 0xff9d2e, // --color-run
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
  const formationGroup = new THREE.Group();
  group.add(formationGroup);
  let formationSignature = "";

  const clearFormations = () => {
    for (const child of [...formationGroup.children]) {
      formationGroup.remove(child);
      if (!(child instanceof THREE.Mesh)) continue;
      child.geometry.dispose();
      const material = child.material as THREE.Material | THREE.Material[];
      const materials = Array.isArray(material) ? material : [material];
      for (const entry of materials) {
        if (entry instanceof THREE.MeshBasicMaterial) entry.map?.dispose();
        entry.dispose();
      }
    }
  };

  const addFormation = (formation: BoardFormation) => {
    if (formation.cells.length < 3) return;
    const first = cellCentre(formation.cells[0]!);
    const last = cellCentre(formation.cells[formation.cells.length - 1]!);
    const row = formation.kind === "row";
    // row: --color-energy. column: close to but distinct from --color-attack.
    const colour = row ? 0xffd23d : 0xff4d5f;

    // A wide light channel runs through the actual centres of the matching
    // cells. Depth testing is intentional: the dice interrupt the rail, which
    // makes it feel embedded in the deck behind them instead of pasted over
    // their faces. A broad dim bed plus a narrow core gives the line weight
    // without turning it into a flat highlighter stroke.
    const centreX = row ? (first.x + last.x) / 2 : first.x;
    const centreZ = row ? first.z : (first.z + last.z) / 2;
    const addRailLayer = (thickness: number, opacity: number, height: number) => {
      const rail = new THREE.Mesh(
        row
          ? new THREE.PlaneGeometry(CELL * 2.92, thickness)
          : new THREE.PlaneGeometry(thickness, CELL * 2.92),
        new THREE.MeshBasicMaterial({
          color: colour,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
        }),
      );
      rail.rotation.x = -Math.PI / 2;
      rail.position.set(centreX, height, centreZ);
      rail.renderOrder = 1;
      formationGroup.add(rail);
    };
    addRailLayer(0.46, 0.2, 0.035);
    addRailLayer(0.18, 0.88, 0.045);

    const badge = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.76),
      new THREE.MeshBasicMaterial({
        map: formationBadgeTexture(formation.kind, formation.amount, font),
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    badge.rotation.x = -Math.PI / 2;
    badge.position.set(
      // The payoff anchors the far end of its rail, clear of the dice. The
      // number remains screen-facing while the physical rail stays underneath.
      row ? DECK_SIZE / 2 - 0.25 : first.x,
      0.14,
      row ? first.z : DECK_SIZE / 2 - 0.42,
    );
    badge.renderOrder = 5;
    formationGroup.add(badge);
  };

  const board: Board = {
    group,
    cellPosition(cell) {
      return cellCentre(cell);
    },
    setCellOpen(cell, open) {
      const cap = caps[cell];
      if (cap) cap.visible = !open;
    },
    setCellEmpty(cell, empty) {
      const marker = emptyMarkers[cell];
      if (marker) marker.visible = empty;
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
    setFormations(formations) {
      const signature = formations
        .map((formation) => `${formation.kind}:${formation.cells.join(",")}:${formation.amount}`)
        .sort()
        .join("|");
      if (signature === formationSignature) return;
      formationSignature = signature;
      clearFormations();
      for (const formation of formations) addFormation(formation);
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
    update(dt, _time) {
      // Persistent board state is deliberately steady. Motion is reserved for
      // brief impacts and payouts, never for information the player must read.
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
        (bar.material as THREE.MeshBasicMaterial).opacity = 0.78;
      }
    },
    dispose() {
      clearFormations();
      albedo.dispose();
      emissive.dispose();
      lockTexture.dispose();
      emptyTexture.dispose();
      padTexture.dispose();
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

/**
 * A ring of light, bright toward the outer edge and fading to nothing past
 * it. The deck's own opaque slab covers the centre of this texture — only
 * the ring past the slab's own radius is ever seen — so the centre stays
 * dim and the visible band is tuned to sit right where the slab's edge cuts
 * across it.
 */
function padGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0.2)");
  gradient.addColorStop(0.62, "rgba(255,255,255,0.85)");
  gradient.addColorStop(0.86, "rgba(255,255,255,0.85)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
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

function formationBadgeTexture(
  kind: "row" | "col",
  amount: number,
  font: string,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 192;
  const ctx = canvas.getContext("2d")!;
  // row: --color-energy. column: close to but distinct from --color-attack.
  const colour = kind === "row" ? "#ffd23d" : "#ff5a69";

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // The rail already explains which dice formed the reward. At phone size the
  // only useful label is the payout itself, so give it nearly the whole badge.
  ctx.font = `900 132px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(3,6,13,0.96)";
  ctx.lineWidth = 22;
  ctx.strokeText(`+${amount}`, 192, 101);
  ctx.shadowColor = colour;
  ctx.shadowBlur = 14;
  ctx.fillStyle = colour;
  ctx.fillText(`+${amount}`, 192, 101);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}
