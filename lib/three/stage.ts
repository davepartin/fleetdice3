/**
 * The stage: renderer, camera, lights, sky and the post chain.
 *
 * Everything that makes the board look like a place rather than a web page
 * lives here. It watches its own frame time and quietly drops quality rather
 * than stuttering, because the game has to feel good on a phone first.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export type Quality = "low" | "medium" | "high";

export type ViewportInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type Stage = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** The group everything on the board hangs from — shaken, tilted, parallaxed. */
  world: THREE.Group;
  quality: Quality;
  time: number;
  setQuality(quality: Quality): void;
  shake(strength: number): void;
  flash(color: THREE.ColorRepresentation, strength: number): void;
  /** Push the camera in or out; 1 is the resting frame. */
  setZoom(zoom: number, immediate?: boolean): void;
  lookAt(target: THREE.Vector3, immediate?: boolean): void;
  /** Move the resting camera. Everything eases toward it. */
  setFrame(frame: Partial<CameraFrame>, immediate?: boolean): void;
  /** Reserve screen-space for HUD chrome so the board never hides behind it. */
  setViewportInsets(insets: Partial<ViewportInsets>): void;
  onFrame(callback: (dt: number, time: number) => void): () => void;
  resize(): void;
  start(): void;
  stop(): void;
  dispose(): void;
};

/* ------------------------------------------------------------------ */
/* Colour grade — vignette, grain, a touch of chromatic aberration      */
/* ------------------------------------------------------------------ */

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.92 },
    uGrain: { value: 0.007 },
    uAberration: { value: 0.00055 },
    uFlash: { value: new THREE.Color(0, 0, 0) },
    uFlashAmount: { value: 0 },
    uSaturation: { value: 1.04 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform vec3 uFlash;
    uniform float uFlashAmount;
    uniform float uSaturation;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 centred = vUv - 0.5;
      float radius = length(centred);

      // Lenses bend the edges of the frame more than the middle.
      float shift = uAberration * radius * radius * 4.0;
      vec3 colour;
      colour.r = texture2D(tDiffuse, vUv + centred * shift).r;
      colour.g = texture2D(tDiffuse, vUv).g;
      colour.b = texture2D(tDiffuse, vUv - centred * shift).b;

      // Saturation
      float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
      colour = mix(vec3(luma), colour, uSaturation);

      // Vignette, cool in the corners so the frame feels deep
      float vig = 1.0 - smoothstep(0.28, 0.92, radius * uVignette);
      colour *= mix(0.7, 1.0, vig);
      colour += vec3(0.004, 0.008, 0.022) * (1.0 - vig);

      // Flash for impacts
      colour = mix(colour, uFlash, uFlashAmount);

      // Grain keeps gradients from banding on cheap panels
      float noise = hash(vUv * 900.0 + fract(uTime) * 100.0) - 0.5;
      colour += noise * uGrain;

      gl_FragColor = vec4(colour, 1.0);
    }
  `,
};

/* ------------------------------------------------------------------ */
/* A hand-built sky, so PBR has something worth reflecting              */
/* ------------------------------------------------------------------ */

function environmentTexture(renderer: THREE.WebGLRenderer): THREE.Texture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#0a1430");
  sky.addColorStop(0.42, "#050a18");
  sky.addColorStop(0.62, "#080d1c");
  sky.addColorStop(1, "#010206");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const blob = (x: number, y: number, r: number, colour: string, alpha: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, colour);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  };

  // Key light: a cold star high and to the left.
  blob(width * 0.24, height * 0.2, 260, "#cfe4ff", 0.95);
  // Warm bounce from the right, so metal has two temperatures to catch.
  blob(width * 0.78, height * 0.34, 300, "#ff8a5c", 0.5);
  // Distant nebula wash.
  blob(width * 0.52, height * 0.7, 420, "#2c3fa0", 0.35);
  blob(width * 0.06, height * 0.78, 300, "#7b2ea8", 0.22);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(texture);
  texture.dispose();
  pmrem.dispose();
  return target.texture;
}

/* ------------------------------------------------------------------ */
/* Deep space behind the board                                          */
/* ------------------------------------------------------------------ */

function buildStarfield(): THREE.Points {
  const count = 1400;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const palette = [
    new THREE.Color(0xffffff),
    new THREE.Color(0xbfd8ff),
    new THREE.Color(0xffd9b0),
    new THREE.Color(0x9fb8ff),
  ];
  for (let i = 0; i < count; i += 1) {
    const radius = 60 + Math.random() * 120;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi) * 0.55;
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 40;
    const colour = palette[Math.floor(Math.random() * palette.length)]!;
    colors[i * 3] = colour.r;
    colors[i * 3 + 1] = colour.g;
    colors[i * 3 + 2] = colour.b;
    sizes[i] = Math.random() < 0.06 ? 2.6 + Math.random() * 2 : 0.5 + Math.random() * 1.1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColour;
      varying float vTwinkle;
      uniform float uTime;
      uniform float uScale;
      void main() {
        vColour = color;
        vTwinkle = 0.65 + 0.35 * sin(uTime * 1.4 + position.x * 0.6 + position.y);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale * (240.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColour;
      varying float vTwinkle;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float core = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColour, core * core * vTwinkle);
      }
    `,
    vertexColors: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = "starfield";
  return points;
}

/** A slow drifting nebula, far behind everything. */
function buildNebula(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(340, 200);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;

      vec2 hash2(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = dot(hash2(i) - 0.5, f);
        float b = dot(hash2(i + vec2(1.0, 0.0)) - 0.5, f - vec2(1.0, 0.0));
        float c = dot(hash2(i + vec2(0.0, 1.0)) - 0.5, f - vec2(0.0, 1.0));
        float d = dot(hash2(i + vec2(1.0, 1.0)) - 0.5, f - vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) + 0.5;
      }
      float fbm(vec2 p) {
        float total = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 5; i++) {
          total += noise(p) * amp;
          p *= 2.03;
          amp *= 0.5;
        }
        return total;
      }

      void main() {
        vec2 uv = vUv * vec2(2.6, 1.6);
        float drift = uTime * 0.008;
        float f = fbm(uv * 2.2 + vec2(drift, drift * 0.6));
        float g = fbm(uv * 3.6 - vec2(drift * 0.7, drift));

        vec3 violet = vec3(0.34, 0.16, 0.62);
        vec3 teal = vec3(0.06, 0.28, 0.5);
        vec3 ember = vec3(0.5, 0.15, 0.2);

        vec3 colour = mix(teal, violet, smoothstep(0.35, 0.75, f));
        colour = mix(colour, ember, smoothstep(0.62, 0.95, g) * 0.55);

        float mask = smoothstep(0.28, 0.78, f * g * 1.9);
        float edge = smoothstep(0.0, 0.42, vUv.y) * smoothstep(1.0, 0.58, vUv.y);
        edge *= smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);

        gl_FragColor = vec4(colour, mask * edge * 0.5);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 6, -110);
  mesh.renderOrder = -10;
  mesh.name = "nebula";
  return mesh;
}

/* ------------------------------------------------------------------ */

export function guessQuality(): Quality {
  if (typeof window === "undefined") return "medium";
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const small = Math.min(window.innerWidth, window.innerHeight) < 480;
  if (cores <= 4 || memory <= 3) return small ? "low" : "medium";
  if (cores >= 8 && memory >= 8) return "high";
  return "medium";
}

const QUALITY_SETTINGS: Record<
  Quality,
  { dpr: number; bloom: number; shadows: boolean; grade: boolean; stars: boolean; nebula: boolean }
> = {
  // A low effects tier must not also mean low-resolution game information.
  // Safari commonly chooses medium and has a 3× display; the old 1.4 cap was
  // then enlarged by iOS and made every face look soft in a real screenshot.
  low: { dpr: 2, bloom: 0, shadows: false, grade: false, stars: true, nebula: false },
  medium: { dpr: 2.5, bloom: 0.13, shadows: true, grade: true, stars: true, nebula: true },
  high: { dpr: 3, bloom: 0.18, shadows: true, grade: true, stars: true, nebula: true },
};

/** Where the camera rests when nothing dramatic is happening. */
/**
 * Where the camera rests.
 *
 * The camera is told *what to fit*, not where to stand. A fixed distance that
 * frames the board beautifully on a laptop cuts the sides off a phone held
 * upright, so instead we say "keep this much world visible" and work the
 * distance out from the aspect ratio every time the window changes.
 */
export type CameraFrame = {
  /** Angle above the board, in degrees. 90 is straight down. */
  pitch: number;
  /** World width that must stay on screen. */
  fitWidth: number;
  /** World depth that must stay on screen, measured on the board plane. */
  fitDepth: number;
  /** Point the camera looks at. */
  target: THREE.Vector3;
  /** How much the pointer is allowed to swing the view. */
  parallax: number;
};

const DEFAULT_FRAME: CameraFrame = {
  pitch: 48,
  fitWidth: 13,
  fitDepth: 13,
  target: new THREE.Vector3(0, 0, 0),
  parallax: 1,
};

/** The distance that keeps `fitWidth × fitDepth` inside the frame. */
function distanceFor(
  camera: THREE.PerspectiveCamera,
  frame: CameraFrame,
  width: number,
  height: number,
  insets: ViewportInsets,
): number {
  const halfFov = (camera.fov * Math.PI) / 360;
  const tan = Math.tan(halfFov);
  const safeWidth = Math.max(1, width - insets.left - insets.right);
  const safeHeight = Math.max(1, height - insets.top - insets.bottom);
  // The projection still covers the full canvas, so scale the requested world
  // bounds by the fraction of pixels the HUD leaves unobstructed.
  const forWidth = (frame.fitWidth * height) / (2 * tan * safeWidth);
  // Vertical: a board tilted away from the camera takes up less height than
  // its depth, by roughly the sine of the pitch.
  const lean = Math.max(0.3, Math.sin((frame.pitch * Math.PI) / 180));
  const forDepth = (frame.fitDepth * lean * height) / (2 * tan * safeHeight);
  return Math.max(forWidth, forDepth) * 1.04;
}

export function createStage(canvas: HTMLCanvasElement, initial?: Quality): Stage {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
    stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050c);
  scene.fog = new THREE.FogExp2(0x03050c, 0.0075);
  scene.environment = environmentTexture(renderer);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  camera.position.set(0, 3.4, 17);

  const world = new THREE.Group();
  scene.add(world);

  const backdrop = new THREE.Group();
  scene.add(backdrop);

  const stars = buildStarfield();
  const nebula = buildNebula();
  backdrop.add(stars, nebula);

  /* Lights ---------------------------------------------------------- */

  const ambient = new THREE.AmbientLight(0x6d83c1, 0.5);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xdce9ff, 1.65);
  key.position.set(-7, 13, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 45;
  key.shadow.camera.left = -14;
  key.shadow.camera.right = 14;
  key.shadow.camera.top = 14;
  key.shadow.camera.bottom = -14;
  key.shadow.bias = -0.0016;
  key.shadow.normalBias = 0.03;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xff8a5c, 0.82);
  rim.position.set(9, 5, -8);
  scene.add(rim);

  // A broad directional fill keeps every cell readable. The old inverse-square
  // point light sat directly over the flagship and lit it several times harder
  // than the corner dice, which is why the centre became a white flare.
  const fill = new THREE.DirectionalLight(0x76bfff, 0.7);
  fill.position.set(0, 8, 10);
  scene.add(fill);

  /* Post ------------------------------------------------------------ */

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  // Bloom is a highlight, never the light source. The old 0.88 threshold let
  // the entire gold flagship face bloom into a white rectangle on real GPUs.
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.18, 0.28, 1.08);
  const gradePass = new ShaderPass(GradeShader);
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(gradePass);
  composer.addPass(outputPass);

  /* State ----------------------------------------------------------- */

  let quality: Quality = initial ?? guessQuality();
  let settings = QUALITY_SETTINGS[quality];
  let running = false;
  let raf = 0;
  let last = 0;
  let time = 0;
  let shakeAmount = 0;
  let flashAmount = 0;
  let zoom = 1;
  let zoomTarget = 1;
  const viewportInsets: ViewportInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frameNow: CameraFrame = { ...DEFAULT_FRAME, target: DEFAULT_FRAME.target.clone() };
  const frameTarget: CameraFrame = { ...DEFAULT_FRAME, target: DEFAULT_FRAME.target.clone() };
  const lookTarget = new THREE.Vector3(0, 0.2, 0);
  const lookCurrent = new THREE.Vector3(0, 0.2, 0);
  const pointer = new THREE.Vector2();
  const callbacks = new Set<(dt: number, time: number) => void>();

  // Frame-time watchdog: three bad seconds in a row and we drop a tier.
  let slowFrames = 0;
  let totalFrames = 0;
  let checkedAt = 0;
  // A forced tier is a visual-test contract; never quietly downgrade it.
  let autoDropped = initial !== undefined;

  function applyQuality() {
    settings = QUALITY_SETTINGS[quality];
    const phone = Math.min(window.innerWidth, window.innerHeight) <= 640;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.dpr));
    renderer.shadowMap.enabled = settings.shadows;
    key.castShadow = settings.shadows;
    bloomPass.enabled = settings.bloom > 0;
    // On a phone, bloom and lens artifacts compete with glyph pixels. Keep the
    // cinematic treatment in the sky/VFX and give dice faces a clean path.
    bloomPass.strength = phone ? settings.bloom * 0.35 : settings.bloom;
    bloomPass.threshold = phone ? 1.22 : 1.08;
    bloomPass.radius = phone ? 0.16 : 0.28;
    gradePass.enabled = settings.grade;
    gradePass.uniforms.uGrain.value = phone ? 0 : 0.007;
    gradePass.uniforms.uAberration.value = phone ? 0 : 0.00055;
    gradePass.uniforms.uVignette.value = phone ? 0.35 : 0.92;
    stars.visible = settings.stars;
    nebula.visible = settings.nebula;
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = settings.shadows && object.castShadow;
    });
    resize();
  }

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    camera.aspect = width / height;
    // A slightly wider lens upright, so the far deck does not shrink to nothing.
    camera.fov = height > width ? 44 : 36;
    camera.updateProjectionMatrix();
    const safeHeight = Math.max(1, height - viewportInsets.top - viewportInsets.bottom);
    const safeCenterY = viewportInsets.top + safeHeight / 2;
    const opticalOffsetY = height / 2 - safeCenterY;
    if (Math.abs(opticalOffsetY) > 0.5) {
      camera.setViewOffset(width, height, 0, opticalOffsetY, width, height);
    } else {
      camera.clearViewOffset();
    }
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloomPass.resolution.set(width, height);
  }

  function onPointerMove(event: PointerEvent) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    /**
     * Clamped generously rather than tightly.
     *
     * A small ceiling here looks like the safe choice, but it is not: at 0.05
     * every frame on a device running at 5fps advances the world by a fiftieth
     * of a second, so a three-quarter-second dice throw takes four seconds and
     * the board appears to have frozen mid-air. A 0.2 ceiling still swallows
     * the huge jump you get when a tab wakes up, and keeps animation honest
     * with the clock all the way down to five frames a second.
     */
    const dt = Math.min(0.2, (now - last) / 1000);
    last = now;
    time += dt;

    // Watchdog: drop a tier when most frames in a window are slow. Counting
    // slow frames outright never fired on the machines that needed it most,
    // because a machine that is struggling produces very few frames to count.
    if (!autoDropped && quality !== "low") {
      totalFrames += 1;
      if (dt > 0.032) slowFrames += 1;
      if (now - checkedAt > 1600) {
        checkedAt = now;
        const bad = totalFrames > 0 ? slowFrames / totalFrames : 0;
        if (totalFrames >= 6 && bad > 0.5) {
          quality = quality === "high" ? "medium" : "low";
          autoDropped = quality === "low";
          applyQuality();
        }
        slowFrames = 0;
        totalFrames = 0;
      }
    }

    for (const callback of callbacks) callback(dt, time);

    // Camera: a resting three-quarter view, breathing, with a little parallax.
    zoom += (zoomTarget - zoom) * Math.min(1, dt * 4.5);
    lookCurrent.lerp(lookTarget, Math.min(1, dt * 4));
    const glide = Math.min(1, dt * 3.2);
    frameNow.pitch += (frameTarget.pitch - frameNow.pitch) * glide;
    frameNow.fitWidth += (frameTarget.fitWidth - frameNow.fitWidth) * glide;
    frameNow.fitDepth += (frameTarget.fitDepth - frameNow.fitDepth) * glide;
    frameNow.parallax += (frameTarget.parallax - frameNow.parallax) * glide;
    frameNow.target.lerp(frameTarget.target, glide);
    lookTarget.copy(frameNow.target);

    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const distance = distanceFor(camera, frameNow, width, height, viewportInsets) * zoom;
    const pitch = (frameNow.pitch * Math.PI) / 180;
    const breathe = Math.sin(time * 0.32) * 0.1;
    camera.position.set(
      frameNow.target.x + pointer.x * 0.75 * frameNow.parallax,
      frameNow.target.y + Math.sin(pitch) * distance + breathe - pointer.y * 0.5 * frameNow.parallax,
      frameNow.target.z + Math.cos(pitch) * distance,
    );

    if (shakeAmount > 0) {
      shakeAmount = Math.max(0, shakeAmount - dt * 3.1);
      const power = shakeAmount * shakeAmount;
      camera.position.x += (Math.random() - 0.5) * power * 2.1;
      camera.position.y += (Math.random() - 0.5) * power * 1.7;
      camera.rotation.z = (Math.random() - 0.5) * power * 0.05;
    } else {
      camera.rotation.z = 0;
    }
    camera.lookAt(lookCurrent);

    if (flashAmount > 0) flashAmount = Math.max(0, flashAmount - dt * 4.2);
    gradePass.uniforms.uFlashAmount.value = flashAmount * 0.7;
    gradePass.uniforms.uTime.value = time;

    (stars.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    (nebula.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    backdrop.rotation.y = time * 0.006;
    nebula.position.x = Math.sin(time * 0.05) * 6;

    if (settings.bloom > 0 || settings.grade) composer.render();
    else renderer.render(scene, camera);
  }

  applyQuality();

  const stage: Stage = {
    scene,
    camera,
    renderer,
    world,
    get quality() {
      return quality;
    },
    get time() {
      return time;
    },
    setQuality(next) {
      quality = next;
      autoDropped = true;
      applyQuality();
    },
    shake(strength) {
      shakeAmount = Math.min(1.6, Math.max(shakeAmount, strength));
    },
    flash(color, strength) {
      gradePass.uniforms.uFlash.value = new THREE.Color(color);
      flashAmount = Math.min(1, Math.max(flashAmount, strength));
    },
    setZoom(next, immediate) {
      zoomTarget = next;
      if (immediate) zoom = next;
    },
    lookAt(target, immediate) {
      lookTarget.copy(target);
      if (immediate) lookCurrent.copy(target);
    },
    setFrame(next, immediate) {
      if (next.target) frameTarget.target.copy(next.target);
      if (next.pitch !== undefined) frameTarget.pitch = next.pitch;
      if (next.fitWidth !== undefined) frameTarget.fitWidth = next.fitWidth;
      if (next.fitDepth !== undefined) frameTarget.fitDepth = next.fitDepth;
      if (next.parallax !== undefined) frameTarget.parallax = next.parallax;
      if (immediate) {
        frameNow.pitch = frameTarget.pitch;
        frameNow.fitWidth = frameTarget.fitWidth;
        frameNow.fitDepth = frameTarget.fitDepth;
        frameNow.parallax = frameTarget.parallax;
        frameNow.target.copy(frameTarget.target);
        lookCurrent.copy(frameTarget.target);
      }
    },
    setViewportInsets(next) {
      viewportInsets.top = Math.max(0, next.top ?? viewportInsets.top);
      viewportInsets.right = Math.max(0, next.right ?? viewportInsets.right);
      viewportInsets.bottom = Math.max(0, next.bottom ?? viewportInsets.bottom);
      viewportInsets.left = Math.max(0, next.left ?? viewportInsets.left);
      resize();
    },
    onFrame(callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    resize,
    start() {
      if (running) return;
      running = true;
      last = 0;
      checkedAt = performance.now();
      raf = requestAnimationFrame(frame);
      window.addEventListener("resize", resize);
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    },
    dispose() {
      stage.stop();
      callbacks.clear();
      composer.dispose();
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
      nebula.geometry.dispose();
      (nebula.material as THREE.Material).dispose();
      renderer.dispose();
    },
  } as Stage;

  return stage;
}
