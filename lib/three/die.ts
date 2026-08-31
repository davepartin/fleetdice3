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
import { buildAtlas, buildFacedownAtlas, faceSpec, flagFaceSpec, type Atlas } from "./faceArt";
import { numeralFontFamily } from "./fonts";

export type DieKind = 4 | 6 | 8 | 10 | "flag";

export type DieState = {
  /** Picked for a reroll — lifts with a steady marker. */
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
  /** Chosen to take the incoming volley. */
  damageSelected?: boolean;
  /**
   * Can be tapped to block right now. Breathes a slow gold pulse — the block
   * screen asks for a choice the board gives no other sign of, and a ship that
   * looks identical whether or not it can be tapped is not an invitation.
   */
  blockable?: boolean;
  /** Dimmed because it belongs to the other commander. */
  enemy?: boolean;
  /**
   * Their fleet, before the reveal. The hull is there — you can count it and
   * see how big it is, which you could do across a real table — but the face
   * is blank until both commanders have locked in.
   */
  facedown?: boolean;
};

const HULL_COLOR = 0xffffff; // --color-white
const HULL_ENEMY = 0xfff2f2; // a warm-white tint; no matching token — 3D-only

/* ------------------------------------------------------------------ */
/* Shared, cached across every die of a size                           */
/* ------------------------------------------------------------------ */

type Shared = {
  built: BuiltDie;
  atlas: Atlas;
  material: THREE.MeshPhysicalMaterial;
  /** A blank hull, for a fleet that has not shown its roll yet. */
  hidden: THREE.MeshPhysicalMaterial;
  spent: THREE.MeshPhysicalMaterial;
  /** The "D4"/"D6"/"D8"/"D10" label baked onto that blank hull. Hulls only — the flagship has no size to label. */
  hiddenMap: THREE.CanvasTexture | null;
  spentMap: THREE.CanvasTexture | null;
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
  // projection without the large memory jump of a 512px d10 atlas. The
  // numeral gets its own face — Archivo Black, plain and heavy enough to
  // survive at ~40px, tilted, on a saturated field — while `font` (Oxanium)
  // still sets the flagship's small word caption.
  const atlas = buildAtlas(specs, sides, 384, numeralFontFamily(), font);
  const built = buildDie(sides, 1, atlas.columns, atlas.rows);

  const material = new THREE.MeshPhysicalMaterial({
    map: atlas.map,
    emissiveMap: atlas.emissive,
    emissive: new THREE.Color(0xffffff), // --color-white
    emissiveIntensity: kind === "flag" ? 0.04 : 0.14,
    color: new THREE.Color(HULL_COLOR),
    // Gaming dice are resin, not chrome. A metal die in a dark room is a black
    // die: the colour of metal comes entirely from what it reflects, and space
    // has nothing to reflect. Low metalness plus a hard clearcoat gives the
    // polished-resin look these want, and keeps red reading red.
    metalness: 0.04,
    roughness: kind === "flag" ? 0.5 : 0.34,
    clearcoat: kind === "flag" ? 0.45 : 1,
    clearcoatRoughness: kind === "flag" ? 0.34 : 0.12,
    reflectivity: kind === "flag" ? 0.28 : 0.5,
    envMapIntensity: kind === "flag" ? 0.62 : 1.15,
  });

  // A slightly larger shell drawn from the inside gives a clean dark rim, which
  // is what stops the dice dissolving into the background at phone size.
  const outlineGeometry = built.geometry.clone();
  const outline = new THREE.MeshBasicMaterial({
    color: 0x020409, // near-void rim; no matching token — 3D-only
    side: THREE.BackSide,
  });

  // A fleet dice sitting unrolled still says which bay holds which hull —
  // that shape (and now its label) is information a player would have across
  // a real table, unlike the number it is about to roll.
  const hiddenMap = kind === "flag" ? null : buildFacedownAtlas(sides, 384, numeralFontFamily());
  const hidden = new THREE.MeshPhysicalMaterial({
    map: hiddenMap ?? undefined,
    // The tint used to live on the material; now it is baked into the label
    // texture instead, so the material itself stays neutral white.
    color: new THREE.Color(hiddenMap ? 0xffffff : 0x2b3450), // a facedown-hull blue-grey; no matching token — 3D-only
    metalness: 0.35,
    roughness: 0.52,
    clearcoat: 0.7,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.9,
  });

  // A ship that is out for the round: same hull, same size label, struck
  // through and warmed. Shared rather than cloned per die — every damaged
  // ship should look exactly alike.
  const spentMap =
    kind === "flag" ? null : buildFacedownAtlas(sides, 384, numeralFontFamily(), "spent");
  // Lit exactly like the facedown hull above. There is almost nothing to
  // reflect in this scene, so a rough, non-metal, clearcoat-less surface
  // renders as a black hole — which is precisely what a damaged ship looked
  // like before. The clearcoat and env intensity are what make it a hull.
  const spent = new THREE.MeshPhysicalMaterial({
    map: spentMap ?? undefined,
    color: new THREE.Color(spentMap ? 0xffffff : 0x4a2f36),
    metalness: 0.35,
    roughness: 0.52,
    clearcoat: 0.7,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.9,
  });

  const shared: Shared = { built, atlas, material, hidden, hiddenMap, spent, spentMap, outline, outlineGeometry };
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
    shared.hiddenMap?.dispose();
    shared.spent.dispose();
    shared.spentMap?.dispose();
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
  /** Blast this die off its seat instead of animating home to it — the
   *  losing fleet scattering at the end of a match. `impulse` is world-space
   *  velocity; gravity and spin take it from there. */
  launch(impulse: THREE.Vector3): void;
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
// Match the phone command camera's near-overhead pitch. When the resolved face is
// square to the lens, neighbouring facets do not leak into the information
// face and the number/marks receive the maximum possible phone pixels.
const PHONE_FACE_LEAN = 1.535;

export function createDie(kind: DieKind, font: string, scale = 1, cellSize = 0, phoneFraming = false): Die {
  const shared = sharedFor(kind, font);
  const sides = kind === "flag" ? 6 : kind;
  // Phone dice are deliberately oversized and viewed from a near-overhead
  // command camera. Aim their resolved face upward as well so the number and
  // payoff marks stay square to the player's eye. Which camera is showing
  // this die is an explicit flag rather than inferred from scale, since any
  // die (the flagship, most notably) can be scaled up for reasons that have
  // nothing to do with which camera is watching it.
  const faceLean = phoneFraming ? PHONE_FACE_LEAN : FACE_LEAN;
  const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -faceLean);

  const object = new THREE.Group();
  const pivot = new THREE.Group();
  object.add(pivot);

  const material = shared.material.clone();
  let activeFaceUniform: { value: number } | null = null;
  material.onBeforeCompile = (shader) => {
    // onBeforeCompile fires lazily, on this die's first real draw call — by
    // then `value` (declared below) already holds whatever face was set
    // before anything was ever rendered, so read it rather than assuming 1.
    shader.uniforms.uActiveFace = { value: value - 1 };
    activeFaceUniform = shader.uniforms.uActiveFace;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "attribute float faceIndex;\nvarying float vFaceIndex;\n#include <common>",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFaceIndex = faceIndex;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "uniform float uActiveFace;\nvarying float vFaceIndex;\n#include <common>",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          // A real d10 shows its neighbours; a readable one does not. Every
          // face but the one that was rolled sits at a third of its lit
          // brightness, flattened to grey, with its marks' glow switched off
          // — so a fleet of dice reads as one legible number each, not nine.
          float lit = abs(vFaceIndex - uActiveFace) < 0.5 ? 1.0 : 0.0;
          float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(vec3(luma) * 0.3, diffuseColor.rgb, lit);
          totalEmissiveRadiance *= lit;
        }`,
      );
  };
  const mesh = new THREE.Mesh(shared.built.geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  pivot.add(mesh);

  // Cloned per die rather than shared: an unrolled hull needs a lighter rim
  // than a rolled one, and the rim is the only thing that follows the hull's
  // real silhouette — anything painted into the face texture gets clipped by
  // the face shape, which is a triangle on a d4.
  const outlineMaterial = (shared.outline as THREE.MeshBasicMaterial).clone();
  const outline = new THREE.Mesh(shared.outlineGeometry, outlineMaterial);
  outline.scale.setScalar(1.012);
  pivot.add(outline);

  // The pool of light the die sits in. A flat decal on the deck, not a sprite —
  // a sprite turns to face the camera and ends up painted over the die's face.
  const glowMaterial = new THREE.MeshBasicMaterial({
    map: radialSprite(),
    color: new THREE.Color(0x4db4ff), // --color-shield
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(shared.built.radius * 2.2, shared.built.radius * 2.2),
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
    map: softShadowTexture(),
    color: new THREE.Color(0x000000), // pure black shadow decal, not a design token
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(shared.built.radius * 1.75, shared.built.radius * 1.55),
    contactMaterial,
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = -shared.built.seatHeight * 0.99;
  contact.renderOrder = -2;
  object.add(contact);

  // Straights are marked by the board, not by a second bar attached to every
  // hull. Hull-sized markers vary with d4/d6/d8/d10 geometry and make a clean
  // run look like a crooked stack of orange fragments.
  const barMaterial = new THREE.MeshBasicMaterial({
    color: 0xff9d2e, // --color-run
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

  // Every marker on this board is a square the size of the cell the die sits
  // in, and none of them blink.
  //
  // They used to be rings that pulsed. Three different circles pulsing at
  // different rates around a grid of squares read as an error state, not as
  // information — and on the damage screen, where you are being asked to pick
  // ships, motion is the last thing you want. A steady square that lines up
  // with the printed cell says "this one" without ever competing with the dice.
  const markerSize = (cellSize > 0 ? cellSize : shared.built.radius * 2.6) / Math.max(0.001, scale);

  /** The flagship's link: a pale wash filling the cell, in the flagship's colour. */
  const linkMaterial = new THREE.MeshBasicMaterial({
    map: squareTexture("fill"),
    color: 0xffd23d, // --color-energy
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Added rather than painted on, so the cell reads as lit by the flagship
    // rather than as a grey sticker sitting under the die.
    blending: THREE.AdditiveBlending,
  });
  const link = new THREE.Mesh(
    new THREE.PlaneGeometry(markerSize * 0.94, markerSize * 0.94),
    linkMaterial,
  );
  link.rotation.x = -Math.PI / 2;
  // Keep every marker decisively above the deck.  The old near-coplanar
  // placement intersected the board as the die idled, which looked exactly
  // like an opacity blink even though the material itself was steady.
  link.position.y = -shared.built.seatHeight + 0.06 / Math.max(0.001, scale);
  link.renderOrder = -1;
  object.add(link);

  /** Picked for a reroll. */
  const selectionMaterial = new THREE.MeshBasicMaterial({
    map: squareTexture("outline"),
    color: 0x69e6ff, // a brighter reroll-selection cyan; no matching token — 3D-only
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const selectionFillMaterial = new THREE.MeshBasicMaterial({
    map: squareTexture("fill"),
    color: 0x37cfff, // a brighter reroll-selection cyan; no matching token — 3D-only
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  // Every ship's reroll ring is the same size, flagship included — it is the
  // flagship's hull that is scaled down (see arena.ts), not its ring. Sized
  // just under one cell pitch so two adjacent selected dice's rings sit side
  // by side instead of overlapping into a single deformed shape.
  const selectionScale = 0.96;
  const selectionFill = new THREE.Mesh(
    new THREE.PlaneGeometry(markerSize * selectionScale, markerSize * selectionScale),
    selectionFillMaterial,
  );
  selectionFill.rotation.x = -Math.PI / 2;
  selectionFill.position.y = -shared.built.seatHeight + 0.075 / Math.max(0.001, scale);
  selectionFill.renderOrder = 0;
  object.add(selectionFill);
  const selectionSquare = new THREE.Mesh(
    new THREE.PlaneGeometry(markerSize * selectionScale, markerSize * selectionScale),
    selectionMaterial,
  );
  selectionSquare.rotation.x = -Math.PI / 2;
  selectionSquare.position.y = -shared.built.seatHeight + 0.09 / Math.max(0.001, scale);
  selectionSquare.renderOrder = 1;
  object.add(selectionSquare);

  /** This ship will take the hit. */
  const damageMaterial = new THREE.MeshBasicMaterial({
    map: squareTexture("outline"),
    color: 0xff4056, // a hotter damage-target red; no matching token — 3D-only
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const damageSquare = new THREE.Mesh(
    new THREE.PlaneGeometry(markerSize * 1.02, markerSize * 1.02),
    damageMaterial,
  );
  damageSquare.rotation.x = -Math.PI / 2;
  damageSquare.position.y = -shared.built.seatHeight + 0.1 / Math.max(0.001, scale);
  object.add(damageSquare);

  const damageBars: THREE.Mesh[] = [];
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(markerSize * 0.86, markerSize * 0.075),
      damageMaterial.clone(),
    );
    bar.rotation.set(-Math.PI / 2, 0, angle);
    bar.position.y = -shared.built.seatHeight + 0.11 / Math.max(0.001, scale);
    object.add(bar);
    damageBars.push(bar);
  }

  object.scale.setScalar(scale);

  const home = new THREE.Vector3();
  const state: DieState = {};
  let value = 1;
  let rolling = false;

  // Launch (post-match scatter)
  let launched = false;
  let launchAge = 0;
  const launchVel = new THREE.Vector3();
  let launchSpinAxis = new THREE.Vector3(1, 0, 0);
  let launchSpinSpeed = 0;

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
  // Set from state, applied per frame — the pulse has to survive re-syncs.
  let blockPulse = false;
  let throwCount = 0;
  let frameCount = 0;

  function frameFor(faceValue: number): THREE.Quaternion {
    const frame = shared.built.frames[(faceValue - 1) % shared.built.frames.length];
    const base = frame ? frame.quaternion.clone() : new THREE.Quaternion();
    return lean.clone().multiply(base);
  }

  function applyStateColours() {
    mesh.material = state.facedown
      ? shared.hidden
      : state.disabled && kind !== "flag"
        ? shared.spent
        : material;
    // A hull waiting to roll is nearly the colour of the deck under it. A grey
    // rim, thicker than the usual near-black one, is what makes a fleet read as
    // ships rather than as dark patches in the board.
    if (state.facedown) {
      outlineMaterial.color.setHex(state.enemy ? 0x5a6a92 : 0x8593b8); // --color-hull-400 / -300
      outline.scale.setScalar(1.055);
    } else if (state.disabled && kind !== "flag") {
      // The rim is what separates one damaged hull from the next when three
      // of them sit in a row.
      outlineMaterial.color.setHex(0xff4d4d); // --color-attack
      outline.scale.setScalar(1.06);
    } else {
      outlineMaterial.color.setHex(0x020409);
      outline.scale.setScalar(1.012);
    }
    contactMaterial.opacity = state.disabled ? 0.28 : 0.5;
    if (state.facedown) {
      glowMaterial.opacity = 0;
      barMaterial.opacity = 0;
      linkMaterial.opacity = 0;
      selectionMaterial.opacity = 0;
      damageMaterial.opacity = 0;
      for (const damageBar of damageBars) {
        (damageBar.material as THREE.MeshBasicMaterial).opacity = 0;
      }
      return;
    }
    const even = value % 2 === 0;
    // --color-energy : --color-attack : --color-shield
    const accent = kind === "flag" ? 0xffd23d : even ? 0xff4d4d : 0x4db4ff;
    glowMaterial.color.setHex(accent);
    // Keep the authored face colours intact. The old peach multiplier on the
    // flagship turned yellow into muddy brown and purple into grey on Safari.
    material.color.setHex(state.enemy ? HULL_ENEMY : HULL_COLOR);

    if (state.disabled) {
      // Zeroed, not dimmed: the emissive map still carries whatever colour
      // that face last rolled, and any nonzero intensity lets it bleed
      // through the tint below.
      material.emissiveIntensity = 0;
      // Crushed near-black rather than a specific tint — the base map is
      // whatever colour the die last rolled, and multiplying it by a hue
      // (even a dim one) mostly reproduces that colour, darker. Only a
      // near-neutral multiplier reliably drains it on every hull, on top of
      // the flattened shape the update loop settles it into.
      material.color.setHex(0x14161c);
      material.roughness = 0.9;
      material.metalness = 0.02;
      glowMaterial.opacity = 0;
    } else if (state.damageSelected) {
      // Committed to the volley: it is spent, and next round it is disabled
      // outright. Draining it now — rather than only stamping a mark on it —
      // makes "these are the ships I gave up" readable at a glance.
      material.roughness = 0.8;
      material.metalness = 0.02;
      material.color.setHex(0x4a5164);
      material.emissiveIntensity = 0.02;
      glowMaterial.opacity = 0;
    } else {
      material.roughness = kind === "flag" ? 0.5 : 0.34;
      material.metalness = 0.04;
      material.emissiveIntensity = state.selected
        ? kind === "flag" ? 0.07 : 0.2
        : state.enemy
          ? 0.1
          : kind === "flag" ? 0.04 : 0.14;
      glowMaterial.opacity = state.selected ? 0.3 : 0;
    }

    // Already picked reads through its own selection marker, so the invitation
    // stops the moment it is accepted.
    blockPulse = Boolean(state.blockable) && !state.disabled && !state.damageSelected;
    // Borrow the reroll marker rather than invent a second one: a ring around
    // the cell is already this game's word for "this die is live", and the pool
    // of light alone was invisible from the board's camera angle.
    if (blockPulse) {
      glowMaterial.color.setHex(0xffd23d); // --color-energy
      selectionMaterial.color.setHex(0xffd23d);
      selectionFillMaterial.color.setHex(0xffd23d);
    } else {
      selectionMaterial.color.setHex(0x69e6ff);
      selectionFillMaterial.color.setHex(0x37cfff);
    }
    const rerollSelected = !state.disabled && state.selected && !state.damageSelected;
    selectionMaterial.opacity = rerollSelected ? 1 : 0;
    // The black flagship shell covers more of its cell than a triangular hull,
    // so it gets a larger steady cyan plate as well as the same outline.
    selectionFillMaterial.opacity = rerollSelected ? kind === "flag" ? 0.4 : 0.08 : 0;
    // A ship that took the hit gets a plain red X next round. That is a real
    // state mark, not the ambiguous glow that made the enemy board look broken.
    // Only the ships picked this round get the X. A hull already out carries
    // its strike-through in the face itself, and stacking both marks on one
    // die read as noise rather than as two different states.
    damageMaterial.opacity = !state.disabled && state.damageSelected ? 0.94 : 0;
    for (const damageBar of damageBars) {
      (damageBar.material as THREE.MeshBasicMaterial).opacity = damageMaterial.opacity;
    }
    // A disabled die keeps whatever value it last rolled — it never rolls
    // again while sat out — so without this guard a frozen value that
    // happens to fall in this round's run or line could still light up a
    // scoring highlight on a ship that took no part in it.
    barMaterial.opacity = 0;
    if (state.disabled) {
      linkMaterial.opacity = 0;
    } else if (state.inLine) {
      // A column/row completion tint — close to but distinct from
      // --color-attack-glow / --color-energy-glow; no exact token match.
      linkMaterial.color.setHex(state.inLine === "col" ? 0xff8090 : 0xffe07a);
      linkMaterial.opacity = 0.72;
    } else if (state.flagRing) {
      // A light tint of the flagship's own face colour, so the connection is
      // obvious at a glance and obviously comes from the flagship.
      linkMaterial.color.setHex(lighten(state.flagRingColor ?? 0xffd23d, 0.34)); // fallback: --color-energy
      linkMaterial.opacity = 0.6;
    } else {
      linkMaterial.opacity = 0;
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
      if (launched) {
        // A new match reuses this same die if the ship configuration
        // matches — pull it back from whatever scattered flight it was on.
        launched = false;
        object.scale.setScalar(scale);
      }
      if (!rolling) object.position.copy(home);
    },
    setFace(next) {
      value = clampFace(next, sides);
      if (activeFaceUniform) activeFaceUniform.value = value - 1;
      pivot.quaternion.copy(frameFor(value));
      rolling = false;
      applyStateColours();
    },
    throwTo(next, options = {}) {
      value = clampFace(next, sides);
      if (activeFaceUniform) activeFaceUniform.value = value - 1;
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
    launch(impulse) {
      rolling = false;
      launched = true;
      launchAge = 0;
      launchVel.copy(impulse);
      launchSpinAxis = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      launchSpinSpeed = 7 + Math.random() * 9;
      // The deck-plane markers (glow, shadow, selection, run bar…) are all
      // children of `object` and would otherwise fly along with the die —
      // a floating shadow trailing a tumbling die reads as broken, not cool.
      contactMaterial.opacity = 0;
      glowMaterial.opacity = 0;
      barMaterial.opacity = 0;
      linkMaterial.opacity = 0;
      selectionMaterial.opacity = 0;
      selectionFillMaterial.opacity = 0;
      damageMaterial.opacity = 0;
      for (const damageBar of damageBars) {
        (damageBar.material as THREE.MeshBasicMaterial).opacity = 0;
      }
    },
    update(dt, time) {
      frameCount += 1;

      if (blockPulse) {
        // ~1.7s round trip. Slow enough to read as breathing rather than an
        // alarm — this is the calmest screen in the game and it should stay so.
        // Eased rather than a plain sine: a linear fade spends most of its
        // time near the middle, which is what made the old range read flat.
        // Squaring pushes the wave to its ends so the dark is properly dark
        // and the bright is properly bright.
        const raw = 0.5 + 0.5 * Math.sin(time * 3.7);
        const wave = raw * raw * (3 - 2 * raw);
        glowMaterial.opacity = 0.02 + wave * 0.66;
        selectionMaterial.opacity = 0.1 + wave * 0.9;
        selectionFillMaterial.opacity = wave * 0.2;
        material.emissiveIntensity = 0.06 + wave * 0.34;
      }

      if (launched) {
        launchAge += dt;
        launchVel.y -= 16 * dt;
        object.position.addScaledVector(launchVel, dt);
        pivot.rotateOnAxis(launchSpinAxis, launchSpinSpeed * dt);
        // Shrink to nothing shortly after the blast so a scattered board
        // doesn't leave dice tumbling through the dark indefinitely.
        const fadeStart = 0.9;
        if (launchAge > fadeStart) {
          const k = Math.min(1, (launchAge - fadeStart) / 0.5);
          object.scale.setScalar(scale * (1 - k));
          if (k >= 1) object.visible = false;
        }
        return;
      }

      const lift = (state.selected || state.damageSelected) && !rolling ? 0.42 : 0;

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
        // Resting dice stay physically planted. Besides improving clarity,
        // this guarantees that every persistent marker remains at one depth
        // instead of dipping into the deck and flickering on alternate frames.
        const targetY = home.y + lift;
        object.position.y += (targetY - object.position.y) * Math.min(1, dt * 12);
      }

      // Squash on landing, then spring back — or settle flat and stay there
      // while damaged. A ship that sat out the round is not just a dim die;
      // it is a collapsed one, so it never reads as merely "off."
      if (landPunch > 0) {
        landPunch = Math.max(0, landPunch - dt * 3.4);
        const punch = EASE_OUT_BACK(1 - landPunch);
        const squash = 1 + (1 - punch) * 0.26;
        pivot.scale.set(squash, 2 - squash, squash);
      } else {
        // Settled, not squashed. At 0.32 the hull collapsed into a puddle and
        // took its size with it — the one thing you need from a ship that is
        // out is which ship it was.
        const restY = state.disabled ? 0.66 : 1;
        const restXZ = state.disabled ? 1.06 : 1;
        if (
          Math.abs(pivot.scale.x - restXZ) > 0.001 ||
          Math.abs(pivot.scale.y - restY) > 0.001
        ) {
          const ease = Math.min(1, dt * 6);
          pivot.scale.x += (restXZ - pivot.scale.x) * ease;
          pivot.scale.z += (restXZ - pivot.scale.z) * ease;
          pivot.scale.y += (restY - pivot.scale.y) * ease;
        }
      }

      // Nothing on this board pulses. Selection, damage and the flagship link
      // are all steady squares — see the note where they are built.
    },
    stats() {
      return {
        throwCount, frameCount, flightTime, flightDelay, flightDuration, rolling,
        // The block-screen pulse is invisible to the DOM, so the harness needs
        // a way to prove it is actually breathing.
        blockPulse,
        glowOpacity: Number(glowMaterial.opacity.toFixed(3)),
      };
    },
    dispose() {
      material.dispose();
      outlineMaterial.dispose();
      glow.geometry.dispose();
      glowMaterial.dispose();
      contact.geometry.dispose();
      contactMaterial.dispose();
      barMaterial.dispose();
      bar.geometry.dispose();
      linkMaterial.dispose();
      link.geometry.dispose();
      selectionMaterial.dispose();
      selectionSquare.geometry.dispose();
      selectionFillMaterial.dispose();
      selectionFill.geometry.dispose();
      damageMaterial.dispose();
      damageSquare.geometry.dispose();
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

/** Mix a colour toward white. Used for the flagship's link square. */
function lighten(hex: number, amount: number): number {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/**
 * A rounded square, either filled with a soft edge or drawn as an outline.
 * Cached — every die on the board shares the same two textures.
 */
const SQUARES = new Map<string, THREE.CanvasTexture>();
function squareTexture(kind: "fill" | "outline"): THREE.CanvasTexture {
  const hit = SQUARES.get(kind);
  if (hit) return hit;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const pad = size * 0.06;
  const radius = size * 0.13;

  if (kind === "fill") {
    // A flat wash with a brighter rim. An earlier version faded the edges with
    // repeated `destination-in` passes, which compound rather than shade: they
    // ate the fill and left only the outline, so half the marked cells looked
    // empty.
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.roundRect(pad, pad, size - pad * 2, size - pad * 2, radius);
    ctx.fill();

    // Brighter along the top edge, where the deck lights fall.
    const lift = ctx.createLinearGradient(0, pad, 0, size - pad);
    lift.addColorStop(0, "rgba(255,255,255,0.35)");
    lift.addColorStop(0.55, "rgba(255,255,255,0)");
    ctx.fillStyle = lift;
    ctx.beginPath();
    ctx.roundRect(pad, pad, size - pad * 2, size - pad * 2, radius);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.98)";
    ctx.lineWidth = size * 0.03;
    ctx.beginPath();
    ctx.roundRect(pad, pad, size - pad * 2, size - pad * 2, radius);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "#ffffff"; // --color-white
    ctx.lineWidth = size * 0.038;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.roundRect(pad, pad, size - pad * 2, size - pad * 2, radius);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  SQUARES.set(kind, texture);
  return texture;
}

let shadowTex: THREE.CanvasTexture | null = null;
function softShadowTexture(): THREE.CanvasTexture {
  if (shadowTex) return shadowTex;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // A rounded, slightly squashed blob. A perfect circle under a triangular d4
  // reads as a stray decal on the deck rather than as the die's own shadow.
  ctx.filter = `blur(${size * 0.11}px)`;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.roundRect(size * 0.16, size * 0.24, size * 0.68, size * 0.54, size * 0.2);
  ctx.fill();
  ctx.filter = "none";
  shadowTex = new THREE.CanvasTexture(canvas);
  return shadowTex;
}

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
