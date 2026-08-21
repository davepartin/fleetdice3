/**
 * A single die on the board: the hull, the glow under it, and the throw.
 *
 * The throw is choreographed rather than simulated. Real physics gives you a
 * die that lands on whatever face it likes, and this game already knows what it
 * rolled — so instead the die tumbles freely for most of the flight and then
 * settles onto the face it owes you. It reads as physical and it never lies.
 */

import * as THREE from "three";
import { buildDie, type BuiltDie } from "./polyhedron";
import { buildAtlas, faceSpec, flagFaceSpec, type Atlas } from "./faceArt";

export type DieKind = 4 | 6 | 8 | 10 | "flag";

export type DieState = {
  /** Picked for a reroll — lifts and pulses. */
  selected?: boolean;
  /** Part of the straight — orange bar under the hull. */
  inRun?: boolean;
  /** Part of a matching row or column. */
  inLine?: "row" | "col" | null;
  /** Damaged: sat out this round. */
  disabled?: boolean;
  /** Ringed by the flagship's face bonus. */
  flagRing?: boolean;
  /** Fleet Dice 1 semantic colour for the current flagship bonus. */
  flagRingColor?: number;
  /** Chosen to absorb the incoming volley. */
  damageSelected?: boolean;
  /** Dimmed because it belongs to the other commander. */
  enemy?: boolean;
  /**
   * Their fleet, before the reveal. The hull is there — you can count it and
   * see how big it is, which you could do across a real table — but the face
   * is blank until both commanders have locked in.
   */
  facedown?: boolean;
};

const HULL_COLOR = 0xffffff;
const HULL_ENEMY = 0xfff2f2;

/* ------------------------------------------------------------------ */
/* Shared, cached across every die of a size                           */
/* ------------------------------------------------------------------ */

type Shared = {
  built: BuiltDie;
  atlas: Atlas;
  material: THREE.MeshPhysicalMaterial;
  /** A blank hull, for a fleet that has not shown its roll yet. */
  hidden: THREE.MeshPhysicalMaterial;
  outline: THREE.Material;
  outlineGeometry: THREE.BufferGeometry;
};

const CACHE = new Map<string, Shared>();

function sharedFor(kind: DieKind, font: string): Shared {
  const key = `${kind}|${font}`;
  const hit = CACHE.get(key);
  if (hit) return hit;

  const sides = kind === "flag" ? 6 : kind;
  const specs =
    kind === "flag"
      ? Array.from({ length: 6 }, (_, index) => flagFaceSpec(index + 1))
      : Array.from({ length: sides }, (_, index) => faceSpec(index + 1));

  // 384px per face keeps glyph edges clean after the steep phone-camera
  // projection without the large memory jump of a 512px d10 atlas.
  const atlas = buildAtlas(specs, sides, 384, font);
  const built = buildDie(sides, 1, atlas.columns, atlas.rows);

  const material = new THREE.MeshPhysicalMaterial({
    map: atlas.map,
    emissiveMap: atlas.emissive,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: kind === "flag" ? 0.04 : 0.14,
    color: new THREE.Color(HULL_COLOR),
    // Gaming dice are resin, not chrome. A metal die in a dark room is a black
    // die: the colour of metal comes entirely from what it reflects, and space
    // has nothing to reflect. Low metalness plus a hard clearcoat gives the
    // polished-resin look these want, and keeps red reading red.
    metalness: 0.04,
    roughness: 0.48,
    clearcoat: 0.42,
    clearcoatRoughness: 0.34,
    reflectivity: 0.32,
    envMapIntensity: 0.66,
  });

  // A slightly larger shell drawn from the inside gives a clean dark rim, which
  // is what stops the dice dissolving into the background at phone size.
  const outlineGeometry = built.geometry.clone();
  const outline = new THREE.MeshBasicMaterial({
    color: 0x020409,
    side: THREE.BackSide,
  });

  const hidden = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x2b3450),
    metalness: 0.35,
    roughness: 0.52,
    clearcoat: 0.7,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.9,
  });

  const shared: Shared = { built, atlas, material, hidden, outline, outlineGeometry };
  CACHE.set(key, shared);
  return shared;
}

export function clearDieCache() {
  for (const shared of CACHE.values()) {
    shared.built.geometry.dispose();
    shared.outlineGeometry.dispose();
    shared.atlas.dispose();
    shared.material.dispose();
    shared.hidden.dispose();
    (shared.outline as THREE.Material).dispose();
  }
  CACHE.clear();
}

/* ------------------------------------------------------------------ */

const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);
const EASE_OUT_BACK = (t: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

export type Die = {
  object: THREE.Group;
  kind: DieKind;
  sides: number;
  /** How far above the deck this die's centre sits when it is at rest. */
  seatHeight: number;
  value: number;
  /** True while the die is still in the air. */
  rolling: boolean;
  home: THREE.Vector3;
  setHome(position: THREE.Vector3): void;
  setFace(value: number): void;
  throwTo(value: number, options?: ThrowOptions): void;
  setState(state: DieState): void;
  nudge(strength?: number): void;
  /** Diagnostics for the screenshot harness. */
  stats(): Record<string, unknown>;
  update(dt: number, time: number): void;
  dispose(): void;
};

export type ThrowOptions = {
  /** Seconds before the die leaves the hand. */
  delay?: number;
  /** Seconds of flight. */
  duration?: number;
  /** Where it comes from, relative to home. */
  from?: THREE.Vector3;
  /** How high the arc peaks. */
  arc?: number;
  onLand?: () => void;
};

/**
 * How far the face leans back from vertical, in radians. The board is seen from
 * above, so a die whose face points dead ahead is read at a squint; leaning the
 * face up toward the camera keeps the number square-on without lifting the die
 * off the deck.
 */
const FACE_LEAN = 0.66;
// Match the solo command camera's 70 degree pitch. When the resolved face is
// square to the lens, neighbouring facets do not leak into the information
// face and the number/marks receive the maximum possible phone pixels.
const PHONE_FACE_LEAN = 1.22;

export function createDie(kind: DieKind, font: string, scale = 1): Die {
  const shared = sharedFor(kind, font);
  const sides = kind === "flag" ? 6 : kind;
  // Solo phone dice are deliberately oversized (scale 1.52) and viewed from a
  // steeper command camera. Aim their resolved face farther upward as well so
  // the number and payoff marks stay square to the player's eye.
  const faceLean = scale >= 1.45 ? PHONE_FACE_LEAN : FACE_LEAN;
  const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -faceLean);

  const object = new THREE.Group();
  const pivot = new THREE.Group();
  object.add(pivot);

  const material = shared.material.clone();
  const mesh = new THREE.Mesh(shared.built.geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  pivot.add(mesh);

  const outline = new THREE.Mesh(shared.outlineGeometry, shared.outline);
  outline.scale.setScalar(1.035);
  pivot.add(outline);

  // The pool of light the die sits in. A flat decal on the deck, not a sprite —
  // a sprite turns to face the camera and ends up painted over the die's face.
  const glowMaterial = new THREE.MeshBasicMaterial({
    map: radialSprite(),
    color: new THREE.Color(0x4db4ff),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(shared.built.radius * 2.6, shared.built.radius * 2.6),
    glowMaterial,
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -shared.built.seatHeight * 0.94;
  glow.renderOrder = -1;
  object.add(glow);

  // A painted contact shadow. Real shadow maps are switched off on the lower
  // quality tiers, and without *something* dark directly beneath it a die does
  // not read as resting on the deck — it reads as hovering over it.
  const contactMaterial = new THREE.MeshBasicMaterial({
    map: radialSprite(),
    color: new THREE.Color(0x000000),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(shared.built.radius * 2.1, shared.built.radius * 2.1),
    contactMaterial,
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = -shared.built.seatHeight * 0.99;
  contact.renderOrder = -2;
  object.add(contact);

  // The orange bar that says "this die is in the straight".
  const barMaterial = new THREE.MeshBasicMaterial({
    color: 0xff9d2e,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const bar = new THREE.Mesh(
    new THREE.PlaneGeometry(shared.built.radius * 1.7, 0.16),
    barMaterial,
  );
  bar.rotation.x = -Math.PI / 2;
  bar.position.set(0, -shared.built.seatHeight * 0.98, shared.built.radius * 0.72);
  object.add(bar);

  // The thin ring the flagship draws around matching ships.
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd23d,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(shared.built.radius * 1.05, shared.built.radius * 1.2, 72),
    ringMaterial,
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -shared.built.seatHeight * 0.96;
  object.add(ring);

  // Selection is a gameplay state, not a lighting effect. A larger cyan ring
  // plus the physical lift stays obvious in grayscale and leaves the face
  // exposure untouched; gold rings remain reserved for scoring bonuses.
  const selectionMaterial = new THREE.MeshBasicMaterial({
    color: 0x69dcff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // The cube's circumscribed radius reaches its corners, so using it directly
  // made the flagship selection ring spill through three neighbouring cells.
  // A footprint radius hugs the square body while keeping the shared marker
  // language used by every other die.
  const selectionRadius = kind === "flag" ? shared.built.radius * 0.65 : shared.built.radius;
  const selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(selectionRadius * 1.18, selectionRadius * 1.27, 72),
    selectionMaterial,
  );
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.position.y = -shared.built.seatHeight * 0.95;
  object.add(selectionRing);

  // Bracing is deliberately not the same cyan reroll state. A steady red
  // target and X beneath the die makes "this ship will take damage" readable
  // without relying on motion, glow, or the dock copy.
  const damageMaterial = new THREE.MeshBasicMaterial({
    color: 0xff4056,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const damageRing = new THREE.Mesh(
    new THREE.RingGeometry(shared.built.radius * 1.18, shared.built.radius * 1.38, 72),
    damageMaterial,
  );
  damageRing.rotation.x = -Math.PI / 2;
  damageRing.position.y = -shared.built.seatHeight * 0.94;
  object.add(damageRing);

  const damageBars: THREE.Mesh[] = [];
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(shared.built.radius * 1.55, shared.built.radius * 0.16),
      damageMaterial.clone(),
    );
    bar.rotation.set(-Math.PI / 2, 0, angle);
    bar.position.y = -shared.built.seatHeight * 0.93;
    object.add(bar);
    damageBars.push(bar);
  }

  object.scale.setScalar(scale);

  const home = new THREE.Vector3();
  const state: DieState = {};
  let value = 1;
  let rolling = false;

  // Flight
  let flightTime = 0;
  let flightDelay = 0;
  let flightDuration = 0;
  let flightArc = 0;
  let flightFrom = new THREE.Vector3();
  let targetQuaternion = new THREE.Quaternion();
  let settleFrom = new THREE.Quaternion();
  let settleCaptured = false;
  let spinAxis = new THREE.Vector3(1, 0, 0);
  let spinSpeed = 0;
  let onLand: (() => void) | undefined;
  let landPunch = 0;
  let idleSeed = Math.random() * 100;
  let throwCount = 0;
  let frameCount = 0;

  function frameFor(faceValue: number): THREE.Quaternion {
    const frame = shared.built.frames[(faceValue - 1) % shared.built.frames.length];
    const base = frame ? frame.quaternion.clone() : new THREE.Quaternion();
    return lean.clone().multiply(base);
  }

  function applyStateColours() {
    mesh.material = state.facedown ? shared.hidden : material;
    contactMaterial.opacity = state.disabled ? 0.28 : 0.5;
    if (state.facedown) {
      glowMaterial.opacity = 0;
      barMaterial.opacity = 0;
      ringMaterial.opacity = 0;
      selectionMaterial.opacity = 0;
      damageMaterial.opacity = 0;
      for (const damageBar of damageBars) {
        (damageBar.material as THREE.MeshBasicMaterial).opacity = 0;
      }
      return;
    }
    const even = value % 2 === 0;
    const accent = kind === "flag" ? 0xffd23d : even ? 0xff4d4d : 0x4db4ff;
    glowMaterial.color.setHex(accent);
    // Keep the authored face colours intact. The old peach multiplier on the
    // flagship turned yellow into muddy brown and purple into grey on Safari.
    material.color.setHex(state.enemy ? HULL_ENEMY : HULL_COLOR);

    if (state.disabled) {
      material.emissiveIntensity = 0.05;
      material.color.setHex(0x39414f);
      material.roughness = 0.9;
      material.metalness = 0.02;
      glowMaterial.opacity = 0;
    } else {
      material.roughness = 0.48;
      material.metalness = 0.04;
      material.emissiveIntensity = state.selected
        ? kind === "flag" ? 0.07 : 0.2
        : state.enemy
          ? 0.1
          : kind === "flag" ? 0.04 : 0.14;
      glowMaterial.opacity = state.selected ? 0.34 : 0.08;
    }
    selectionMaterial.opacity = !state.disabled && state.selected && !state.damageSelected ? 0.72 : 0;
    damageMaterial.opacity = !state.disabled && state.damageSelected ? 0.94 : 0;
    for (const damageBar of damageBars) {
      (damageBar.material as THREE.MeshBasicMaterial).opacity = damageMaterial.opacity;
    }
    barMaterial.opacity = state.inRun ? 0.95 : 0;
    if (state.inLine) {
      ringMaterial.color.setHex(state.inLine === "col" ? 0xff4d4d : 0xffd23d);
      ringMaterial.opacity = 0.85;
    } else if (state.flagRing) {
      ringMaterial.color.setHex(state.flagRingColor ?? 0xffd23d);
      ringMaterial.opacity = 0.82;
    } else {
      ringMaterial.opacity = 0;
    }
  }

  const die: Die = {
    object,
    kind,
    sides,
    seatHeight: shared.built.seatHeight * scale,
    get value() {
      return value;
    },
    get rolling() {
      return rolling;
    },
    home,
    setHome(position) {
      home.copy(position);
      if (!rolling) object.position.copy(home);
    },
    setFace(next) {
      value = clampFace(next, sides);
      pivot.quaternion.copy(frameFor(value));
      rolling = false;
      applyStateColours();
    },
    throwTo(next, options = {}) {
      value = clampFace(next, sides);
      targetQuaternion = frameFor(value);
      flightDelay = options.delay ?? 0;
      flightDuration = options.duration ?? 0.78;
      flightArc = options.arc ?? 2.6;
      flightFrom = options.from
        ? home.clone().add(options.from)
        : home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 5.5, 3.4));
      flightTime = 0;
      settleCaptured = false;
      rolling = true;
      throwCount += 1;
      onLand = options.onLand;
      spinAxis = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      spinSpeed = 13 + Math.random() * 9;
      object.position.copy(flightFrom);
      applyStateColours();
    },
    setState(next) {
      Object.assign(state, next);
      applyStateColours();
    },
    nudge(strength = 1) {
      landPunch = Math.max(landPunch, 0.5 * strength);
      spinAxis = new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize();
    },
    update(dt, time) {
      frameCount += 1;
      const lift = (state.selected || state.damageSelected) && !rolling ? 0.42 : 0;
      const idle = state.disabled ? 0 : Math.sin(time * 1.15 + idleSeed) * 0.055;

      if (rolling) {
        flightTime += dt;
        // The higher it is, the wider and fainter the shadow beneath it.
        const lift = Math.max(0, object.position.y - home.y);
        contactMaterial.opacity = Math.max(0.06, 0.5 - lift * 0.1);
        contact.scale.setScalar(1 + lift * 0.16);
        const t = Math.min(1, Math.max(0, (flightTime - flightDelay) / flightDuration));
        if (flightTime < flightDelay) {
          object.position.copy(flightFrom);
        } else {
          const settleStart = 0.62;
          if (t < settleStart) {
            pivot.rotateOnAxis(spinAxis, spinSpeed * dt * (1 - t * 0.5));
          } else {
            if (!settleCaptured) {
              settleFrom = pivot.quaternion.clone();
              settleCaptured = true;
            }
            const k = EASE_OUT((t - settleStart) / (1 - settleStart));
            pivot.quaternion.copy(settleFrom).slerp(targetQuaternion, k);
          }

          const eased = EASE_OUT(t);
          object.position.lerpVectors(flightFrom, home, eased);
          // The arc: up on the way out, snapping down at the end.
          object.position.y += Math.sin(Math.PI * t) * flightArc * (1 - t * 0.35);

          if (t >= 1) {
            rolling = false;
            pivot.quaternion.copy(targetQuaternion);
            object.position.copy(home);
            landPunch = 1;
            onLand?.();
            onLand = undefined;
          }
        }
      } else {
        contactMaterial.opacity += (0.5 - contactMaterial.opacity) * Math.min(1, dt * 8);
        contact.scale.setScalar(contact.scale.x + (1 - contact.scale.x) * Math.min(1, dt * 8));
        object.position.x += (home.x - object.position.x) * Math.min(1, dt * 14);
        object.position.z += (home.z - object.position.z) * Math.min(1, dt * 14);
        const targetY = home.y + lift + idle;
        object.position.y += (targetY - object.position.y) * Math.min(1, dt * 12);
      }

      // Squash on landing, then spring back.
      if (landPunch > 0) {
        landPunch = Math.max(0, landPunch - dt * 3.4);
        const punch = EASE_OUT_BACK(1 - landPunch);
        const squash = 1 + (1 - punch) * 0.26;
        pivot.scale.set(squash, 2 - squash, squash);
      } else if (pivot.scale.x !== 1) {
        pivot.scale.setScalar(1);
      }

      if (state.selected) {
        const pulse = 0.36 + Math.sin(time * 7) * 0.16;
        glowMaterial.opacity = pulse;
        const base = kind === "flag" ? 0.05 : 0.17;
        material.emissiveIntensity = base + Math.sin(time * 7) * 0.025;
        selectionMaterial.opacity = 0.6 + Math.sin(time * 7) * 0.1;
      }
      if (state.inRun) {
        barMaterial.opacity = 0.7 + Math.sin(time * 4.5) * 0.28;
      }
      if (ringMaterial.opacity > 0) {
        ring.rotation.z += dt * 0.55;
      }
    },
    stats() {
      return { throwCount, frameCount, flightTime, flightDelay, flightDuration, rolling };
    },
    dispose() {
      material.dispose();
      glow.geometry.dispose();
      glowMaterial.dispose();
      contact.geometry.dispose();
      contactMaterial.dispose();
      barMaterial.dispose();
      bar.geometry.dispose();
      ringMaterial.dispose();
      ring.geometry.dispose();
      selectionMaterial.dispose();
      selectionRing.geometry.dispose();
      damageMaterial.dispose();
      damageRing.geometry.dispose();
      for (const damageBar of damageBars) {
        damageBar.geometry.dispose();
        (damageBar.material as THREE.Material).dispose();
      }
      object.removeFromParent();
    },
  } as Die;

  die.setFace(1);
  return die;
}

function clampFace(value: number, sides: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(sides, Math.max(1, Math.round(value)));
}

/* ------------------------------------------------------------------ */

let sprite: THREE.CanvasTexture | null = null;
function radialSprite(): THREE.CanvasTexture {
  if (sprite) return sprite;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.34, "rgba(255,255,255,0.26)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  sprite = new THREE.CanvasTexture(canvas);
  return sprite;
}
