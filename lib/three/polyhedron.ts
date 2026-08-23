/**
 * Real polyhedral dice, built face by face.
 *
 * Three's built-in solids give you the right silhouette but no way to say
 * "this triangle is the 7". So we describe each die as vertices plus faces,
 * then build the geometry ourselves: every face gets its own square of a
 * texture atlas and its own orientation, which is what lets the die turn to
 * show a number you asked for.
 */

import * as THREE from "three";

export type DieShape = {
  /** Unit-ish vertices. Scaled to a common radius when the geometry is built. */
  vertices: number[][];
  /** Each face is a loop of vertex indices, wound counter-clockwise. */
  faces: number[][];
  /**
   * How much of the atlas cell the art is allowed to claim, measured from the
   * centre outward. The face is fitted so its inscribed circle covers exactly
   * this much of the cell — which is what keeps a number inside a triangle or a
   * kite instead of spilling onto the neighbouring face.
   */
  artRadius: number;
  /** Extra spin applied to the face art so numbers sit upright. */
  textureRotation: number;
  /**
   * Hand-tuned size so a set of these reads like a real dice set. Normalising
   * by the outer radius makes a d4 look tiny and normalising by the face makes
   * it look enormous, so each shape carries its own number.
   */
  displayScale: number;
};

/** A tetrahedron. Four triangles — the smallest ship in the fleet. */
const D4: DieShape = {
  vertices: [
    [1, 1, 1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, -1, -1],
  ],
  faces: [
    [1, 0, 2],
    [0, 1, 3],
    [2, 3, 0],
    [3, 2, 1],
  ],
  artRadius: 0.4,
  textureRotation: 0,
  // The smallest hull in the fleet. Every other displayScale is set relative
  // to this one, so a bigger die always, unambiguously, reads as bigger.
  displayScale: 0.82,
};

/** A cube. */
const D6: DieShape = {
  vertices: [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ],
  faces: [
    [4, 5, 6, 7], // +Z
    [1, 0, 3, 2], // -Z
    [5, 1, 2, 6], // +X
    [0, 4, 7, 3], // -X
    [7, 6, 2, 3], // +Y
    [0, 1, 5, 4], // -Y
  ],
  artRadius: 0.44,
  textureRotation: 0,
  // A cube already carries more visual mass than a pointed hull at the same
  // radius — its face is a full square, not a triangle tapering to a point —
  // so it needs less of a scale boost than d8/d10 to read as the second step
  // up from d4.
  displayScale: 0.95,
};

/** An octahedron. Eight triangles. */
const D8: DieShape = {
  vertices: [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ],
  faces: [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ],
  artRadius: 0.4,
  textureRotation: 0,
  // A d8's single visible face is the same equilateral triangle as a d4's —
  // shape alone cannot tell them apart from a fixed overhead camera, so size
  // has to. Clearly bigger than d4, clearly smaller than d10.
  displayScale: 1.02,
};

/**
 * A pentagonal trapezohedron — the shape of every d10 you have ever rolled.
 *
 * Ten kite faces, five hanging from each point. The kites are only flat at one
 * exact proportion: with a ring of radius 1 sitting at ±h, the apex has to be
 * at (1 + cos36°)/(1 − cos36°) × h, or roughly 9.47h. Get that wrong and the
 * faces buckle, the numbers smear across the fold, and the die looks broken —
 * which is exactly what happened the first time.
 */
function buildD10(): DieShape {
  const h = 0.105;
  const cos36 = Math.cos(Math.PI / 5);
  const apex = ((1 + cos36) / (1 - cos36)) * h;

  const vertices: number[][] = [];
  // A zigzag ring of ten: even indices ride high, odd indices ride low.
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2;
    vertices.push([Math.cos(angle), Math.sin(angle), i % 2 === 0 ? h : -h]);
  }
  const top = vertices.push([0, 0, apex]) - 1;
  const bottom = vertices.push([0, 0, -apex]) - 1;

  const faces: number[][] = [];
  for (let k = 0; k < 5; k += 1) {
    const a = (2 * k) % 10;
    const b = (2 * k + 1) % 10;
    const c = (2 * k + 2) % 10;
    faces.push([top, a, b, c]);
  }
  for (let k = 0; k < 5; k += 1) {
    const a = (2 * k + 1) % 10;
    const b = (2 * k + 2) % 10;
    const c = (2 * k + 3) % 10;
    faces.push([bottom, a, b, c]);
  }

  // The heaviest gun in the fleet. Its ten thin kite faces read as visually
  // slighter than a cube or octahedron's broad faces at the same radius, so
  // it needs the biggest displayScale of the four just to be seen as the top
  // of the upgrade ladder rather than the runt of it.
  return { vertices, faces, artRadius: 0.36, textureRotation: 0, displayScale: 1.12 };
}

const D10 = buildD10();

export const SHAPES: Record<number, DieShape> = { 4: D4, 6: D6, 8: D8, 10: D10 };

/* ------------------------------------------------------------------ */

export type FaceFrame = {
  /** Unit normal of the face, in model space. */
  normal: THREE.Vector3;
  /** Rotation that turns the die so this face points at +Z, upright. */
  quaternion: THREE.Quaternion;
  /** Centre of the face in model space — where a glow or ring is anchored. */
  centre: THREE.Vector3;
};

export type BuiltDie = {
  geometry: THREE.BufferGeometry;
  /** One frame per face, in the order the faces were declared. */
  frames: FaceFrame[];
  /** Distance to the furthest corner — the silhouette. */
  radius: number;
  /** Distance to the nearest face — how high the die sits when it lands. */
  seatHeight: number;
};

/**
 * Turn a shape into geometry with per-face UVs pointing at a `columns × rows`
 * atlas, plus the rotation needed to bring each face to camera.
 */
export function buildDie(sides: number, radius: number, columns: number, rows: number): BuiltDie {
  const shape = SHAPES[sides];
  if (!shape) throw new Error(`No die shape for d${sides}`);

  // Scale the whole solid, never each vertex. Pushing every vertex onto a
  // sphere is fine for a cube but it destroys a trapezohedron's flat faces.
  const raw = shape.vertices.map((v) => new THREE.Vector3(v[0]!, v[1]!, v[2]!));
  const reachOut = raw.reduce((max, point) => Math.max(max, point.length()), 0) || 1;
  const scaled = (radius * shape.displayScale) / reachOut;
  const points = raw.map((point) => point.multiplyScalar(scaled));

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const faceIndexes: number[] = [];
  const frames: FaceFrame[] = [];

  const cellW = 1 / columns;
  const cellH = 1 / rows;

  shape.faces.forEach((loop, faceIndex) => {
    const loopPoints = loop.map((index) => points[index]!);

    // Face centre and outward normal.
    const centre = new THREE.Vector3();
    for (const point of loopPoints) centre.add(point);
    centre.divideScalar(loopPoints.length);

    const wound = new THREE.Vector3()
      .subVectors(loopPoints[1]!, loopPoints[0]!)
      .cross(new THREE.Vector3().subVectors(loopPoints[2]!, loopPoints[0]!))
      .normalize();
    // If a loop was written clockwise from outside, its triangles face inward
    // and get culled — the die turns into a dark silhouette. Flip the loop, not
    // just the normal.
    const flipped = wound.dot(centre) < 0;
    if (flipped) loopPoints.reverse();
    const normal = flipped ? wound.negate() : wound;

    // Texture "up" for this face — which way is up when this face is turned to
    // camera. It has to come from the face's own shape, not from world up:
    // world up projects differently onto each face of a tetrahedron, so every
    // triangle ended up pointing a different way and the fleet looked scattered.
    //
    // A kite takes its long point as the top, which is how a real d10 is
    // numbered. Any other face takes its first vertex, so every triangle on a
    // die points the same way and the board reads as a set.
    let up: THREE.Vector3;
    const spans = loopPoints.map((point) => point.distanceTo(centre));
    const far = Math.max(...spans);
    const near = Math.min(...spans);
    // A square is the exception: its corners are all equal, and pointing at one
    // of them would stand every face on a corner. Use the edge midpoint.
    const square = loopPoints.length === 4 && far - near <= far * 0.08;
    const anchor = square
      ? new THREE.Vector3().addVectors(loopPoints[0]!, loopPoints[1]!).multiplyScalar(0.5)
      : far - near > far * 0.08
        ? loopPoints[spans.indexOf(far)]!
        : loopPoints[0]!;
    up = new THREE.Vector3().subVectors(anchor, centre).normalize();
    if (!Number.isFinite(up.x) || up.lengthSq() < 0.5) {
      up = new THREE.Vector3(0, 1, 0);
      if (Math.abs(normal.dot(up)) > 0.985) up = new THREE.Vector3(1, 0, 0);
    }
    const tangent = new THREE.Vector3().crossVectors(up, normal).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    if (shape.textureRotation) {
      const spin = new THREE.Quaternion().setFromAxisAngle(normal, shape.textureRotation);
      tangent.applyQuaternion(spin);
      bitangent.applyQuaternion(spin);
    }

    // Fit the art to the circle that fits *inside* the face, not to the box that
    // wraps around it. A triangle's corners reach much further than its edges
    // do, and sizing to the corners is what pushed numbers over the edge.
    let inRadius = Infinity;
    for (let i = 0; i < loopPoints.length; i += 1) {
      const a = loopPoints[i]!;
      const b = loopPoints[(i + 1) % loopPoints.length]!;
      const edge = new THREE.Vector3().subVectors(b, a);
      const toCentre = new THREE.Vector3().subVectors(centre, a);
      const along = edge.lengthSq() ? toCentre.dot(edge) / edge.lengthSq() : 0;
      const nearest = a.clone().addScaledVector(edge, Math.min(1, Math.max(0, along)));
      inRadius = Math.min(inRadius, nearest.distanceTo(centre));
    }
    if (!Number.isFinite(inRadius) || inRadius <= 0) inRadius = 0.5;
    const span = inRadius / shape.artRadius;

    const column = faceIndex % columns;
    const row = Math.floor(faceIndex / columns);

    const uvFor = (point: THREE.Vector3) => {
      const offset = new THREE.Vector3().subVectors(point, centre);
      const rawU = offset.dot(tangent) / span + 0.5;
      const rawV = offset.dot(bitangent) / span + 0.5;
      // A triangle's corners reach roughly twice as far as its inscribed
      // circle. Their old UVs therefore crossed into the *next atlas cell*,
      // pulling another face's red or blue pixels into the visible corners.
      // Keep every polygon inside its own padded cell; the centre art remains
      // undistorted while mipmaps and anisotropic filtering get a safe gutter.
      const gutter = 0.025;
      const u = THREE.MathUtils.clamp(rawU, gutter, 1 - gutter);
      const v = THREE.MathUtils.clamp(rawV, gutter, 1 - gutter);
      // Atlas rows count from the top of the canvas.
      return [(column + u) * cellW, 1 - (row + 1 - v) * cellH];
    };

    // Fan the loop into triangles.
    for (let i = 1; i < loopPoints.length - 1; i += 1) {
      const triangle = [loopPoints[0]!, loopPoints[i]!, loopPoints[i + 1]!];
      for (const point of triangle) {
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
        const [u, v] = uvFor(point);
        uvs.push(u!, v!);
        faceIndexes.push(faceIndex);
      }
    }

    // The rotation that brings this face to camera: invert the face's own basis.
    const basis = new THREE.Matrix4().makeBasis(tangent, bitangent, normal);
    const quaternion = new THREE.Quaternion()
      .setFromRotationMatrix(basis)
      .invert();

    frames.push({ normal, quaternion, centre });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  // Which face (0-based, matching `frames`) each vertex belongs to, so a
  // die's material can dim every face but the one it rolled.
  geometry.setAttribute("faceIndex", new THREE.Float32BufferAttribute(faceIndexes, 1));
  geometry.computeBoundingSphere();

  const seatHeight = frames.reduce(
    (min, frame) => Math.min(min, frame.centre.length()),
    Infinity,
  );

  return { geometry, frames, radius: radius * shape.displayScale, seatHeight };
}

/**
 * A soft-edged version of the same solid, used underneath as a bevel so the
 * silhouette does not read as a flat papercraft model.
 */
export function buildBevelShell(sides: number, radius: number): THREE.BufferGeometry {
  const shape = SHAPES[sides];
  if (!shape) throw new Error(`No die shape for d${sides}`);
  const points = shape.vertices.map(
    (v) => new THREE.Vector3(v[0]!, v[1]!, v[2]!).normalize().multiplyScalar(radius),
  );
  const positions: number[] = [];
  for (const loop of shape.faces) {
    const loopPoints = loop.map((index) => points[index]!);
    for (let i = 1; i < loopPoints.length - 1; i += 1) {
      for (const point of [loopPoints[0]!, loopPoints[i]!, loopPoints[i + 1]!]) {
        positions.push(point.x, point.y, point.z);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
