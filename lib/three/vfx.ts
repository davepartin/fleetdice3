/**
 * The combat effects layer: everything that happens *to* the fleet.
 *
 * Design notes, because they explain nearly every decision below.
 *
 * 1. One draw call for the light. Sparks, motes, streaks, cores, shockwave
 *    rings, ground glows and beams are all the same thing — a coloured quad
 *    with a soft falloff — so they all live in a single instanced mesh
 *    ("the field") that is rewritten from scratch every frame. Effects push
 *    into it immediate-mode; nothing allocates, nothing leaks, and the whole
 *    combat layer costs one draw call plus a handful of pooled specials.
 *
 * 2. Pools, not allocation. The field, the floating numbers, the shields, the
 *    sweep ribbons, the scorch decals, the debris and the punch lights are all
 *    built once at boot and recycled. A round of combat allocates a few small
 *    task objects and nothing else.
 *
 * 3. Quality is read live from the stage, because the stage's own watchdog can
 *    drop a tier mid-match. Buffers are always sized for "high" — they are tens
 *    of kilobytes — and the tier caps how much of them is used. Low never skips
 *    an effect, it only thins it: the player still has to be able to read what
 *    happened.
 *
 * 4. `prefers-reduced-motion` keeps the information and drops the violence: no
 *    screen shake, gentler flashes, shorter and calmer motion.
 *
 * Positions are in `stage.world` space, the same space `board.group` and the
 * dice live in — pass `cellCentre(cell)` (offset by the board's own transform
 * if the board is moved) straight in.
 *
 * The game drives this: call `vfx.update(dt, time)` from your frame loop, the
 * same way you already call `board.update` and `die.update`.
 */

import * as THREE from "three";
import type { Stage } from "./stage";
import { displayFontFamily } from "./fonts";

/* ------------------------------------------------------------------ */
/* The palette. These are the app's colours and they mean things.      */
/* Every key here names its --color-* token in app/globals.css — e.g.  */
/* attackDeep is --color-attack-deep, ash is --color-hull-300 — kept   */
/* numeric because THREE.Color takes a number, not a CSS custom prop.  */
/* ------------------------------------------------------------------ */

const C = {
  attack: 0xff4d4d,
  attackDeep: 0x7c1220,
  attackGlow: 0xff8a7a,
  shield: 0x4db4ff,
  shieldDeep: 0x0c3a6b,
  shieldGlow: 0x9ad7ff,
  energy: 0xffd23d,
  energyDeep: 0x7a5300,
  energyGlow: 0xffe98a,
  repair: 0x45e08b,
  repairDeep: 0x0d5432,
  repairGlow: 0x9df3c2,
  direct: 0xb07dff,
  directDeep: 0x3d1b78,
  directGlow: 0xd9bcff,
  run: 0xff9d2e,
  runGlow: 0xffc978,
  white: 0xffffff, // --color-white
  ash: 0x8593b8, // --color-hull-300
} as const;

export type VfxKind = "attack" | "direct";

export type FloatingNumberOptions = {
  /** Type size multiplier. 1 is a normal hit; the number itself also scales it. */
  scale?: number;
  /** Seconds on screen. Default 1.05. */
  duration?: number;
  /** Seconds to wait before it appears — use it to stagger a row of numbers. */
  delay?: number;
  /** Extra world-space travel over the life. Defaults to a small upward arc. */
  drift?: THREE.Vector3;
  /** 0–1.5: how hard it punches toward the camera on arrival. */
  punch?: number;
  /** A small caption under the number, e.g. "BLOCKED" or "DIRECT". */
  label?: string;
};

export type VfxOptions = {
  /**
   * Height of the deck surface in world space. Ground-plane effects — shockwave
   * rings, scorch, beams painted along a formation — are drawn here.
   */
  deckY?: number;
};

export type Vfx = {
  /** A volley crossing from one deck to the other. Resolves as it lands. */
  volley(opts: { from: THREE.Vector3; to: THREE.Vector3; amount: number; kind: VfxKind }): Promise<void>;
  /** Damage landing. */
  impact(at: THREE.Vector3, amount: number, kind: VfxKind): void;
  /** Damage absorbed by shields. */
  shieldBlock(at: THREE.Vector3, amount: number): void;
  /** A ship thrown in front of the volley and lost for a round. */
  shipSacrifice(at: THREE.Vector3): void;
  /** Repair motes rising into the flagship. */
  repair(at: THREE.Vector3, amount: number): void;
  /** Energy collected from the fleet, flowing to the bank. */
  energyGain(from: THREE.Vector3[], to: THREE.Vector3): void;
  /** A number that punches out of the board and fades. */
  floatingNumber(
    at: THREE.Vector3,
    text: string,
    color: THREE.ColorRepresentation,
    opts?: FloatingNumberOptions,
  ): void;
  /** The straight completing — a line of light drawn through the dice in order.
   *  `hold` is the whole sequence, default 0.7s (the plan's "moment" beat). */
  straightSweep(points: THREE.Vector3[], tier: number, hold?: number): void;
  /** A formation row or column firing. */
  formation(points: THREE.Vector3[], kind: "row" | "col"): void;
  /** A flagship dying. Resolves when the dust has settled (~1.5s).
   *  `onDetonate` fires at the boom itself, not the build-up — the right
   *  moment to trigger anything that should read as caused by this blast. */
  flagshipBreak(at: THREE.Vector3, onDetonate?: () => void): Promise<void>;
  update(dt: number, time: number): void;
  dispose(): void;
};

/* ------------------------------------------------------------------ */
/* Small maths                                                          */
/* ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
const easeInCubic = (t: number) => t * t * t;
const easeOutBack = (t: number) => {
  const c = 2.2;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const spread = (amount: number) => (Math.random() - 0.5) * 2 * amount;

/** Shapes the fragment shader knows how to draw. */
const SHAPE = { disc: 0, streak: 1, ring: 2, hex: 3, star: 4, spark: 5 } as const;
/** How a quad is oriented. */
const MODE = { billboard: 0, stretched: 1, ground: 2 } as const;

/* ------------------------------------------------------------------ */
/* The field: one instanced quad mesh, rewritten every frame            */
/* ------------------------------------------------------------------ */

const FIELD_CAPACITY = 1400;

const FIELD_VERT = /* glsl */ `
  attribute vec3 iCenter;
  attribute vec3 iAxis;
  attribute vec2 iSize;
  attribute vec3 iColor;
  attribute vec4 iParams; // alpha, shape, mode, rotation

  varying vec2 vUv;
  varying vec3 vColour;
  varying float vAlpha;
  varying float vShape;

  void main() {
    vUv = uv;
    vColour = iColor;
    vAlpha = iParams.x;
    vShape = iParams.y;

    float mode = iParams.z;
    float rot = iParams.w;
    vec2 corner = position.xy; // PlaneGeometry(1,1) gives [-0.5, 0.5]

    vec4 mv;
    if (mode < 0.5) {
      // Screen-facing billboard, rotated in screen space.
      float s = sin(rot);
      float c = cos(rot);
      vec2 r = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
      mv = modelViewMatrix * vec4(iCenter, 1.0);
      mv.xy += r * iSize * 2.0;
    } else if (mode < 1.5) {
      // Stretched billboard: long axis follows iAxis (direction * half length),
      // width faces the camera. This is every streak, beam and spark trail.
      mv = modelViewMatrix * vec4(iCenter, 1.0);
      vec3 axisView = (modelViewMatrix * vec4(iAxis, 0.0)).xyz;
      float len = length(axisView);
      vec3 dir = len > 0.00001 ? axisView / len : vec3(0.0, 1.0, 0.0);
      vec3 toCam = normalize(-mv.xyz);
      vec3 side = cross(dir, toCam);
      float sideLen = length(side);
      side = sideLen > 0.0001 ? side / sideLen : vec3(1.0, 0.0, 0.0);
      mv.xyz += dir * (corner.y * 2.0 * len) + side * (corner.x * 2.0 * iSize.x);
    } else {
      // Flat on the deck.
      vec3 local = iCenter + vec3(corner.x * 2.0 * iSize.x, 0.0, corner.y * 2.0 * iSize.y);
      mv = modelViewMatrix * vec4(local, 1.0);
    }

    gl_Position = projectionMatrix * mv;
  }
`;

const FIELD_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColour;
  varying float vAlpha;
  varying float vShape;

  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, vec2(0.8660254, 0.5)), p.y);
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float a = 0.0;

    if (vShape < 0.5) {
      // Soft disc with a hot core — the workhorse.
      float d = length(p);
      float body = max(0.0, 1.0 - d);
      a = body * body;
      a += pow(body, 8.0) * 0.9;
    } else if (vShape < 1.5) {
      // Beam: flat down the middle, tight across, with a filament in it.
      float across = max(0.0, 1.0 - abs(p.x));
      across *= across;
      float along = smoothstep(1.0, 0.6, abs(p.y));
      a = across * along;
      a += pow(across, 6.0) * along * 0.9;
    } else if (vShape < 2.5) {
      // Shockwave ring: a thick soft band with a hard leading edge.
      float d = length(p);
      float band = 1.0 - smoothstep(0.0, 0.34, abs(d - 0.74));
      a = band * band * 0.8;
      a += (1.0 - smoothstep(0.0, 0.09, abs(d - 0.86))) * 0.85;
    } else if (vShape < 3.5) {
      // Hex flare — a shield facet catching a hit.
      float h = hexDist(p * 1.12);
      a = smoothstep(0.95, 0.35, h) * 0.35;
      a += (1.0 - smoothstep(0.0, 0.13, abs(h - 0.78))) * 0.95;
    } else if (vShape < 4.5) {
      // Ember: a point with a cross flare, the way a hot fleck reads on camera.
      float d = length(p);
      float core = pow(max(0.0, 1.0 - d), 3.0);
      float fx = pow(max(0.0, 1.0 - abs(p.x) * 3.4), 2.0) * pow(max(0.0, 1.0 - abs(p.y)), 3.0);
      float fy = pow(max(0.0, 1.0 - abs(p.y) * 3.4), 2.0) * pow(max(0.0, 1.0 - abs(p.x)), 3.0);
      a = core + (fx + fy) * 0.5;
    } else {
      // Spark trail: a beam that burns hottest at the leading end and dies out
      // behind, so a thrown fleck reads as moving rather than as a lit stick.
      float across = max(0.0, 1.0 - abs(p.x));
      across *= across;
      float head = clamp(p.y * 0.5 + 0.5, 0.0, 1.0);
      float along = pow(head, 1.5) * smoothstep(1.0, 0.55, abs(p.y));
      a = across * along * 1.3;
      a += pow(across, 6.0) * pow(head, 4.0) * 1.1;
    }

    float alpha = a * vAlpha;
    if (alpha < 0.002) discard;

    // Premultiplied: the material blends One/One, so alpha above 1 simply burns
    // hotter and trips the bloom threshold instead of clipping.
    gl_FragColor = vec4(vColour * alpha, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type Field = {
  mesh: THREE.Mesh;
  /** Reset for a new frame. */
  begin(cap: number): void;
  /** Upload what was pushed. */
  end(): void;
  billboard(
    x: number, y: number, z: number,
    sx: number, sy: number,
    r: number, g: number, b: number,
    alpha: number, shape: number, rot: number,
  ): void;
  streak(
    x: number, y: number, z: number,
    ax: number, ay: number, az: number,
    halfWidth: number,
    r: number, g: number, b: number,
    alpha: number, shape: number,
  ): void;
  ground(
    x: number, z: number, y: number,
    sx: number, sz: number,
    r: number, g: number, b: number,
    alpha: number, shape: number,
  ): void;
  dispose(): void;
};

function createField(): Field {
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", base.getAttribute("position"));
  geometry.setAttribute("uv", base.getAttribute("uv"));

  const centers = new Float32Array(FIELD_CAPACITY * 3);
  const axes = new Float32Array(FIELD_CAPACITY * 3);
  const sizes = new Float32Array(FIELD_CAPACITY * 2);
  const colours = new Float32Array(FIELD_CAPACITY * 3);
  const params = new Float32Array(FIELD_CAPACITY * 4);

  const aCenter = new THREE.InstancedBufferAttribute(centers, 3);
  const aAxis = new THREE.InstancedBufferAttribute(axes, 3);
  const aSize = new THREE.InstancedBufferAttribute(sizes, 2);
  const aColour = new THREE.InstancedBufferAttribute(colours, 3);
  const aParams = new THREE.InstancedBufferAttribute(params, 4);
  for (const attribute of [aCenter, aAxis, aSize, aColour, aParams]) {
    attribute.setUsage(THREE.DynamicDrawUsage);
  }
  geometry.setAttribute("iCenter", aCenter);
  geometry.setAttribute("iAxis", aAxis);
  geometry.setAttribute("iSize", aSize);
  geometry.setAttribute("iColor", aColour);
  geometry.setAttribute("iParams", aParams);
  geometry.instanceCount = 0;

  const material = new THREE.ShaderMaterial({
    vertexShader: FIELD_VERT,
    fragmentShader: FIELD_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // Explicit additive rather than AdditiveBlending, so the shader can output
    // premultiplied colour and drive intensity past 1 for the bloom pass.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  mesh.name = "vfx-field";

  let count = 0;
  let cap = FIELD_CAPACITY;

  return {
    mesh,
    begin(nextCap) {
      count = 0;
      cap = Math.min(FIELD_CAPACITY, nextCap);
    },
    end() {
      geometry.instanceCount = count;
      if (count === 0) return;
      aCenter.addUpdateRange(0, count * 3);
      aAxis.addUpdateRange(0, count * 3);
      aSize.addUpdateRange(0, count * 2);
      aColour.addUpdateRange(0, count * 3);
      aParams.addUpdateRange(0, count * 4);
      aCenter.needsUpdate = true;
      aAxis.needsUpdate = true;
      aSize.needsUpdate = true;
      aColour.needsUpdate = true;
      aParams.needsUpdate = true;
    },
    billboard(x, y, z, sx, sy, r, g, b, alpha, shape, rot) {
      if (count >= cap || alpha <= 0.001) return;
      const i = count;
      centers[i * 3] = x;
      centers[i * 3 + 1] = y;
      centers[i * 3 + 2] = z;
      sizes[i * 2] = sx;
      sizes[i * 2 + 1] = sy;
      colours[i * 3] = r;
      colours[i * 3 + 1] = g;
      colours[i * 3 + 2] = b;
      params[i * 4] = alpha;
      params[i * 4 + 1] = shape;
      params[i * 4 + 2] = MODE.billboard;
      params[i * 4 + 3] = rot;
      count += 1;
    },
    streak(x, y, z, ax, ay, az, halfWidth, r, g, b, alpha, shape) {
      if (count >= cap || alpha <= 0.001) return;
      const i = count;
      centers[i * 3] = x;
      centers[i * 3 + 1] = y;
      centers[i * 3 + 2] = z;
      axes[i * 3] = ax;
      axes[i * 3 + 1] = ay;
      axes[i * 3 + 2] = az;
      sizes[i * 2] = halfWidth;
      sizes[i * 2 + 1] = halfWidth;
      colours[i * 3] = r;
      colours[i * 3 + 1] = g;
      colours[i * 3 + 2] = b;
      params[i * 4] = alpha;
      params[i * 4 + 1] = shape;
      params[i * 4 + 2] = MODE.stretched;
      params[i * 4 + 3] = 0;
      count += 1;
    },
    ground(x, z, y, sx, sz, r, g, b, alpha, shape) {
      if (count >= cap || alpha <= 0.001) return;
      const i = count;
      centers[i * 3] = x;
      centers[i * 3 + 1] = y;
      centers[i * 3 + 2] = z;
      sizes[i * 2] = sx;
      sizes[i * 2 + 1] = sz;
      colours[i * 3] = r;
      colours[i * 3 + 1] = g;
      colours[i * 3 + 2] = b;
      params[i * 4] = alpha;
      params[i * 4 + 1] = shape;
      params[i * 4 + 2] = MODE.ground;
      params[i * 4 + 3] = 0;
      count += 1;
    },
    dispose() {
      base.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Slot pools with tokens, so a stolen slot can never be double-driven  */
/* ------------------------------------------------------------------ */

type Slot<T> = { value: T; busy: boolean; token: number; born: number };

function makeSlots<T>(items: T[]): Slot<T>[] {
  return items.map((value) => ({ value, busy: false, token: 0, born: 0 }));
}

/** Take a free slot; if `steal`, evict the oldest holder rather than fail. */
function acquire<T>(slots: Slot<T>[], now: number, steal = false): Slot<T> | null {
  for (const slot of slots) {
    if (!slot.busy) {
      slot.busy = true;
      slot.born = now;
      return slot;
    }
  }
  if (!steal || slots.length === 0) return null;
  let oldest = slots[0]!;
  for (const slot of slots) if (slot.born < oldest.born) oldest = slot;
  // Bumping the token invalidates whatever task was driving it.
  oldest.token += 1;
  oldest.born = now;
  return oldest;
}

function release<T>(slot: Slot<T>) {
  slot.busy = false;
  slot.token += 1;
}

/* ------------------------------------------------------------------ */
/* Particles — a fixed pool, simulated on the CPU, drawn via the field  */
/* ------------------------------------------------------------------ */

type Particle = {
  active: boolean;
  age: number;
  life: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  drag: number;
  size0: number;
  size1: number;
  colour: THREE.Color;
  colourEnd: THREE.Color;
  alpha: number;
  fade: number;
  rise: number;
  shape: number;
  /** > 0 draws the particle as a streak along its velocity, this long per unit speed. */
  stretch: number;
  rot: number;
  spin: number;
  /** Pull toward `target` in world units per second squared. */
  attract: number;
  target: THREE.Vector3 | null;
  /** Kill the particle once it is this close to `target`. 0 disables. */
  arriveAt: number;
  onArrive: 0 | 1;
  swirl: number;
  bounce: number;
  floor: number;
};

function makeParticle(): Particle {
  return {
    active: false,
    age: 0,
    life: 1,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    gravity: 0,
    drag: 0,
    size0: 0.1,
    size1: 0.02,
    colour: new THREE.Color(1, 1, 1),
    colourEnd: new THREE.Color(1, 1, 1),
    alpha: 1,
    fade: 1.6,
    rise: 0.06,
    shape: SHAPE.disc,
    stretch: 0,
    rot: 0,
    spin: 0,
    attract: 0,
    target: null,
    arriveAt: 0,
    onArrive: 0,
    swirl: 0,
    bounce: 0,
    floor: 0,
  };
}

function resetParticle(p: Particle) {
  p.active = true;
  p.age = 0;
  p.life = 1;
  p.pos.set(0, 0, 0);
  p.vel.set(0, 0, 0);
  p.gravity = 0;
  p.drag = 0;
  p.size0 = 0.1;
  p.size1 = 0.02;
  p.colour.setHex(C.white);
  p.colourEnd.setHex(C.white);
  p.alpha = 1;
  p.fade = 1.6;
  p.rise = 0.06;
  p.shape = SHAPE.disc;
  p.stretch = 0;
  p.rot = Math.random() * Math.PI;
  p.spin = 0;
  p.attract = 0;
  p.target = null;
  p.arriveAt = 0;
  p.onArrive = 0;
  p.swirl = 0;
  p.bounce = 0;
  p.floor = 0;
}

/* ------------------------------------------------------------------ */
/* Quality budgets                                                      */
/* ------------------------------------------------------------------ */

type Budget = {
  /** Multiplier on every particle count. */
  density: number;
  /** Hard cap on quads drawn per frame. */
  live: number;
  /** Punch lights available. */
  lights: number;
  /** Segments in a straight-sweep ribbon. */
  ribbon: number;
  /** Debris shards in a flagship break. */
  debris: number;
  /** Side streaks on a volley. */
  streaks: number;
  /** Whether shields get the full faceted shader treatment. */
  richShield: boolean;
  /** Whether scorch/smoke decals are drawn at all. */
  decals: boolean;
  /** Floating-number canvas resolution. */
  textureScale: number;
};

const BUDGETS: Record<Stage["quality"], Budget> = {
  low: {
    density: 0.3,
    live: 260,
    lights: 0,
    ribbon: 24,
    debris: 10,
    streaks: 1,
    richShield: false,
    decals: true,
    textureScale: 1,
  },
  medium: {
    density: 0.62,
    live: 700,
    lights: 1,
    ribbon: 44,
    debris: 18,
    streaks: 2,
    richShield: true,
    decals: true,
    textureScale: 1.5,
  },
  high: {
    density: 1,
    live: FIELD_CAPACITY,
    lights: 2,
    ribbon: 64,
    debris: 26,
    streaks: 3,
    richShield: true,
    decals: true,
    textureScale: 2,
  },
};

/* ------------------------------------------------------------------ */
/* Floating numbers — canvas text, one canvas per pooled sprite         */
/* ------------------------------------------------------------------ */

type NumberSlot = {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
};

const NUMBER_POOL = 10;
const NUMBER_CANVAS = 256; // logical width; height is half

function makeNumberSlot(scale: number): NumberSlot {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(NUMBER_CANVAS * scale);
  canvas.height = Math.round(NUMBER_CANVAS * scale * 0.62);
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    // Damage numbers are UI wearing a 3D costume: they must never be hidden by
    // the die that just got hit, so they ignore depth and sort last.
    depthTest: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 100;
  sprite.visible = false;
  return { sprite, material, texture, canvas, ctx };
}

/** Draw the number: heavy weight, dark outline, coloured glow, gradient fill. */
function paintNumber(
  slot: NumberSlot,
  text: string,
  colour: THREE.Color,
  label: string | undefined,
  font: string,
) {
  const { ctx, canvas } = slot;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const bright = colour.clone();
  bright.offsetHSL(0, 0.02, 0.2);
  const deep = colour.clone();
  deep.offsetHSL(0, 0, -0.16);

  let size = h * (label ? 0.62 : 0.74);
  ctx.font = `900 ${size}px ${font}`;
  const widest = w * 0.9;
  const measured = ctx.measureText(text).width;
  if (measured > widest) {
    size *= widest / measured;
    ctx.font = `900 ${size}px ${font}`;
  }

  const cy = label ? h * 0.42 : h * 0.5;

  // Outline first, twice, so it survives against a bright deck.
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = "#04060d"; // --color-void
  ctx.lineWidth = size * 0.17;
  ctx.shadowColor = `#${colour.getHexString()}`;
  ctx.shadowBlur = size * 0.28;
  ctx.strokeText(text, w / 2, cy);
  ctx.shadowBlur = 0;
  ctx.strokeText(text, w / 2, cy);

  const gradient = ctx.createLinearGradient(0, cy - size * 0.55, 0, cy + size * 0.55);
  gradient.addColorStop(0, `#${bright.getHexString()}`);
  gradient.addColorStop(0.55, `#${colour.getHexString()}`);
  gradient.addColorStop(1, `#${deep.getHexString()}`);
  ctx.fillStyle = gradient;
  ctx.fillText(text, w / 2, cy);

  if (label) {
    const labelSize = size * 0.26;
    ctx.font = `800 ${labelSize}px ${font}`;
    ctx.lineWidth = labelSize * 0.34;
    ctx.strokeStyle = "#04060d"; // --color-void
    ctx.strokeText(label, w / 2, h * 0.84);
    ctx.fillStyle = "#dde4f4"; // --color-hull-100
    ctx.fillText(label, w / 2, h * 0.84);
  }

  ctx.restore();
  slot.texture.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* Shield shell — faceted, hex-gridded, rippling                        */
/* ------------------------------------------------------------------ */

const SHIELD_VERT = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vLocal = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const SHIELD_FRAG = /* glsl */ `
  uniform vec3 uColour;
  uniform vec3 uCore;
  uniform float uOpacity;
  uniform float uRipple;
  uniform float uDissolve;
  uniform vec3 uOrigin;
  varying vec3 vLocal;
  varying vec3 vNormalV;
  varying vec3 vViewDir;

  float hexEdge(vec2 p) {
    vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(p, s) - s * 0.5;
    vec2 b = mod(p - s * 0.5, s) - s * 0.5;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 ap = abs(g);
    return 0.5 - max(dot(ap, vec2(0.8660254, 0.5)), ap.y);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec3 n = normalize(vLocal);
    vec2 uv = vec2(atan(n.x, n.z) * 1.9, asin(clamp(n.y, -1.0, 1.0)) * 2.4);

    float edge = hexEdge(uv * 2.4);
    float lines = smoothstep(0.085, 0.0, edge);
    float cell = 1.0 - smoothstep(0.0, 0.42, edge);

    float fres = pow(1.0 - max(dot(normalize(vNormalV), normalize(vViewDir)), 0.0), 2.2);

    // The ripple runs outward from wherever the shot arrived.
    float d = distance(n, normalize(uOrigin));
    float wave = 1.0 - smoothstep(0.0, 0.55, abs(d - uRipple));
    wave *= wave;

    // Dissolve cell by cell rather than fading flat — it reads as panels dropping.
    float seed = hash(floor(uv * 2.4));
    float alive = step(uDissolve, seed + 0.25);

    float a = (fres * 0.55 + lines * 0.5 + wave * 1.1 + fres * lines * 1.4 + cell * 0.06);
    a *= uOpacity * alive;
    if (a < 0.003) discard;

    // Keep it blue: the white core only takes over right on the ripple front,
    // because a shield that goes white reads as damage rather than as a block.
    vec3 colour = mix(uColour, uCore, clamp(wave * 0.55 + lines * 0.2, 0.0, 1.0));
    gl_FragColor = vec4(colour * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type ShieldSlot = { mesh: THREE.Mesh; material: THREE.ShaderMaterial };

/* ------------------------------------------------------------------ */
/* Sweep ribbon                                                         */
/* ------------------------------------------------------------------ */

const RIBBON_VERT = /* glsl */ `
  attribute float aU;
  attribute float aSide;
  varying float vU;
  varying float vSide;
  void main() {
    vU = aU;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RIBBON_FRAG = /* glsl */ `
  uniform vec3 uColour;
  uniform vec3 uCore;
  uniform float uHead;
  uniform float uTail;
  uniform float uOpacity;
  varying float vU;
  varying float vSide;

  void main() {
    float drawn = smoothstep(uHead, uHead - 0.045, vU);           // nothing ahead of the head
    float trail = smoothstep(uHead - uTail - 0.3, uHead - uTail, vU); // the old end burns down
    float across = 1.0 - abs(vSide);
    float body = pow(max(across, 0.0), 1.7);
    float core = pow(max(across, 0.0), 9.0);
    float band = 1.0 - smoothstep(0.0, 0.075, abs(vU - uHead));

    float a = drawn * trail * (body * 0.75 + core * 1.5) + band * (body * 0.6 + core * 2.2);
    a *= uOpacity;
    if (a < 0.003) discard;

    vec3 colour = mix(uColour, uCore, clamp(core + band * 0.8, 0.0, 1.0));
    gl_FragColor = vec4(colour * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const RIBBON_SEGMENTS = 64;

type RibbonSlot = {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  position: THREE.BufferAttribute;
};

function makeRibbon(): RibbonSlot {
  const verts = (RIBBON_SEGMENTS + 1) * 2;
  const positions = new Float32Array(verts * 3);
  const us = new Float32Array(verts);
  const sides = new Float32Array(verts);
  const indices: number[] = [];
  for (let i = 0; i <= RIBBON_SEGMENTS; i += 1) {
    const u = i / RIBBON_SEGMENTS;
    us[i * 2] = u;
    us[i * 2 + 1] = u;
    sides[i * 2] = -1;
    sides[i * 2 + 1] = 1;
    if (i < RIBBON_SEGMENTS) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("aU", new THREE.BufferAttribute(us, 1));
  geometry.setAttribute("aSide", new THREE.BufferAttribute(sides, 1));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    uniforms: {
      uColour: { value: new THREE.Color(C.run) },
      uCore: { value: new THREE.Color(C.white) },
      uHead: { value: 0 },
      uTail: { value: 0.5 },
      uOpacity: { value: 0 },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 21;
  mesh.visible = false;
  return { mesh, geometry, material, position };
}

/* ------------------------------------------------------------------ */
/* Dark pool — scorch and smoke, the only things that subtract light    */
/* ------------------------------------------------------------------ */

type DarkSlot = { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial };

function softDiscTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.62)");
  gradient.addColorStop(0.78, "rgba(255,255,255,0.16)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  // A little noise so the scorch is not a perfect circle.
  for (let i = 0; i < 90; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * size * 0.44;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = Math.random() < 0.5 ? "#ffffff" : "#000000"; // --color-white : pure black speckle
    ctx.beginPath();
    ctx.arc(x, y, 2 + Math.random() * 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ------------------------------------------------------------------ */
/* The factory                                                          */
/* ------------------------------------------------------------------ */

export function createVfx(stage: Stage, options: VfxOptions = {}): Vfx {
  const deckY = options.deckY ?? 0.03;

  const root = new THREE.Group();
  root.name = "vfx";
  stage.world.add(root);

  const font = displayFontFamily();

  /* Reduced motion ------------------------------------------------- */

  const motionQuery =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  let calm = motionQuery?.matches ?? false;
  const onMotionChange = (event: MediaQueryListEvent) => {
    calm = event.matches;
  };
  motionQuery?.addEventListener("change", onMotionChange);

  /** Screen shake, but only if the player wants to be shaken. */
  const shake = (strength: number) => {
    if (calm) return;
    stage.shake(strength);
  };
  /** Full-frame flash; still fires when calm, just softer. */
  const flash = (colour: THREE.ColorRepresentation, strength: number) => {
    stage.flash(colour, calm ? strength * 0.3 : strength);
  };
  /** Durations shorten when calm so the information arrives and gets out. */
  const span = (seconds: number) => (calm ? seconds * 0.66 : seconds);

  let disposed = false;
  /**
   * Set while a repair is running, so an arriving mote can brighten the ship.
   * Overlapping repairs simply share the most recent one and restore the
   * previous when they finish.
   */
  let arrivalBloom: (() => void) | null = null;

  const budget = (): Budget => BUDGETS[stage.quality];
  const density = () => budget().density * (calm ? 0.7 : 1);
  const many = (n: number) => Math.max(2, Math.round(n * density()));

  /* Field + particles ---------------------------------------------- */

  const field = createField();
  root.add(field.mesh);

  const particles: Particle[] = [];
  for (let i = 0; i < FIELD_CAPACITY; i += 1) particles.push(makeParticle());
  let particleCursor = 0;
  /** Recounted every frame, so a full pool costs one comparison, not a scan. */
  let particlesLive = 0;

  function spawn(): Particle | null {
    const limit = budget().live;
    if (particlesLive >= limit) return null;
    for (let i = 0; i < limit; i += 1) {
      particleCursor = (particleCursor + 1) % limit;
      const p = particles[particleCursor]!;
      if (!p.active) {
        resetParticle(p);
        particlesLive += 1;
        return p;
      }
    }
    particlesLive = limit;
    return null;
  }

  /* Pools ----------------------------------------------------------- */

  const numberSlots = makeSlots(
    Array.from({ length: NUMBER_POOL }, () => makeNumberSlot(BUDGETS.high.textureScale)),
  );
  for (const slot of numberSlots) root.add(slot.value.sprite);

  // Icosahedron faces are already unwelded, so the normals come out flat and
  // the shell reads as panels rather than as a ball.
  const shieldGeometry = new THREE.IcosahedronGeometry(1, 1);
  const shieldSlots = makeSlots(
    Array.from({ length: 3 }, (): ShieldSlot => {
      const material = new THREE.ShaderMaterial({
        vertexShader: SHIELD_VERT,
        fragmentShader: SHIELD_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        uniforms: {
          uColour: { value: new THREE.Color(C.shield) },
          uCore: { value: new THREE.Color(C.shieldGlow) },
          uOpacity: { value: 0 },
          uRipple: { value: 0 },
          uDissolve: { value: 0 },
          uOrigin: { value: new THREE.Vector3(0, 0, 1) },
        },
      });
      const mesh = new THREE.Mesh(shieldGeometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 22;
      mesh.visible = false;
      return { mesh, material };
    }),
  );
  for (const slot of shieldSlots) root.add(slot.value.mesh);

  const ribbonSlots = makeSlots(Array.from({ length: 3 }, () => makeRibbon()));
  for (const slot of ribbonSlots) root.add(slot.value.mesh);

  const darkTexture = softDiscTexture();
  const darkGeometry = new THREE.PlaneGeometry(1, 1);
  const darkSlots = makeSlots(
    Array.from({ length: 10 }, (): DarkSlot => {
      const material = new THREE.MeshBasicMaterial({
        map: darkTexture,
        color: new THREE.Color(0x0a0510), // a smoke-puff near-void; no matching token — 3D-only
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      const mesh = new THREE.Mesh(darkGeometry, material);
      mesh.renderOrder = 4; // under the light, over the deck
      mesh.visible = false;
      return { mesh, material };
    }),
  );
  for (const slot of darkSlots) root.add(slot.value.mesh);

  // Debris: one instanced mesh, transforms rewritten each frame.
  const DEBRIS_MAX = BUDGETS.high.debris;
  const debrisGeometry = new THREE.IcosahedronGeometry(0.17, 0);
  const debrisMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, // --color-white
    metalness: 0.55,
    roughness: 0.42,
    emissive: new THREE.Color(0x2a0508), // a hot-debris ember glow; no matching token — 3D-only
    emissiveIntensity: 0.5,
  });
  const debrisMesh = new THREE.InstancedMesh(debrisGeometry, debrisMaterial, DEBRIS_MAX);
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debrisMesh.frustumCulled = false;
  debrisMesh.count = 0;
  debrisMesh.visible = false;
  root.add(debrisMesh);
  const debris = Array.from({ length: DEBRIS_MAX }, () => ({
    active: false,
    age: 0,
    life: 1,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  }));
  const debrisColour = new THREE.Color();
  for (let i = 0; i < DEBRIS_MAX; i += 1) debrisMesh.setColorAt(i, debrisColour.setRGB(1, 1, 1));

  // Punch lights. Real light on an explosion is what sells its size.
  const lightSlots = makeSlots(
    Array.from({ length: BUDGETS.high.lights }, () => {
      const light = new THREE.PointLight(0xffffff, 0, 22, 2); // --color-white
      light.visible = false;
      return light;
    }),
  );
  for (const slot of lightSlots) root.add(slot.value);

  /* Tasks ------------------------------------------------------------ */

  type Task = {
    age: number;
    duration: number;
    step: (task: Task, dt: number) => void;
    done?: () => void;
    dead?: boolean;
  };
  const tasks: Task[] = [];
  function run(duration: number, step: Task["step"], done?: () => void): Task {
    const task: Task = { age: 0, duration, step, done };
    tasks.push(task);
    return task;
  }
  /** Resolvers for promises that must not hang if the layer is torn down. */
  const pending = new Set<() => void>();
  function promised(duration: number, step: Task["step"]): Promise<void> {
    return new Promise<void>((resolve) => {
      pending.add(resolve);
      run(duration, step, () => {
        pending.delete(resolve);
        resolve();
      });
    });
  }

  /* Scratch — reused, never allocated in a frame --------------------- */

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const vD = new THREE.Vector3();
  // `bar()` keeps its own scratch: callers pass vA/vB into it, so it must never
  // touch the shared pair.
  const barMid = new THREE.Vector3();
  const barHalf = new THREE.Vector3();
  const colA = new THREE.Color();
  const colB = new THREE.Color();
  const quatA = new THREE.Quaternion();
  const matA = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);

  /* Shared helpers --------------------------------------------------- */

  const tint = (hex: number, intensity: number, out: THREE.Color) =>
    out.setHex(hex).multiplyScalar(intensity);

  /** A billboard of light. `intensity` above ~1.2 trips the bloom threshold. */
  function glow(
    at: THREE.Vector3,
    size: number,
    hex: number,
    intensity: number,
    shape: number = SHAPE.disc,
    rot = 0,
  ) {
    tint(hex, 1, colA);
    field.billboard(at.x, at.y, at.z, size, size, colA.r, colA.g, colA.b, intensity, shape, rot);
  }

  /** A stretched bar of light from `a` to `b`. */
  function bar(a: THREE.Vector3, b: THREE.Vector3, width: number, hex: number, intensity: number) {
    barHalf.copy(b).sub(a).multiplyScalar(0.5);
    barMid.copy(a).add(barHalf);
    tint(hex, 1, colA);
    field.streak(
      barMid.x, barMid.y, barMid.z,
      barHalf.x, barHalf.y, barHalf.z,
      width,
      colA.r, colA.g, colA.b,
      intensity,
      SHAPE.streak,
    );
  }

  /** A flat pool of light on the deck under a point. */
  function groundGlow(
    at: THREE.Vector3,
    radius: number,
    hex: number,
    intensity: number,
    shape: number = SHAPE.disc,
  ) {
    tint(hex, 1, colA);
    field.ground(at.x, at.z, deckY, radius, radius, colA.r, colA.g, colA.b, intensity, shape);
  }

  function takeLight(now: number, colour: number, intensity: number, distance: number) {
    if (budget().lights === 0) return null;
    const slot = acquire(lightSlots.slice(0, budget().lights), now);
    if (!slot) return null;
    slot.value.color.setHex(colour);
    slot.value.intensity = intensity;
    slot.value.distance = distance;
    slot.value.visible = true;
    return slot;
  }

  /** A punch light that decays and returns itself to the pool. */
  function punchLight(at: THREE.Vector3, colour: number, intensity: number, life: number, now: number) {
    const slot = takeLight(now, colour, intensity, 26);
    if (!slot) return;
    const light = slot.value;
    light.position.copy(at);
    const token = slot.token;
    run(life, (task) => {
      if (slot.token !== token) {
        task.dead = true;
        return;
      }
      const t = clamp(task.age / life, 0, 1);
      light.intensity = intensity * Math.pow(1 - t, 2.4);
    }, () => {
      if (slot.token !== token) return;
      light.visible = false;
      light.intensity = 0;
      release(slot);
    });
  }

  /** A dark smudge left on the deck, or a rising puff of smoke. */
  function darkMark(
    at: THREE.Vector3,
    size: number,
    life: number,
    opacity: number,
    mode: "ground" | "puff",
    now: number,
  ) {
    if (!budget().decals) return;
    const slot = acquire(darkSlots, now, true);
    if (!slot) return;
    const { mesh, material } = slot.value;
    const token = slot.token;
    mesh.visible = true;
    mesh.scale.setScalar(size);
    mesh.position.copy(at);
    if (mode === "ground") {
      mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
      mesh.position.y = deckY + 0.006;
      material.color.setHex(0x0b0409); // a ground-scorch near-void; no matching token — 3D-only
    } else {
      mesh.rotation.set(0, 0, Math.random() * Math.PI);
      // Smoke over a near-black deck has to be *lighter* than the deck to read
      // at all, so the puffs are a cold haze rather than true soot.
      material.color.setHex(0x2b3350); // no matching token — 3D-only
    }
    const drift = mode === "puff" ? rand(0.5, 1.1) : 0;
    run(life, (task) => {
      if (slot.token !== token) {
        task.dead = true;
        return;
      }
      const t = clamp(task.age / life, 0, 1);
      if (mode === "puff") {
        mesh.position.y += drift * task.age * 0.02 + drift * 0.016;
        mesh.scale.setScalar(size * (1 + t * 1.4));
        mesh.quaternion.copy(stage.camera.quaternion);
        material.opacity = opacity * Math.sin(Math.PI * Math.pow(t, 0.6));
      } else {
        mesh.scale.setScalar(size * (0.7 + easeOutCubic(Math.min(1, t * 6)) * 0.3));
        material.opacity = opacity * (1 - easeInCubic(t));
      }
    }, () => {
      if (slot.token !== token) return;
      mesh.visible = false;
      material.opacity = 0;
      release(slot);
    });
  }

  /* ================================================================== */
  /* volley                                                             */
  /* ================================================================== */

  /**
   * The money shot. Three beats:
   *
   *   charge  — light gathers at the firing deck, sparks fall inward, the cell
   *             under the shot lights up and a ring contracts into it;
   *   travel  — a body of light crosses the gap, side streaks fanned around it,
   *             a trail burning off behind, arcing for attack and dead flat for
   *             direct;
   *   arrive  — a short bloom at the target, and the promise resolves so the
   *             game can land the damage on the next beat.
   *
   * Attack is red, heavy and solid — it has mass and it falls. Direct is violet,
   * thinner, half again as fast, and it does not arc: it ignores the geometry
   * between here and there, and leaves a lance of light hanging on the line it
   * took to prove it.
   */
  function volley(opts: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    amount: number;
    kind: VfxKind;
  }): Promise<void> {
    const direct = opts.kind === "direct";
    const mass = clamp(opts.amount / 12, 0.35, 3);
    const hue = direct ? C.direct : C.attack;
    const glowHue = direct ? C.directGlow : C.attackGlow;
    const deepHue = direct ? C.directDeep : C.attackDeep;

    const from = opts.from.clone();
    const to = opts.to.clone();
    const distance = from.distanceTo(to);

    const charge = span(direct ? 0.16 : 0.24 + Math.min(0.18, mass * 0.05));
    const speed = direct ? 46 : 27;
    const travel = span(clamp(distance / speed, 0.2, 0.72));
    const arcHeight = direct ? 0 : 0.8 + mass * 0.5;

    const streaks = direct ? 1 : budget().streaks;
    const trailRate = many(direct ? 26 : 40) * clamp(mass, 0.5, 2);
    let trailDebt = 0;

    // Charge: sparks falling inward, brightening core, contracting ring.
    let chargeSpawned = 0;
    const chargeSparks = many(9 * mass);
    run(charge, (task) => {
      const t = clamp(task.age / charge, 0, 1);
      const swell = Math.pow(t, 1.6);
      glow(from, 0.22 + swell * (direct ? 0.34 : 0.6) * mass, glowHue, 0.5 + swell * 2.4);
      glow(from, 0.1 + swell * 0.22, C.white, 0.4 + swell * 2.2);
      groundGlow(from, 0.7 + swell * 1.4 * mass, hue, 0.1 + swell * 0.6);
      // A ring squeezing down into the muzzle.
      glow(from, (1.5 - swell * 1.2) * (0.9 + mass * 0.2), hue, swell * 0.9, SHAPE.ring);

      const want = Math.floor(chargeSparks * t);
      while (chargeSpawned < want) {
        chargeSpawned += 1;
        const p = spawn();
        if (!p) break;
        const angle = Math.random() * Math.PI * 2;
        const radius = rand(1.1, 2.4);
        p.pos.set(
          from.x + Math.cos(angle) * radius,
          from.y + rand(-0.3, 0.9),
          from.z + Math.sin(angle) * radius,
        );
        p.life = charge * rand(0.45, 0.9);
        p.target = from;
        p.attract = 26;
        p.drag = 1.4;
        p.size0 = rand(0.035, 0.085);
        p.size1 = 0.01;
        p.colour.setHex(glowHue);
        p.colourEnd.setHex(C.white);
        p.alpha = 1.6;
        p.stretch = 0.05;
        p.shape = SHAPE.spark;
        p.arriveAt = 0.16;
      }
    });

    // Launch kick.
    run(charge, () => {}, () => {
      shake(direct ? 0.1 : 0.1 + mass * 0.05);
    });

    return promised(charge + travel, (task, dt) => {
      if (task.age < charge) return;
      const t = clamp((task.age - charge) / travel, 0, 1);
      // Attack accelerates out of the barrel; direct is already at speed.
      const eased = direct ? t : Math.pow(t, 0.86);

      vA.lerpVectors(from, to, eased);
      if (arcHeight > 0) vA.y += Math.sin(Math.PI * eased) * arcHeight;

      if (t < 1) {
        // Direction of travel, for the stretched body.
        vB.copy(to).sub(from).normalize();
        if (arcHeight > 0) vB.y += Math.cos(Math.PI * eased) * arcHeight * 0.35;
        vB.normalize();

        const bodyLength = (direct ? 1.9 : 0.85) * (0.7 + mass * 0.3);
        const bodyWidth = (direct ? 0.11 : 0.2) * (0.7 + mass * 0.35);

        tint(hue, 1, colA);
        vC.copy(vB).multiplyScalar(bodyLength);
        field.streak(vA.x, vA.y, vA.z, vC.x, vC.y, vC.z, bodyWidth * 2.1, colA.r, colA.g, colA.b, 1.2, SHAPE.streak);
        tint(C.white, 1, colB);
        vD.copy(vB).multiplyScalar(bodyLength * 0.62);
        field.streak(vA.x, vA.y, vA.z, vD.x, vD.y, vD.z, bodyWidth, colB.r, colB.g, colB.b, 2.2, SHAPE.streak);
        glow(vA, bodyWidth * (direct ? 3.2 : 5), glowHue, 1.6);

        // Side streaks fanned around the body: this is where "more damage" reads.
        for (let i = 0; i < streaks; i += 1) {
          const phase = task.age * 9 + i * 2.1;
          const swing = 0.16 + mass * 0.06;
          vC.set(Math.cos(phase) * swing, Math.sin(phase * 1.3) * swing * 0.7, Math.sin(phase) * swing);
          vD.copy(vA).add(vC);
          vC.copy(vB).multiplyScalar(bodyLength * rand(0.5, 0.8));
          tint(hue, 1, colA);
          field.streak(
            vD.x, vD.y, vD.z,
            vC.x, vC.y, vC.z,
            bodyWidth * 0.6,
            colA.r, colA.g, colA.b,
            0.8,
            SHAPE.streak,
          );
        }

        // A pool of light running along the deck under the shot.
        groundGlow(vA, 0.5 + mass * 0.25, hue, 0.22);

        // Trail.
        trailDebt += trailRate * dt;
        while (trailDebt >= 1) {
          trailDebt -= 1;
          const p = spawn();
          if (!p) break;
          p.pos.copy(vA).add(vC.set(spread(0.13), spread(0.13), spread(0.13)));
          p.vel.set(spread(0.7), rand(0.1, 0.8), spread(0.7));
          p.life = rand(0.14, 0.4) * (direct ? 0.6 : 1);
          p.drag = 2.2;
          p.gravity = direct ? 0 : -1.2;
          p.size0 = rand(0.05, 0.13) * (0.6 + mass * 0.2);
          p.size1 = 0.005;
          p.colour.setHex(glowHue);
          p.colourEnd.setHex(deepHue);
          p.alpha = 1.1;
          p.fade = 2;
          p.shape = SHAPE.disc;
        }
      }
    }).then(() => {
      // The promise resolves the moment the round lands, so the game can put
      // the damage on the board; the arrival bloom carries on behind it.
      const bloom = span(0.14);
      run(bloom, (task) => {
        const k = clamp(task.age / bloom, 0, 1);
        glow(to, 0.3 + k * 1.1 * mass, glowHue, (1 - k) * 2.2);
        glow(to, 0.14 + k * 0.4, C.white, (1 - k) * 2.6);
      });
      if (direct) {
        // The lance: proof it went straight through whatever was in the way.
        const life = span(0.22);
        run(life, (task) => {
          const k = clamp(task.age / life, 0, 1);
          bar(from, to, 0.05 * (1 - k * 0.7), C.directGlow, (1 - k) * 1.1);
        });
      }
    });
  }

  /* ================================================================== */
  /* impact                                                             */
  /* ================================================================== */

  /**
   * Damage landing. A white core that blows out for two frames, a shockwave
   * ring in the air and another running flat across the deck, sparks thrown out
   * with real gravity that bounce once off the plate, and a scorch that stays
   * behind long enough to be noticed. Shake and flash scale with the number, so
   * a forty reads as four times the ten.
   */
  function impact(at: THREE.Vector3, amount: number, kind: VfxKind) {
    const direct = kind === "direct";
    const hue = direct ? C.direct : C.attack;
    const glowHue = direct ? C.directGlow : C.attackGlow;
    const deepHue = direct ? C.directDeep : C.attackDeep;
    const mass = clamp(amount / 10, 0.3, 4.5);
    const now = stage.time;

    const point = at.clone();

    shake(clamp(0.2 * mass, 0.08, 1.35) * (direct ? 0.85 : 1));
    flash(hue, clamp(0.08 * mass, 0.04, 0.42) * (direct ? 0.8 : 1));
    punchLight(point, hue, Math.min(140, 34 * mass), span(0.34), now);

    // Core + shockwave.
    const spikePhase = Math.random() * Math.PI * 2;
    const coreLife = span(0.34 + mass * 0.05);
    run(coreLife, (task) => {
      const t = clamp(task.age / coreLife, 0, 1);
      const pop = easeOutQuint(Math.min(1, t * 3.4));
      const fade = Math.pow(1 - t, 2.2);

      // Hot core. Radius grows a little under linearly with the damage — the
      // spark count, the shake and the flash carry the rest of the difference
      // between a 10 and a 40, because a core that scaled flat out would
      // swallow the whole deck.
      const bulk = 0.55 + Math.pow(mass, 0.75) * 0.55;
      glow(point, (0.2 + pop * 0.42) * (direct ? 0.7 : 1) * bulk, C.white, fade * 3);
      glow(point, (0.36 + pop * 0.86) * (direct ? 0.6 : 1) * bulk, glowHue, fade * 1.8);

      // Ring in the air, and its shadow on the deck.
      const ring = (0.4 + easeOutCubic(t) * (1.1 + mass * 0.75)) * (direct ? 0.7 : 1);
      glow(point, ring, hue, fade * (direct ? 0.9 : 1.5), SHAPE.ring);
      groundGlow(point, ring * 1.05, hue, fade * 0.8, SHAPE.ring);
      groundGlow(point, 0.6 + pop * 0.9 * bulk, hue, fade * 0.55);

      if (!direct && stage.quality === "high") {
        // A second, slower ring gives a big hit a sense of depth.
        const slow = 0.35 + easeOutCubic(clamp(t * 0.62, 0, 1)) * (1.1 + mass * 0.55);
        glow(point, slow, glowHue, Math.pow(1 - t, 3) * 0.7, SHAPE.ring);
      }

      // Flash spikes: a few lances thrown out of the hit for the first tenth of
      // a second. Without them a hit is a round blob; with them it has a shape,
      // and the shape is what the eye reads as force.
      if (t < 0.4) {
        const k = easeOutQuint(clamp(t / 0.4, 0, 1));
        const spikes = stage.quality === "low" ? 3 : direct ? 4 : 6;
        const reach = (0.7 + mass * 0.55) * k;
        const strength = Math.pow(1 - t / 0.4, 2) * 1.6;
        for (let i = 0; i < spikes; i += 1) {
          const angle = spikePhase + (i * 2.399963);
          const lift = Math.sin(spikePhase * 3 + i * 1.7) * 0.6;
          vA.set(Math.cos(angle), lift, Math.sin(angle))
            .normalize()
            .multiplyScalar(reach * (0.6 + ((i * 37) % 11) / 18));
          tint(glowHue, 1, colA);
          field.streak(
            point.x + vA.x, point.y + vA.y, point.z + vA.z,
            vA.x, vA.y, vA.z,
            0.055 * (0.7 + mass * 0.16),
            colA.r, colA.g, colA.b,
            strength,
            SHAPE.spark,
          );
        }
      }
    });

    // Sparks.
    const count = many((direct ? 12 : 20) * mass);
    for (let i = 0; i < count; i += 1) {
      const p = spawn();
      if (!p) break;
      const angle = Math.random() * Math.PI * 2;
      const pitch = direct ? rand(-0.1, 0.5) : rand(-0.15, 1.05);
      const power = rand(2.4, 7.5) * (0.6 + mass * 0.28);
      p.pos.copy(point).add(vA.set(spread(0.18), spread(0.18), spread(0.18)));
      p.vel.set(
        Math.cos(angle) * Math.cos(pitch) * power,
        Math.sin(pitch) * power * (direct ? 0.5 : 1),
        Math.sin(angle) * Math.cos(pitch) * power,
      );
      p.life = rand(0.32, 0.85) * (direct ? 0.7 : 1);
      p.gravity = -13;
      p.drag = 1.1;
      p.size0 = rand(0.05, 0.12) * (0.7 + mass * 0.18);
      p.size1 = 0.008;
      p.colour.setHex(Math.random() < 0.3 ? C.white : glowHue);
      p.colourEnd.setHex(deepHue);
      p.alpha = 1.5;
      p.stretch = 0.045;
      p.shape = SHAPE.spark;
      p.bounce = 0.35;
      p.floor = deckY + 0.02;
    }

    // A handful of slow embers that hang in the air afterwards.
    if (!direct) {
      const embers = many(4 * mass);
      for (let i = 0; i < embers; i += 1) {
        const p = spawn();
        if (!p) break;
        p.pos.copy(point).add(vA.set(spread(0.4), spread(0.3), spread(0.4)));
        p.vel.set(spread(0.6), rand(0.3, 1.4), spread(0.6));
        p.life = rand(0.7, 1.5);
        p.gravity = -0.9;
        p.drag = 0.9;
        p.size0 = rand(0.04, 0.09);
        p.size1 = 0.012;
        p.colour.setHex(glowHue);
        p.colourEnd.setHex(deepHue);
        p.alpha = 1.1;
        p.shape = SHAPE.star;
        p.fade = 2.4;
      }
    }

    // Scorch, and smoke on anything but a direct hit.
    darkMark(point, (1.4 + mass * 0.7) * (direct ? 0.55 : 1), span(2.4), direct ? 0.28 : 0.5, "ground", now);
    if (!direct && mass > 0.8 && stage.quality !== "low") {
      darkMark(point, 1.1 + mass * 0.4, span(1.5), 0.34, "puff", now);
    }
  }

  /* ================================================================== */
  /* shieldBlock                                                        */
  /* ================================================================== */

  /**
   * Stopped, not hurt. A faceted shell snaps into existence around the point of
   * impact, a ripple runs outward from where the shot touched it, the hex
   * panels flare, and then the whole thing dissolves panel by panel. Sparks
   * skid *along* the surface and fly off sideways instead of into the ship,
   * which is the whole point: nothing got through.
   */
  function shieldBlock(at: THREE.Vector3, amount: number) {
    const mass = clamp(amount / 10, 0.35, 3);
    const now = stage.time;
    const point = at.clone();
    const radius = 1.05 + mass * 0.2;

    shake(clamp(0.07 * mass, 0.03, 0.3));
    flash(C.shield, clamp(0.05 * mass, 0.03, 0.18));

    const life = span(0.62);
    const slot = acquire(shieldSlots, now, true);
    if (slot) {
      const { mesh, material } = slot.value;
      const token = slot.token;
      mesh.position.copy(point);
      mesh.visible = true;
      mesh.scale.setScalar(radius * 0.45);
      // The ripple starts on the face the player can see.
      root.worldToLocal(vA.copy(stage.camera.getWorldPosition(vB)));
      vA.sub(point).normalize();
      if (vA.lengthSq() < 0.001) vA.set(0, 0, 1);
      (material.uniforms.uOrigin!.value as THREE.Vector3).copy(vA);
      material.uniforms.uOpacity!.value = 0;
      material.uniforms.uDissolve!.value = 0;

      run(life, (task) => {
        if (slot.token !== token) {
          task.dead = true;
          return;
        }
        const t = clamp(task.age / life, 0, 1);
        const snap = easeOutBack(clamp(t * 5, 0, 1));
        mesh.scale.setScalar(radius * (0.45 + snap * 0.55) * (1 + t * 0.16));
        material.uniforms.uRipple!.value = t * 2.6;
        material.uniforms.uOpacity!.value =
          (0.85 + mass * 0.22) * Math.pow(1 - t, 1.4) * Math.min(1, t * 12);
        material.uniforms.uDissolve!.value = clamp((t - 0.45) / 0.55, 0, 1);
      }, () => {
        if (slot.token !== token) return;
        mesh.visible = false;
        material.uniforms.uOpacity!.value = 0;
        release(slot);
      });
    }

    // The flare where the shot actually touched, plus a hex plate lighting up.
    const flare = span(0.3);
    run(flare, (task) => {
      const t = clamp(task.age / flare, 0, 1);
      const fade = Math.pow(1 - t, 2);
      glow(point, 0.3 + t * 0.5, C.white, fade * 2);
      glow(point, (0.7 + t * 1.4) * mass * 0.6 + 0.5, C.shieldGlow, fade * 1.6, SHAPE.hex, t * 0.4);
      glow(point, 0.6 + easeOutCubic(t) * (1.8 + mass * 0.5), C.shield, fade * 1.1, SHAPE.ring);
      groundGlow(point, 1 + t * 1.6, C.shield, fade * 0.4);
    });

    // Deflected sparks: they skid across the shell, never inward.
    const count = many(11 * mass);
    for (let i = 0; i < count; i += 1) {
      const p = spawn();
      if (!p) break;
      const angle = Math.random() * Math.PI * 2;
      const pitch = rand(-0.4, 0.9);
      const power = rand(3, 7.5);
      p.pos.copy(point).add(vA.set(spread(0.25), spread(0.25), spread(0.25)));
      p.vel.set(
        Math.cos(angle) * Math.cos(pitch) * power,
        Math.sin(pitch) * power,
        Math.sin(angle) * Math.cos(pitch) * power,
      );
      p.life = rand(0.2, 0.55);
      p.drag = 3.4;
      p.gravity = -2;
      p.size0 = rand(0.04, 0.1);
      p.size1 = 0.006;
      p.colour.setHex(Math.random() < 0.35 ? C.white : C.shieldGlow);
      p.colourEnd.setHex(C.shieldDeep);
      p.alpha = 1.4;
      p.stretch = 0.05;
      p.shape = SHAPE.spark;
    }
  }

  /* ================================================================== */
  /* shipSacrifice                                                      */
  /* ================================================================== */

  /**
   * A ship thrown across the volley. It braces — a blue guard ring snapping
   * shut around it — takes the hit as a hard white spark, and then goes out:
   * the colour drains, grey embers fall instead of flying, a dark puff lifts,
   * and a dim ring is left on the empty cell to say the slot is spent for a
   * round. Loud for a fifth of a second, then quiet.
   */
  function shipSacrifice(at: THREE.Vector3) {
    const now = stage.time;
    const point = at.clone();

    shake(0.22);
    flash(C.shield, 0.12);

    const brace = span(0.2);
    run(brace, (task) => {
      const t = clamp(task.age / brace, 0, 1);
      // A ring closing in, then the hit.
      const closing = 1 - easeOutCubic(t);
      glow(point, 0.5 + closing * 1.9, C.shield, 0.4 + t * 1.2, SHAPE.ring);
      glow(point, 0.25 + t * 0.5, C.shieldGlow, 0.4 + Math.pow(t, 3) * 2.4);
      groundGlow(point, 1.1 + t * 0.6, C.shield, 0.25 + t * 0.35);
    }, () => {
      // The hit itself.
      const burst = span(0.42);
      punchLight(point, C.shieldGlow, 26, span(0.2), stage.time);
      run(burst, (task) => {
        const t = clamp(task.age / burst, 0, 1);
        const fade = Math.pow(1 - t, 2.4);
        glow(point, 0.3 + easeOutQuint(t) * 0.9, C.white, fade * 2.6);
        glow(point, 0.6 + easeOutCubic(t) * 2.4, C.shieldGlow, fade * 1.2, SHAPE.ring);
      });

      const shards = many(16);
      for (let i = 0; i < shards; i += 1) {
        const p = spawn();
        if (!p) break;
        const angle = Math.random() * Math.PI * 2;
        const power = rand(2, 6.5);
        p.pos.copy(point).add(vA.set(spread(0.3), spread(0.35), spread(0.3)));
        p.vel.set(Math.cos(angle) * power, rand(0.6, 4.2), Math.sin(angle) * power);
        p.life = rand(0.5, 1.15);
        p.gravity = -11;
        p.drag = 1.3;
        p.size0 = rand(0.05, 0.12);
        p.size1 = 0.01;
        // The colour drains out of them as they fall: the ship is spent.
        p.colour.setHex(i % 3 === 0 ? C.white : C.shieldGlow);
        p.colourEnd.setHex(C.ash);
        p.alpha = 1.3;
        p.stretch = 0.04;
        p.shape = SHAPE.spark;
        p.bounce = 0.3;
        p.floor = deckY + 0.02;
      }

      darkMark(point, 1.5, span(1.3), 0.42, "puff", stage.time);
      darkMark(point, 1.7, span(2.6), 0.4, "ground", stage.time);

      // The empty berth, marked while the ship is out.
      const mark = span(1.4);
      run(mark, (task) => {
        const t = clamp(task.age / mark, 0, 1);
        const pulse = 0.5 + Math.sin(task.age * 7) * 0.2;
        groundGlow(point, 1.15, C.ash, (1 - t) * 0.3 * pulse, SHAPE.ring);
      });
    });
  }

  /* ================================================================== */
  /* repair                                                             */
  /* ================================================================== */

  /**
   * Green motes lifting off the deck around the flagship, curling inward as
   * they rise, and being pulled in. Each one that arrives adds a little to a
   * soft bloom at the ship, so the glow builds as the repair lands rather than
   * flashing once — it should feel like something being given back.
   */
  function repair(at: THREE.Vector3, amount: number) {
    const point = at.clone();
    const mass = clamp(amount / 8, 0.4, 3);
    const total = many(9 * mass);
    const emit = span(0.55);
    const life = emit + span(0.85);

    let spawned = 0;
    let bloom = 0;

    run(life, (task, dt) => {
      const want = Math.min(total, Math.floor((task.age / emit) * total));
      while (spawned < want) {
        spawned += 1;
        const p = spawn();
        if (!p) break;
        const angle = Math.random() * Math.PI * 2;
        const radius = rand(1.3, 2.8);
        p.pos.set(
          point.x + Math.cos(angle) * radius,
          deckY + rand(0, 0.4),
          point.z + Math.sin(angle) * radius,
        );
        p.vel.set(0, rand(0.8, 1.8), 0);
        p.life = rand(0.6, 1.0);
        p.target = point;
        p.attract = rand(7, 13);
        p.swirl = rand(0.8, 2.2) * (Math.random() < 0.5 ? -1 : 1);
        p.drag = 1.1;
        p.size0 = rand(0.05, 0.12);
        p.size1 = rand(0.02, 0.05);
        p.colour.setHex(C.repair);
        p.colourEnd.setHex(C.repairGlow);
        p.alpha = 1.3;
        p.fade = 1.1;
        p.shape = SHAPE.star;
        p.arriveAt = 0.3;
        p.onArrive = 1;
      }

      // The ship drinking it in.
      bloom = Math.max(0, bloom - dt * 1.9);
      const ramp = clamp(task.age / (life * 0.75), 0, 1);
      const base = Math.sin(Math.PI * Math.pow(ramp, 0.75));
      glow(point, 0.7 + base * 0.9 + bloom * 0.5, C.repair, base * 0.9 + bloom * 1.2);
      glow(point, 0.25 + bloom * 0.3, C.repairGlow, base * 0.7 + bloom * 1.6);
      groundGlow(point, 1.6 + base * 1.2, C.repair, base * 0.4);
      if (base > 0.02) {
        glow(point, 1.2 + ramp * 1.4, C.repair, base * 0.35, SHAPE.ring);
      }
    });

    // A mote arriving pings the bloom.
    const previousBloom = arrivalBloom;
    const ping = () => {
      bloom = Math.min(1.4, bloom + 0.5);
    };
    arrivalBloom = ping;
    run(life, () => {}, () => {
      if (arrivalBloom === ping) arrivalBloom = previousBloom;
    });

    flash(C.repair, 0.05);
  }

  /* ================================================================== */
  /* energyGain                                                         */
  /* ================================================================== */

  /**
   * Yellow sparks lifting off each contributing die and curving to the bank on
   * bowed paths — they leave, arc high, and come down into the meter. They stagger
   * so the bank pings several times rather than once, which is what makes a big
   * collection feel big.
   */
  function energyGain(from: THREE.Vector3[], to: THREE.Vector3) {
    if (from.length === 0) return;
    const target = to.clone();

    type Runner = {
      a: THREE.Vector3;
      control: THREE.Vector3;
      delay: number;
      duration: number;
      trail: number;
      landed: boolean;
    };

    const runners: Runner[] = from.map((source, index) => {
      const a = source.clone();
      const control = a.clone().lerp(target, 0.5);
      control.y += 2.2 + Math.random() * 1.4;
      control.x += spread(1.4);
      control.z += spread(1.4);
      return {
        a,
        control,
        delay: index * span(0.075) + rand(0, 0.04),
        duration: span(rand(0.42, 0.56)),
        trail: 0,
        landed: false,
      };
    });

    let bank = 0;
    const total = runners.reduce((max, r) => Math.max(max, r.delay + r.duration), 0) + span(0.4);

    run(total, (task, dt) => {
      bank = Math.max(0, bank - dt * 2.6);

      for (const runner of runners) {
        const t = clamp((task.age - runner.delay) / runner.duration, 0, 1);
        if (t <= 0) {
          // Charging on the die before it leaves.
          if (task.age > runner.delay - 0.16) {
            const k = clamp((task.age - (runner.delay - 0.16)) / 0.16, 0, 1);
            glow(runner.a, 0.12 + k * 0.22, C.energy, 0.4 + k * 1.6);
          }
          continue;
        }
        if (t >= 1) {
          if (!runner.landed) {
            runner.landed = true;
            bank = Math.min(1.6, bank + 0.55);
          }
          continue;
        }

        // Quadratic bezier, so the spark bows over the board.
        const inv = 1 - t;
        vA.copy(runner.a).multiplyScalar(inv * inv);
        vB.copy(runner.control).multiplyScalar(2 * inv * t);
        vC.copy(target).multiplyScalar(t * t);
        vA.add(vB).add(vC);

        glow(vA, 0.11 + Math.sin(Math.PI * t) * 0.05, C.energyGlow, 2);
        glow(vA, 0.28, C.energy, 0.8);

        runner.trail += dt * many(34);
        while (runner.trail >= 1) {
          runner.trail -= 1;
          const p = spawn();
          if (!p) break;
          p.pos.copy(vA).add(vD.set(spread(0.05), spread(0.05), spread(0.05)));
          p.vel.set(spread(0.3), rand(-0.4, 0.2), spread(0.3));
          p.life = rand(0.15, 0.35);
          p.drag = 2.6;
          p.size0 = rand(0.03, 0.07);
          p.size1 = 0.004;
          p.colour.setHex(C.energyGlow);
          p.colourEnd.setHex(C.energyDeep);
          p.alpha = 1;
          p.shape = SHAPE.disc;
        }
      }

      if (bank > 0.01) {
        glow(target, 0.3 + bank * 0.5, C.energy, bank * 1.8);
        glow(target, 0.14 + bank * 0.2, C.white, bank * 1.4);
        glow(target, 0.5 + (1.6 - bank) * 1.1, C.energy, bank * 0.5, SHAPE.ring);
      }
    });
  }

  /* ================================================================== */
  /* floatingNumber                                                     */
  /* ================================================================== */

  /**
   * The number is how the player actually reads the fight, so it is drawn as
   * type — heavy weight, dark outline, coloured glow — and it ignores depth so
   * nothing can hide it. It punches toward the camera with a little overshoot,
   * then arcs up and away and fades. Bigger numbers get bigger type and a
   * harder punch, so a 40 lands physically differently from a 4.
   */
  function floatingNumber(
    at: THREE.Vector3,
    text: string,
    color: THREE.ColorRepresentation,
    opts: FloatingNumberOptions = {},
  ) {
    const now = stage.time;
    const pool = stage.quality === "low" ? numberSlots.slice(0, 6) : numberSlots;
    const slot = acquire(pool, now, true);
    if (!slot) return;
    const token = slot.token;
    const { sprite, material } = slot.value;

    const magnitude = Math.abs(parseFloat(text.replace(/[^0-9.\-]/g, ""))) || 0;
    const weight = clamp(magnitude / 25, 0, 1);
    const scale = (opts.scale ?? 1) * (0.85 + weight * 0.55);
    const punch = opts.punch ?? 0.55 + weight * 0.75;
    const duration = span(opts.duration ?? 1.05 + weight * 0.25);
    const delay = opts.delay ?? 0;

    colA.set(color);
    paintNumber(slot.value, text, colA, opts.label, font);

    const aspect = slot.value.canvas.height / slot.value.canvas.width;
    const width = 2.5 * scale;
    sprite.scale.set(width, width * aspect, 1);
    sprite.visible = false;
    material.opacity = 0;

    const start = at.clone();
    const drift = opts.drift ? opts.drift.clone() : new THREE.Vector3(spread(0.5), 1.5 + weight * 0.9, 0);
    if (calm) drift.multiplyScalar(0.6);

    // Toward the camera, so it "punches out of the board".
    const toCamera = stage.camera.getWorldPosition(vA).clone();
    root.worldToLocal(toCamera);
    toCamera.sub(start).normalize().multiplyScalar(calm ? 0.35 : 0.9 * punch);

    run(delay + duration, (task) => {
      if (slot.token !== token) {
        task.dead = true;
        return;
      }
      if (task.age < delay) return;
      const t = clamp((task.age - delay) / duration, 0, 1);
      sprite.visible = true;

      const out = easeOutBack(clamp(t * 5.5, 0, 1));
      const arc = easeOutCubic(t);
      sprite.position.copy(start);
      sprite.position.addScaledVector(toCamera, out);
      sprite.position.addScaledVector(drift, arc);
      sprite.position.y -= t * t * 0.55 * (calm ? 0.4 : 1);

      const pop = out * (1 + (1 - out) * 0.35);
      const shrink = 1 - Math.pow(clamp((t - 0.7) / 0.3, 0, 1), 2) * 0.25;
      sprite.scale.set(width * pop * shrink, width * aspect * pop * shrink, 1);

      material.opacity = clamp(Math.min(1, t * 9) * (1 - Math.pow(clamp((t - 0.55) / 0.45, 0, 1), 1.6)), 0, 1);
    }, () => {
      if (slot.token !== token) return;
      sprite.visible = false;
      material.opacity = 0;
      release(slot);
    });
  }

  /* ================================================================== */
  /* straightSweep                                                      */
  /* ================================================================== */

  /**
   * The best moment in the game. A ribbon of light is drawn through the dice in
   * numeric order — a bright head running the path, the ribbon burning in
   * behind it, sparks shed at every die it crosses — and the whole thing ends
   * on a burst at the last die. Higher tiers run wider and hotter. The whole
   * sequence is pinned to `hold` seconds (700ms by default) so a straight is
   * always the same kind of moment, not a variable light-show.
   */
  function straightSweep(points: THREE.Vector3[], tier: number, hold = 0.7) {
    if (points.length < 2) return;
    const now = stage.time;
    const rank = clamp(tier, 1, 6);
    const path = points.map((p) => p.clone());

    const segments = budget().ribbon;
    const width = 0.13 + rank * 0.035;
    const total = span(hold);
    const draw = total * 0.6;
    const fade = total * 0.4;

    const curve = new THREE.CatmullRomCurve3(path, false, "catmullrom", 0.4);

    const slot = acquire(ribbonSlots, now, true);
    if (slot) {
      const token = slot.token;
      const ribbon = slot.value;
      const array = ribbon.position.array as Float32Array;
      // Build the ribbon once: only the head uniform moves after this.
      for (let i = 0; i <= RIBBON_SEGMENTS; i += 1) {
        const u = i / RIBBON_SEGMENTS;
        const live = i <= segments;
        const clamped = live ? u : 1;
        curve.getPoint(clamped, vA);
        curve.getTangent(clamped, vB).normalize();
        vC.crossVectors(vB, UP);
        if (vC.lengthSq() < 0.0001) vC.set(1, 0, 0);
        vC.normalize();
        // Taper the ends so the ribbon has a point rather than a cut edge.
        const taper = Math.sin(Math.PI * clamp(clamped, 0, 1)) * 0.35 + 0.65;
        vC.multiplyScalar(width * taper);
        array[i * 6] = vA.x - vC.x;
        array[i * 6 + 1] = vA.y - vC.y + 0.02;
        array[i * 6 + 2] = vA.z - vC.z;
        array[i * 6 + 3] = vA.x + vC.x;
        array[i * 6 + 4] = vA.y + vC.y + 0.02;
        array[i * 6 + 5] = vA.z + vC.z;
      }
      ribbon.position.needsUpdate = true;
      ribbon.geometry.setDrawRange(0, segments * 6);
      ribbon.mesh.visible = true;
      (ribbon.material.uniforms.uColour!.value as THREE.Color).setHex(C.run);
      (ribbon.material.uniforms.uCore!.value as THREE.Color).setHex(C.runGlow);
      ribbon.material.uniforms.uTail!.value = 0.45 + rank * 0.08;

      run(total, (task) => {
        if (slot.token !== token) {
          task.dead = true;
          return;
        }
        const head = clamp(task.age / draw, 0, 1);
        ribbon.material.uniforms.uHead!.value = head + clamp((task.age - draw) / fade, 0, 1) * 0.9;
        ribbon.material.uniforms.uOpacity!.value =
          (0.9 + rank * 0.16) * (task.age < draw ? 1 : Math.pow(1 - (task.age - draw) / fade, 1.6));
      }, () => {
        if (slot.token !== token) return;
        ribbon.mesh.visible = false;
        ribbon.material.uniforms.uOpacity!.value = 0;
        release(slot);
      });
    }

    // The head: a bright bolt running the path, shedding sparks.
    let shed = 0;
    let crossed = 0;
    run(draw, (task, dt) => {
      const t = clamp(task.age / draw, 0, 1);
      curve.getPoint(t, vA);
      curve.getTangent(t, vB).normalize();

      glow(vA, 0.22 + rank * 0.03, C.white, 2.6);
      glow(vA, 0.5 + rank * 0.07, C.runGlow, 1.8);
      groundGlow(vA, 1 + rank * 0.12, C.run, 0.5);
      vC.copy(vB).multiplyScalar(0.7);
      tint(C.runGlow, 1, colA);
      field.streak(vA.x, vA.y, vA.z, vC.x, vC.y, vC.z, 0.1, colA.r, colA.g, colA.b, 1.4, SHAPE.streak);

      // A pulse each time the head passes a die.
      const reached = Math.floor(t * (path.length - 1) + 0.001);
      while (crossed <= reached && crossed < path.length) {
        const die = path[crossed]!;
        crossed += 1;
        const ping = span(0.34);
        run(ping, (inner) => {
          const k = clamp(inner.age / ping, 0, 1);
          const f = Math.pow(1 - k, 2);
          glow(die, 0.5 + easeOutCubic(k) * (1.3 + rank * 0.14), C.run, f * 1.3, SHAPE.ring);
          glow(die, 0.3 + k * 0.3, C.runGlow, f * 1.5);
          groundGlow(die, 0.9 + k * 0.7, C.run, f * 0.5);
        });
        shake(0.05 + rank * 0.012);
      }

      shed += dt * many(56);
      while (shed >= 1) {
        shed -= 1;
        const p = spawn();
        if (!p) break;
        p.pos.copy(vA).add(vD.set(spread(0.14), spread(0.1), spread(0.14)));
        p.vel.set(spread(1.4), rand(0.4, 2.4), spread(1.4));
        p.life = rand(0.3, 0.8);
        p.gravity = -3.2;
        p.drag = 1.5;
        p.size0 = rand(0.04, 0.1);
        p.size1 = 0.008;
        p.colour.setHex(Math.random() < 0.35 ? C.white : C.runGlow);
        p.colourEnd.setHex(C.run);
        p.alpha = 1.3;
        p.stretch = 0.035;
        p.shape = SHAPE.spark;
      }
    }, () => {
      // The burst at the end of the run. Same window as the ribbon fade so
      // the whole sequence stays inside `hold` (700ms).
      const end = path[path.length - 1]!;
      const burst = fade;
      shake(0.3 + rank * 0.09);
      flash(C.run, 0.16 + rank * 0.05);
      punchLight(end, C.run, 30 + rank * 12, span(0.4), stage.time);

      run(burst, (task) => {
        const t = clamp(task.age / burst, 0, 1);
        const f = Math.pow(1 - t, 2.2);
        glow(end, 0.3 + easeOutQuint(t) * (1 + rank * 0.15), C.white, f * 2.8);
        glow(end, 0.5 + easeOutCubic(t) * (2.6 + rank * 0.5), C.run, f * 1.6, SHAPE.ring);
        groundGlow(end, 1 + easeOutCubic(t) * (3.4 + rank * 0.6), C.run, f * 0.9, SHAPE.ring);
        if (stage.quality === "high") {
          glow(end, 0.8 + easeOutCubic(clamp(t * 0.7, 0, 1)) * (2 + rank * 0.4), C.runGlow, Math.pow(1 - t, 3) * 0.9, SHAPE.ring);
        }
      });

      const count = many(20 + rank * 8);
      for (let i = 0; i < count; i += 1) {
        const p = spawn();
        if (!p) break;
        const angle = Math.random() * Math.PI * 2;
        const pitch = rand(-0.1, 1.2);
        const power = rand(3, 9 + rank);
        p.pos.copy(end);
        p.vel.set(
          Math.cos(angle) * Math.cos(pitch) * power,
          Math.sin(pitch) * power,
          Math.sin(angle) * Math.cos(pitch) * power,
        );
        p.life = rand(0.45, 1.2);
        p.gravity = -10;
        p.drag = 1;
        p.size0 = rand(0.05, 0.13);
        p.size1 = 0.008;
        p.colour.setHex(Math.random() < 0.4 ? C.white : C.runGlow);
        p.colourEnd.setHex(C.run);
        p.alpha = 1.5;
        p.stretch = 0.04;
        p.shape = SHAPE.spark;
        p.bounce = 0.4;
        p.floor = deckY + 0.02;
      }
    });
  }

  /* ================================================================== */
  /* formation                                                          */
  /* ================================================================== */

  /**
   * Three dice agreeing. Each one charges — a tight core winding up on the
   * hull — and then the beam snaps: a hard bar of light along the line, wide
   * for a frame and then thinning to a filament, with a bolt running its length
   * and a matching streak painted flat on the deck. Rows fire energy-yellow,
   * columns fire attack-red.
   */
  function formation(points: THREE.Vector3[], kind: "row" | "col") {
    if (points.length < 2) return;
    const hue = kind === "row" ? C.energy : C.attack;
    const glowHue = kind === "row" ? C.energyGlow : C.attackGlow;
    const deepHue = kind === "row" ? C.energyDeep : C.attackDeep;
    const nodes = points.map((p) => p.clone());
    const a = nodes[0]!;
    const b = nodes[nodes.length - 1]!;

    const charge = span(0.22);
    const beam = span(0.44);

    run(charge, (task) => {
      const t = clamp(task.age / charge, 0, 1);
      const swell = Math.pow(t, 2);
      for (const node of nodes) {
        glow(node, 0.14 + swell * 0.36, C.white, 0.4 + swell * 2.2);
        glow(node, 0.3 + swell * 0.7, glowHue, 0.3 + swell * 1.4);
        glow(node, (1.4 - swell) * 1.1, hue, swell * 0.8, SHAPE.ring);
        groundGlow(node, 0.8 + swell * 0.7, hue, 0.15 + swell * 0.5);
      }
    }, () => {
      shake(0.26);
      flash(hue, 0.14);

      // The deck streak runs along the axis of the line.
      const horizontal = Math.abs(a.z - b.z) < Math.abs(a.x - b.x);
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      const half = a.distanceTo(b) / 2 + 0.7;

      run(beam, (task) => {
        const t = clamp(task.age / beam, 0, 1);
        const snap = Math.min(1, t * 14);
        const fade = Math.pow(1 - t, 2);
        const thin = 1 - easeOutCubic(t) * 0.72;

        bar(a, b, 0.3 * thin * snap, hue, fade * 1.5);
        bar(a, b, 0.1 * thin * snap, C.white, fade * 2.4);

        tint(hue, 1, colA);
        field.ground(
          midX, midZ, deckY,
          horizontal ? half : 0.5 * thin,
          horizontal ? 0.5 * thin : half,
          colA.r, colA.g, colA.b,
          fade * 0.7,
          SHAPE.disc,
        );

        // A bolt running the length of the beam.
        if (t < 0.55) {
          const k = t / 0.55;
          vA.lerpVectors(a, b, k);
          glow(vA, 0.3, C.white, (1 - k) * 2.4);
          glow(vA, 0.6, glowHue, (1 - k) * 1.4);
        }

        for (const node of nodes) {
          glow(node, 0.35 + easeOutCubic(t) * 1.5, hue, fade * 1.1, SHAPE.ring);
          glow(node, 0.28, C.white, fade * 1.6);
        }
      });

      for (const node of nodes) {
        const count = many(9);
        for (let i = 0; i < count; i += 1) {
          const p = spawn();
          if (!p) break;
          const angle = Math.random() * Math.PI * 2;
          const power = rand(2, 6);
          p.pos.copy(node);
          p.vel.set(Math.cos(angle) * power, rand(0.5, 3.4), Math.sin(angle) * power);
          p.life = rand(0.3, 0.7);
          p.gravity = -8;
          p.drag = 1.6;
          p.size0 = rand(0.04, 0.1);
          p.size1 = 0.006;
          p.colour.setHex(Math.random() < 0.3 ? C.white : glowHue);
          p.colourEnd.setHex(deepHue);
          p.alpha = 1.3;
          p.stretch = 0.04;
          p.shape = SHAPE.spark;
        }
      }
    });
  }

  /* ================================================================== */
  /* flagshipBreak                                                      */
  /* ================================================================== */

  /**
   * The end of the match, and it takes its time.
   *
   *   0.00–0.60  build: the hull overloads. Light gathers, rings pulse out,
   *              debris is sucked inward, the shake ramps.
   *   0.60–0.70  the beat of silence. Everything stops. A thin white lance
   *              stands where the ship was. This pause is what makes the next
   *              tenth of a second land.
   *   0.70       detonation: a white core, three rings, the deck goes flat
   *              white, real debris thrown and tumbling, a full shake.
   *   0.70–1.55  aftermath: embers falling, smoke lifting, scorch on the plate,
   *              the light dying down to nothing.
   */
  function flagshipBreak(at: THREE.Vector3, onDetonate?: () => void): Promise<void> {
    const point = at.clone();
    const build = span(0.6);
    const beat = span(0.1);
    const boom = build + beat;
    const total = span(1.58);
    const now = stage.time;

    let detonated = false;
    let suck = 0;

    return promised(total, (task, dt) => {
      const age = task.age;

      if (age < build) {
        /* --- build ------------------------------------------------- */
        const t = clamp(age / build, 0, 1);
        const pulse = 0.5 + Math.sin(age * (12 + t * 40)) * 0.5;
        const swell = Math.pow(t, 2.2);

        glow(point, 0.4 + swell * 1.1 + pulse * 0.14, C.white, 0.5 + swell * 3.4);
        glow(point, 0.8 + swell * 1.8, C.attackGlow, 0.4 + swell * 2);
        groundGlow(point, 1.4 + swell * 2.4, C.attack, 0.2 + swell * 0.9);
        // Rings escaping the hull as it loses containment.
        const ringPhase = (age * 2.6) % 1;
        glow(point, 0.6 + ringPhase * (2.6 + swell * 2), C.attackGlow, (1 - ringPhase) * (0.5 + swell), SHAPE.ring);
        glow(point, 0.6 + ((ringPhase + 0.5) % 1) * (2.6 + swell * 2), C.attack, (1 - ((ringPhase + 0.5) % 1)) * (0.4 + swell), SHAPE.ring);

        shake(0.06 + t * 0.3);
        if (age > build * 0.75) flash(C.white, (age - build * 0.75) / (build * 0.25) * 0.22);

        // Everything loose is dragged in.
        suck += dt * many(30) * (0.4 + t);
        while (suck >= 1) {
          suck -= 1;
          const p = spawn();
          if (!p) break;
          const angle = Math.random() * Math.PI * 2;
          const radius = rand(2, 5);
          p.pos.set(
            point.x + Math.cos(angle) * radius,
            point.y + rand(-0.6, 2.6),
            point.z + Math.sin(angle) * radius,
          );
          p.life = rand(0.25, 0.6);
          p.target = point;
          p.attract = rand(24, 44);
          p.swirl = rand(2, 5) * (Math.random() < 0.5 ? -1 : 1);
          p.drag = 0.6;
          p.size0 = rand(0.04, 0.1);
          p.size1 = 0.008;
          p.colour.setHex(C.attackGlow);
          p.colourEnd.setHex(C.white);
          p.alpha = 1.4;
          p.stretch = 0.05;
          p.shape = SHAPE.spark;
          p.arriveAt = 0.2;
        }
        return;
      }

      if (age < boom) {
        /* --- the beat of silence ----------------------------------- */
        const k = clamp((age - build) / beat, 0, 1);
        // One thin lance of white, standing still.
        vA.copy(point).setY(point.y - 1.4);
        vB.copy(point).setY(point.y + 5.5);
        bar(vA, vB, 0.035 + k * 0.05, C.white, 1.4 + k * 1.6);
        glow(point, 0.2, C.white, 1 + k);
        return;
      }

      if (!detonated) {
        /* --- detonation -------------------------------------------- */
        detonated = true;
        onDetonate?.();
        shake(1.5);
        flash(C.white, 0.95);
        // White for a beat, then the frame goes red as the fireball takes over.
        run(0.09, () => {}, () => flash(C.attack, 0.4));
        punchLight(point, C.attackGlow, 180, span(0.6), stage.time);

        const sparks = many(70);
        for (let i = 0; i < sparks; i += 1) {
          const p = spawn();
          if (!p) break;
          const angle = Math.random() * Math.PI * 2;
          const pitch = rand(-0.25, 1.35);
          const power = rand(4, 15);
          p.pos.copy(point).add(vA.set(spread(0.3), spread(0.3), spread(0.3)));
          p.vel.set(
            Math.cos(angle) * Math.cos(pitch) * power,
            Math.sin(pitch) * power,
            Math.sin(angle) * Math.cos(pitch) * power,
          );
          p.life = rand(0.5, 1.6);
          p.gravity = -12;
          p.drag = 0.85;
          p.size0 = rand(0.06, 0.2);
          p.size1 = 0.01;
          const roll = Math.random();
          p.colour.setHex(roll < 0.35 ? C.white : roll < 0.8 ? C.attackGlow : C.energy);
          p.colourEnd.setHex(C.attackDeep);
          p.alpha = 1.7;
          p.stretch = 0.05;
          p.shape = SHAPE.spark;
          p.bounce = 0.4;
          p.floor = deckY + 0.03;
        }

        // Debris: real geometry, real tumble, one bounce off the plate.
        const shards = budget().debris;
        debrisMesh.count = shards;
        debrisMesh.visible = true;
        debrisMesh.castShadow = stage.quality === "high";
        for (let i = 0; i < shards; i += 1) {
          const shard = debris[i]!;
          shard.active = true;
          shard.age = 0;
          shard.life = rand(1, 1.5);
          const angle = Math.random() * Math.PI * 2;
          const pitch = rand(0, 1.1);
          const power = rand(3, 8.5);
          shard.pos.copy(point).add(vA.set(spread(0.3), spread(0.3), spread(0.3)));
          shard.vel.set(
            Math.cos(angle) * Math.cos(pitch) * power,
            Math.sin(pitch) * power + 2,
            Math.sin(angle) * Math.cos(pitch) * power,
          );
          shard.spin.set(spread(14), spread(14), spread(14));
          shard.quat.set(Math.random(), Math.random(), Math.random(), Math.random()).normalize();
          shard.scale.set(rand(0.5, 1.5), rand(0.4, 1.2), rand(0.5, 1.5));
        }

        darkMark(point, 5.5, span(3.2), 0.62, "ground", stage.time);
        for (let i = 0; i < (stage.quality === "low" ? 1 : 3); i += 1) {
          vA.copy(point).add(vB.set(spread(1), rand(0, 1), spread(1)));
          darkMark(vA, rand(2.2, 3.6), span(2.4), 0.4, "puff", stage.time);
        }
      }

      /* --- aftermath ---------------------------------------------- */
      const t = clamp((age - boom) / (total - boom), 0, 1);
      const blast = Math.pow(1 - clamp(t * 3.2, 0, 1), 2.2);
      const wave = easeOutCubic(clamp(t * 2.4, 0, 1));

      // Three rings at three speeds: the fireball, the wave behind it, and a
      // slow one still spreading across the plate when the rest has gone.
      glow(point, 0.5 + wave * 1.7, C.white, blast * 3.4);
      glow(point, 0.9 + wave * 3, C.attackGlow, blast * 2);
      glow(point, 0.8 + wave * 4.4, C.attack, blast * 1.6, SHAPE.ring);
      glow(
        point,
        0.8 + easeOutCubic(clamp(t * 1.5, 0, 1)) * 5.4,
        C.attackGlow,
        Math.pow(1 - clamp(t * 2, 0, 1), 2) * 1.1,
        SHAPE.ring,
      );
      groundGlow(point, 1.4 + wave * 5, C.attack, blast * 1.2, SHAPE.ring);
      groundGlow(point, 1.1 + wave * 2.6, C.attackGlow, blast * 0.8);

      // Embers keep falling for the rest of the shot.
      if (t < 0.5 && Math.random() < 0.6) {
        const p = spawn();
        if (p) {
          p.pos.copy(point).add(vA.set(spread(3), rand(0.5, 4), spread(3)));
          p.vel.set(spread(1.4), rand(-0.5, 1.6), spread(1.4));
          p.life = rand(0.8, 1.8);
          p.gravity = -2.6;
          p.drag = 0.8;
          p.size0 = rand(0.04, 0.11);
          p.size1 = 0.01;
          p.colour.setHex(C.attackGlow);
          p.colourEnd.setHex(C.attackDeep);
          p.alpha = 1.2;
          p.fade = 2.2;
          p.shape = SHAPE.star;
        }
      }
    });
  }

  /* ================================================================== */
  /* Frame                                                              */
  /* ================================================================== */

  function updateParticles(dt: number) {
    let live = 0;
    for (let i = 0; i < FIELD_CAPACITY; i += 1) {
      const p = particles[i]!;
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }

      if (p.attract > 0 && p.target) {
        vA.copy(p.target).sub(p.pos);
        const distance = vA.length();
        if (distance > 0.0001) {
          vA.multiplyScalar(1 / distance);
          p.vel.addScaledVector(vA, p.attract * dt);
          if (p.swirl !== 0) {
            vB.crossVectors(vA, UP).normalize().multiplyScalar(p.swirl * dt * 2.2);
            p.vel.add(vB);
          }
        }
        if (p.arriveAt > 0 && distance < p.arriveAt) {
          p.active = false;
          if (p.onArrive === 1) arrivalBloom?.();
          continue;
        }
      }

      live += 1;
      p.vel.y += p.gravity * dt;
      if (p.drag > 0) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.rot += p.spin * dt;

      if (p.bounce > 0 && p.pos.y < p.floor && p.vel.y < 0) {
        p.pos.y = p.floor;
        p.vel.y = -p.vel.y * p.bounce;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
        if (Math.abs(p.vel.y) < 0.4) p.bounce = 0;
      }

      const t = p.age / p.life;
      const alpha = p.alpha * Math.pow(1 - t, p.fade) * Math.min(1, t / 0.06);
      if (alpha <= 0.002) continue;
      const size = lerp(p.size0, p.size1, t);
      colA.copy(p.colour).lerp(p.colourEnd, t);

      if (p.stretch > 0) {
        const speed = p.vel.length();
        if (speed > 0.05) {
          vA.copy(p.vel).multiplyScalar(p.stretch);
          const len = vA.length();
          // Never shorter than the particle is wide, never longer than a die:
          // past that a spark stops reading as a spark and starts reading as
          // a stick lying in space.
          if (len < size) vA.setLength(size);
          else if (len > 0.55) vA.setLength(0.55);
          field.streak(
            p.pos.x, p.pos.y, p.pos.z,
            vA.x, vA.y, vA.z,
            size,
            colA.r, colA.g, colA.b,
            alpha,
            p.shape,
          );
          continue;
        }
      }
      field.billboard(p.pos.x, p.pos.y, p.pos.z, size, size, colA.r, colA.g, colA.b, alpha, p.shape, p.rot);
    }
    particlesLive = live;
  }

  function updateDebris(dt: number) {
    if (!debrisMesh.visible) return;
    let alive = 0;
    for (let i = 0; i < debrisMesh.count; i += 1) {
      const shard = debris[i]!;
      if (!shard.active) {
        matA.makeScale(0, 0, 0);
        debrisMesh.setMatrixAt(i, matA);
        continue;
      }
      alive += 1;
      shard.age += dt;
      const t = clamp(shard.age / shard.life, 0, 1);
      if (t >= 1) {
        shard.active = false;
        matA.makeScale(0, 0, 0);
        debrisMesh.setMatrixAt(i, matA);
        continue;
      }
      shard.vel.y -= 15 * dt;
      shard.vel.multiplyScalar(Math.max(0, 1 - 0.5 * dt));
      shard.pos.addScaledVector(shard.vel, dt);
      if (shard.pos.y < deckY + 0.12 && shard.vel.y < 0) {
        shard.pos.y = deckY + 0.12;
        shard.vel.y = -shard.vel.y * 0.32;
        shard.vel.x *= 0.7;
        shard.vel.z *= 0.7;
        shard.spin.multiplyScalar(0.6);
      }
      quatA.setFromAxisAngle(vA.copy(shard.spin).normalize(), shard.spin.length() * dt);
      shard.quat.premultiply(quatA).normalize();
      const shrink = 1 - Math.pow(clamp((t - 0.6) / 0.4, 0, 1), 2);
      vB.copy(shard.scale).multiplyScalar(shrink);
      matA.compose(shard.pos, shard.quat, vB);
      debrisMesh.setMatrixAt(i, matA);
      // Cools from white-hot to cold hull grey as it falls.
      const heat = Math.pow(1 - t, 1.6);
      debrisColour.setRGB(0.42 + heat * 0.75, 0.44 + heat * 0.34, 0.52 + heat * 0.18);
      debrisMesh.setColorAt(i, debrisColour);
    }
    debrisMesh.instanceMatrix.needsUpdate = true;
    if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
    if (alive === 0) {
      debrisMesh.visible = false;
      debrisMesh.count = 0;
    }
  }

  function update(dt: number, _time: number) {
    if (disposed) return;
    field.begin(budget().live);

    for (let i = tasks.length - 1; i >= 0; i -= 1) {
      const task = tasks[i]!;
      task.age += dt;
      if (!task.dead) task.step(task, dt);
      if (task.dead || task.age >= task.duration) {
        tasks.splice(i, 1);
        task.done?.();
      }
    }

    updateParticles(dt);
    updateDebris(dt);
    field.end();
  }

  /* ================================================================== */

  function dispose() {
    if (disposed) return;
    disposed = true;

    tasks.length = 0;
    for (const resolve of pending) resolve();
    pending.clear();
    arrivalBloom = null;

    motionQuery?.removeEventListener("change", onMotionChange);

    field.dispose();

    for (const slot of numberSlots) {
      slot.value.material.dispose();
      slot.value.texture.dispose();
    }
    shieldGeometry.dispose();
    for (const slot of shieldSlots) slot.value.material.dispose();
    for (const slot of ribbonSlots) {
      slot.value.geometry.dispose();
      slot.value.material.dispose();
    }
    darkGeometry.dispose();
    darkTexture.dispose();
    for (const slot of darkSlots) slot.value.material.dispose();
    debrisGeometry.dispose();
    debrisMaterial.dispose();
    debrisMesh.dispose();

    root.clear();
    root.removeFromParent();
  }

  return {
    volley,
    impact,
    shieldBlock,
    shipSacrifice,
    repair,
    energyGain,
    floatingNumber,
    straightSweep,
    formation,
    flagshipBreak,
    update,
    dispose,
  };
}
