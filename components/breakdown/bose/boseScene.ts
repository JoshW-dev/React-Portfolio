import type * as THREE from "three";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
  createProjector,
  createRenderer,
  createScreenBox,
  disposeRenderer,
  lerp,
  near,
  paperLights,
  placeCallouts,
  ramp,
  readPalette,
  remeasureCallouts,
  sizeRenderer,
  track,
  type Callout,
  type CalloutPlacement,
  type Rect,
  type ScreenPoint,
  type Side,
} from "@/components/breakdown/kit";
import type { BreakdownScene, SceneContext } from "@/components/breakdown/ScrollBreakdown";

/*
  The Bose AR breakdown: a low-poly head and shoulders in Bose Frames, with a phone floating
  beside it that shows the music's volume as a bar. Scroll position (0 to 4) drives it:

  0  the frames in blue, a set of axes on the arm, orientation sent to the phone
  1  a forward line from the face, set at start and reset by a double tap
  2  from above: the head turns out past a 40 degree wedge, the bar falls (Aware), and it
     comes back as the head returns (Focused)
  3  from behind: the head leans one way and the other, and the bar follows
  4  from the side: a nod, and the bar becomes a pause mark

  The head turns, leans and nods while its step is read, so those motions follow the
  scroll. With reduced motion the position is whole and each step shows its end state.

  Ink outlines are worked out every frame: the silhouette of each rounded part plus its
  sharp creases, so the low-poly head reads as a drawing with only its outline inked. Blue
  marks the part each step is about. The phone floats in the camera's own plane, to the
  right of the head, so its bar reads from every view.

  The app steps the volume up while the head leans past a set angle one way and down while
  it leans the other, and a level head leaves it alone, so the bar here does the same.
*/

type Three = typeof THREE;

/** The three.js line addons, loaded by the caller next to three.js, for edges wider than 1px. */
export type LineModules = {
  LineSegments2: typeof import("three/examples/jsm/lines/LineSegments2.js").LineSegments2;
  LineSegmentsGeometry: typeof import("three/examples/jsm/lines/LineSegmentsGeometry.js").LineSegmentsGeometry;
  LineMaterial: typeof import("three/examples/jsm/lines/LineMaterial.js").LineMaterial;
};

export type CalloutKey = "frames" | "sensors" | "tap";
export type NoteKey =
  | "bluetooth"
  | "forward"
  | "edgeL"
  | "edgeR"
  | "louder"
  | "quieter"
  | "nod"
  | "focused"
  | "aware"
  | "volume"
  | "paused";
export type PathKey =
  | "wedgeFill"
  | "wedgeEdge"
  | "angles"
  | "link"
  | "axes"
  | "tap"
  | "forward"
  | "facing"
  | "tiltLeft"
  | "tiltRight"
  | "nod";

export type BoseDom = {
  paths: Record<PathKey, SVGPathElement>;
  callouts: Record<CalloutKey, Callout>;
  notes: Record<NoteKey, HTMLElement>;
};

/* ---------- the figure (world units; the head faces +z, so +x is its left) ---------- */

const DEG = Math.PI / 180;
/** Top of the neck, where the head turns, leans and nods. */
const PIVOT_Y = 0.3;
/** Head centre, from the pivot. */
const HEAD_UP = 0.28;
const HEAD_FWD = 0.03;
const HEAD_R = { x: 0.33, y: 0.45, z: 0.39 };
/** Eye level, above the head centre. */
const EYE = 0.05;
const EYE_Y = PIVOT_Y + HEAD_UP + EYE;

const PHONE = { w: 0.42, h: 0.8, d: 0.05, right: 1.02, up: -0.06, turn: -0.28 };
const SEGMENTS = 8;

const WEDGE_R = 1.15;
/** The forward line, along +z at eye level, and the line the head faces along now. */
const FORWARD = { from: 0.56, to: 1.32 };
const FACING_TO = 1.1;
const TILT_R = 1.0;
const NOD_R = 0.86;

const FOV = 24;
type Shot = { yaw: number; pitch: number; fill: number };
const SHOTS: Shot[] = [
  { yaw: 35 * DEG, pitch: 10 * DEG, fill: 0.7 },
  { yaw: 62 * DEG, pitch: 24 * DEG, fill: 0.7 },
  { yaw: 162 * DEG, pitch: 56 * DEG, fill: 0.74 },
  { yaw: 180 * DEG, pitch: 6 * DEG, fill: 0.7 },
  { yaw: 80 * DEG, pitch: 6 * DEG, fill: 0.7 },
];
const LAST = SHOTS.length - 1;
/** The camera holds still across more of each step than the default, to leave room for the motions. */
const HOLD = 0.3;

/* ---------- the story, from scroll position ---------- */

/** Step 2: the head turns out past 40 degrees and back while the step is read. */
const turnDeg = (p: number) => 62 * (ramp(p, 1.62, 1.9) - ramp(p, 2.1, 2.38));
/** Step 3: a lean to the right (positive), over to the left, and level again. */
const rollDeg = (p: number) => 30 * ramp(p, 2.7, 2.86) - 58 * ramp(p, 3.06, 3.2) + 28 * ramp(p, 3.3, 3.44);
/** Step 4: one nod, chin down and back up. */
const nodDeg = (p: number) => 20 * (ramp(p, 3.68, 3.78) - ramp(p, 3.8, 3.92));
/** The bar turns into a pause mark at the bottom of the nod. */
const pauseAt = (p: number) => ramp(p, 3.76, 3.84);
/** Volume in bar segments: up a step at a time while the head leans right, down while it leans left. */
function volumeAt(p: number) {
  let v = 6;
  if (p > 2.86) v += Math.min(2, Math.floor((p - 2.86) / 0.05) + 1);
  if (p > 3.18) v -= Math.min(3, Math.floor((p - 3.18) / 0.045) + 1);
  return v;
}
/** Where the volume drops to while the head is turned away. */
const AWARE_LEVEL = 2;

/* ---------- silhouettes and creases ---------- */

type EdgeData = {
  verts: Float32Array;
  ea: Uint32Array;
  eb: Uint32Array;
  f1: Int32Array;
  f2: Int32Array;
  crease: Uint8Array;
  normals: Float32Array;
  centroids: Float32Array;
  valid: Uint8Array;
  faceCount: number;
  edgeCount: number;
};

/**
 * Welds a mesh's triangles and lists each edge with the faces on either side, so the
 * outline can be worked out for any viewpoint. Normals are turned to face away from the
 * part's centre, which holds for the rounded, convex parts this is used on.
 */
function edgeData(geo: THREE.BufferGeometry, creaseDeg: number): EdgeData {
  const pos = geo.getAttribute("position");
  const index = geo.getIndex();
  const corners = index ? index.count : pos.count;
  const faceCount = Math.floor(corners / 3);
  const weld = new Map<string, number>();
  const list: number[] = [];
  const ids = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = `${Math.round(x * 1e4)}|${Math.round(y * 1e4)}|${Math.round(z * 1e4)}`;
    let id = weld.get(k);
    if (id === undefined) {
      id = list.length / 3;
      weld.set(k, id);
      list.push(x, y, z);
    }
    ids[i] = id;
  }
  const verts = new Float32Array(list);
  const nv = verts.length / 3;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < nv; i++) {
    mx += verts[i * 3];
    my += verts[i * 3 + 1];
    mz += verts[i * 3 + 2];
  }
  mx /= nv;
  my /= nv;
  mz /= nv;

  const normals = new Float32Array(faceCount * 3);
  const centroids = new Float32Array(faceCount * 3);
  const valid = new Uint8Array(faceCount);
  const edges = new Map<string, number>();
  const ea: number[] = [];
  const eb: number[] = [];
  const f1: number[] = [];
  const f2: number[] = [];
  for (let f = 0; f < faceCount; f++) {
    const c = [0, 1, 2].map((k) => ids[index ? index.getX(f * 3 + k) : f * 3 + k]);
    if (c[0] === c[1] || c[1] === c[2] || c[0] === c[2]) continue;
    const [a, b, d] = c.map((v) => [verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]]);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) continue;
    nx /= len;
    ny /= len;
    nz /= len;
    const cx = (a[0] + b[0] + d[0]) / 3;
    const cy = (a[1] + b[1] + d[1]) / 3;
    const cz = (a[2] + b[2] + d[2]) / 3;
    if (nx * (cx - mx) + ny * (cy - my) + nz * (cz - mz) < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    normals.set([nx, ny, nz], f * 3);
    centroids.set([cx, cy, cz], f * 3);
    valid[f] = 1;
    for (let k = 0; k < 3; k++) {
      const p = c[k];
      const q = c[(k + 1) % 3];
      const key = p < q ? `${p}_${q}` : `${q}_${p}`;
      const e = edges.get(key);
      if (e === undefined) {
        edges.set(key, ea.length);
        ea.push(p);
        eb.push(q);
        f1.push(f);
        f2.push(-1);
      } else if (f2[e] < 0) f2[e] = f;
    }
  }
  const cos = Math.cos(creaseDeg * DEG);
  const crease = new Uint8Array(ea.length);
  for (let e = 0; e < ea.length; e++) {
    if (f2[e] < 0) continue;
    const i = f1[e] * 3;
    const j = f2[e] * 3;
    const dot = normals[i] * normals[j] + normals[i + 1] * normals[j + 1] + normals[i + 2] * normals[j + 2];
    if (dot < cos) crease[e] = 1;
  }
  return {
    verts,
    ea: new Uint32Array(ea),
    eb: new Uint32Array(eb),
    f1: new Int32Array(f1),
    f2: new Int32Array(f2),
    crease,
    normals,
    centroids,
    valid,
    faceCount,
    edgeCount: ea.length,
  };
}

/* ---------- the scene ---------- */

export function createBoseBreakdown(T: Three, ctx: SceneContext, dom: BoseDom, fat: LineModules): BreakdownScene {
  const { canvas, host, position, reducedMotion, invalidate } = ctx;
  const palette = readPalette(host);
  const renderer = createRenderer(T, canvas);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(FOV, 1, 0.1, 100);
  const lights = paperLights(T, scene);
  lights.hemi.intensity = 2.1;
  lights.key.intensity = 1.15;

  const ink = new T.Color(palette.ink);
  const accent = new T.Color(palette.agent);
  const white = new T.Color("#ffffff");
  const SKIN = new T.Color("#e7e9ec");
  const CLOTH = new T.Color("#e0e3e7");
  const FRAME = new T.Color("#868d96");
  const LENS = new T.Color("#adb3bb");
  const CASE = new T.Color("#d3d7dc");
  const SEG_OFF = new T.Color("#e3e6ea");
  const SEG_ON = new T.Color("#3c4148");
  const frameLit = white.clone().lerp(accent, 0.45);
  const lensLit = white.clone().lerp(accent, 0.28);

  // ---- Lines in CSS pixels ------------------------------------------------------------
  const lineMats: LineMaterial[] = [];
  const lineMat = (color: THREE.Color, width: number, opacity = 0.9) => {
    const m = new fat.LineMaterial({ color: color.getHex(), linewidth: width, transparent: true, opacity, depthWrite: false });
    m.toneMapped = false;
    lineMats.push(m);
    return m;
  };
  const edgeGeos: LineSegmentsGeometry[] = [];
  /** Static outlines: the hard edges of a part with flat faces. */
  const creases = (mesh: THREE.Mesh, mat: LineMaterial, threshold = 30) => {
    const eg = new T.EdgesGeometry(mesh.geometry, threshold);
    const g = new fat.LineSegmentsGeometry().fromEdgesGeometry(eg);
    eg.dispose();
    edgeGeos.push(g);
    const l = new fat.LineSegments2(g, mat);
    l.raycast = () => {};
    mesh.add(l);
    return l;
  };

  type Outline = {
    mesh: THREE.Mesh;
    data: EdgeData;
    geo: LineSegmentsGeometry;
    buf: Float32Array;
    attr: THREE.InterleavedBuffer;
    facing: Uint8Array;
  };
  const outlines: Outline[] = [];
  /** Live outlines for a rounded part: its silhouette from the camera plus creases sharper than creaseDeg. */
  const silhouette = (mesh: THREE.Mesh, mat: LineMaterial, creaseDeg = 50) => {
    const data = edgeData(mesh.geometry, creaseDeg);
    const buf = new Float32Array(Math.max(1, data.edgeCount) * 6);
    const geo = new fat.LineSegmentsGeometry();
    geo.setPositions(buf);
    edgeGeos.push(geo);
    const attr = (geo.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data;
    const l = new fat.LineSegments2(geo, mat);
    l.frustumCulled = false;
    l.raycast = () => {};
    mesh.add(l);
    outlines.push({ mesh, data, geo, buf, attr, facing: new Uint8Array(data.faceCount) });
  };

  const fillMat = (color: THREE.Color) =>
    new T.MeshLambertMaterial({ color, flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const screenMat = (color: THREE.Color) =>
    new T.MeshBasicMaterial({ color, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

  const bodyLine = lineMat(ink, 1.5, 0.9);
  const detailLine = lineMat(ink, 1.15, 0.85);
  const frameLine = lineMat(ink, 1.3, 0.9);
  const phoneLine = lineMat(ink, 1.2, 0.9);

  // ---- Shoulders, neck and head -----------------------------------------------------------
  const figure = new T.Group();
  scene.add(figure);

  const profile = [
    [0, -0.58],
    [0.74, -0.58],
    [0.76, -0.4],
    [0.7, -0.22],
    [0.55, -0.1],
    [0.32, -0.02],
    [0.16, 0.03],
    [0, 0.03],
  ].map(([r, y]) => new T.Vector2(r, y));
  const torsoGeo = new T.LatheGeometry(profile, 12);
  torsoGeo.scale(1, 1, 0.5);
  const torso = new T.Mesh(torsoGeo, fillMat(CLOTH));
  silhouette(torso, bodyLine, 50);
  figure.add(torso);

  const neckGeo = new T.CylinderGeometry(0.14, 0.16, 0.42, 9, 1, true);
  const neck = new T.Mesh(neckGeo, fillMat(SKIN));
  neck.position.y = 0.1;
  silhouette(neck, bodyLine, 60);
  figure.add(neck);

  // The head turns, leans and nods about the top of the neck.
  const headPivot = new T.Group();
  headPivot.position.y = PIVOT_Y;
  figure.add(headPivot);
  const headFrame = new T.Group();
  headFrame.position.set(0, HEAD_UP, HEAD_FWD);
  headPivot.add(headFrame);

  const headGeo = new T.IcosahedronGeometry(1, 3);
  {
    const hp = headGeo.getAttribute("position");
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i);
      const y = hp.getY(i);
      const z = hp.getZ(i);
      // A sphere squared off toward the face, so the forehead and cheeks are flat enough for
      // the glasses to sit on. The jaw narrows toward the chin; the back of the skull is fuller.
      const n = 2 + 0.85 * Math.max(0, z) * (1 - 0.5 * Math.max(0, -y));
      const k = Math.pow(Math.abs(x) ** n + Math.abs(y) ** n + Math.abs(z) ** n, -1 / n);
      let X = x * k * HEAD_R.x;
      const Y = y * k * HEAD_R.y;
      let Z = z * k * HEAD_R.z;
      if (y < 0) {
        X *= 1 - 0.22 * y * y;
        Z *= 1 - (z < 0 ? 0.12 : 0.03) * y * y;
      }
      if (z < 0 && y > -0.2) Z *= 1.05;
      hp.setXYZ(i, X, Y, Z);
    }
    headGeo.computeVertexNormals();
    headGeo.computeBoundingBox();
  }
  const head = new T.Mesh(headGeo, fillMat(SKIN));
  silhouette(head, bodyLine, 60);
  headFrame.add(head);

  // Measure the head's surface, so the nose, ears and glasses sit on it.
  const probe = new T.Mesh(headGeo, new T.MeshBasicMaterial({ side: T.DoubleSide }));
  probe.updateMatrixWorld(true);
  const ray = new T.Raycaster();
  const rayO = new T.Vector3();
  const rayD = new T.Vector3();
  /** How far forward the face comes at (x, y). */
  const faceZ = (x: number, y: number) => {
    ray.set(rayO.set(x, y, 2), rayD.set(0, 0, -1));
    return ray.intersectObject(probe, false)[0]?.point.z ?? 0;
  };
  /** How far out the side of the head comes at (y, z), or null in front of it. */
  const sideX = (y: number, z: number) => {
    ray.set(rayO.set(2, y, z), rayD.set(-1, 0, 0));
    const hit = ray.intersectObject(probe, false)[0];
    return hit ? Math.abs(hit.point.x) : null;
  };

  const earGeo = new T.IcosahedronGeometry(1, 1);
  earGeo.scale(0.035, 0.085, 0.06);
  const earX = (sideX(-0.02, -0.03) ?? HEAD_R.x) - 0.006;
  for (const s of [-1, 1]) {
    const ear = new T.Mesh(earGeo, fillMat(SKIN));
    ear.position.set(s * earX, -0.02, -0.03);
    silhouette(ear, detailLine, 70);
    headFrame.add(ear);
  }

  // A plain wedge for a nose, so the way the head faces reads from any side.
  const noseGeo = new T.BufferGeometry();
  {
    const at = (x: number, y: number, out: number) => [x, y, faceZ(x, y) + out];
    const top = at(0, EYE - 0.03, -0.02);
    const l = at(-0.064, -0.15, -0.02);
    const r = at(0.064, -0.15, -0.02);
    const tip = at(0, -0.13, 0.115);
    const tris = [top, l, tip, top, tip, r, l, r, tip, top, r, l];
    noseGeo.setAttribute("position", new T.Float32BufferAttribute(tris.flat(), 3));
    noseGeo.computeVertexNormals();
  }
  const nose = new T.Mesh(noseGeo, fillMat(SKIN));
  creases(nose, detailLine, 15);
  headFrame.add(nose);

  // ---- The glasses -------------------------------------------------------------------------
  const glasses = new T.Group();
  headFrame.add(glasses);
  const frameMats: THREE.MeshLambertMaterial[] = [];
  const frameMat = () => {
    const m = fillMat(FRAME);
    frameMats.push(m);
    return m;
  };
  const roundRect = (w: number, h: number, r: number) => {
    const s = new T.Shape();
    const x = -w / 2;
    const y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  };
  // Squared-off fronts with a heavy rim, like the Frames.
  const RIM = { w: 0.2, h: 0.135, r: 0.05, border: 0.022, depth: 0.024, cx: 0.123, wrap: 0.16 };
  const rimShape = roundRect(RIM.w, RIM.h, RIM.r);
  rimShape.holes.push(roundRect(RIM.w - 2 * RIM.border, RIM.h - 2 * RIM.border, RIM.r - RIM.border));
  const rimGeo = new T.ExtrudeGeometry(rimShape, { depth: RIM.depth, bevelEnabled: false, curveSegments: 4 });
  const lensGeo = new T.ShapeGeometry(roundRect(RIM.w - 2 * RIM.border + 0.004, RIM.h - 2 * RIM.border + 0.004, RIM.r - RIM.border), 4);
  const lensMats: THREE.MeshLambertMaterial[] = [];
  // Set the front back as far as it goes without touching the face anywhere behind it.
  const sinW = Math.sin(RIM.wrap);
  const cosW = Math.cos(RIM.wrap);
  let rimZ = -Infinity;
  for (const lx of [-0.5, -0.25, 0, 0.25, 0.5])
    for (const ly of [-0.5, 0, 0.5]) {
      const x = RIM.cx + lx * RIM.w * cosW;
      rimZ = Math.max(rimZ, faceZ(x, EYE + ly * RIM.h) + 0.012 + lx * RIM.w * sinW);
    }
  const box = (w: number, h: number, d: number, at: THREE.Vector3, yaw = 0) => {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), frameMat());
    m.position.copy(at);
    m.rotation.y = yaw;
    creases(m, frameLine);
    glasses.add(m);
    return m;
  };
  for (const s of [-1, 1]) {
    const rim = new T.Group();
    rim.position.set(s * RIM.cx, EYE, rimZ);
    rim.rotation.y = s * RIM.wrap;
    const r = new T.Mesh(rimGeo, frameMat());
    creases(r, frameLine, 35);
    rim.add(r);
    const lm = fillMat(LENS);
    lensMats.push(lm);
    const lens = new T.Mesh(lensGeo, lm);
    lens.position.z = RIM.depth * 0.45;
    rim.add(lens);
    glasses.add(rim);
  }
  // The bridge, between the inner top corners.
  const innerZ = rimZ + (RIM.w / 2) * sinW + RIM.depth * 0.5;
  const innerX = RIM.cx - (RIM.w / 2) * cosW;
  box(innerX * 2 + 0.02, 0.026, RIM.depth * 0.8, new T.Vector3(0, EYE + RIM.h / 2 - 0.02, innerZ));
  // Hinges at the outer top corners, and arms from there back over the ears, clear of the head.
  const outerX = RIM.cx + (RIM.w / 2) * cosW;
  const outerZ = rimZ - (RIM.w / 2) * sinW;
  const ARM = { w: 0.03, h: 0.05 };
  const armY = EYE + RIM.h / 2 - 0.03;
  const hinge = new T.Vector3(outerX + 0.004, armY, outerZ - 0.005);
  const end = new T.Vector3((sideX(armY, -0.07) ?? HEAD_R.x) + ARM.w / 2 + 0.01, armY - 0.01, -0.07);
  let push = 0;
  for (let t = 0; t <= 1; t += 0.1) {
    const z = lerp(hinge.z, end.z, t);
    const side = sideX(armY, z);
    if (side !== null) push = Math.max(push, side + ARM.w / 2 + 0.006 - lerp(hinge.x, end.x, t));
  }
  hinge.x += push;
  end.x += push;
  const armDir = new T.Vector3().subVectors(end, hinge);
  const armYaw = Math.atan2(armDir.x, armDir.z);
  for (const s of [-1, 1]) {
    const a = hinge.clone().setX(s * hinge.x);
    const b = end.clone().setX(s * end.x);
    // A short block from the rim's corner out to the hinge.
    const blockW = hinge.x - outerX + 0.03;
    box(blockW, ARM.h, 0.04, new T.Vector3(s * (outerX + blockW / 2 - 0.02), armY, outerZ - 0.005));
    box(ARM.w, ARM.h, a.distanceTo(b), a.clone().add(b).multiplyScalar(0.5), s * armYaw);
  }
  (probe.material as THREE.Material).dispose();

  // Points the overlays hang from, carried by the head.
  const sensorAt = new T.Vector3().lerpVectors(hinge, end, 0.38).add(new T.Vector3(ARM.w / 2 + 0.012, 0, 0));
  const sensor = new T.Object3D();
  sensor.position.copy(sensorAt);
  headFrame.add(sensor);
  const sensorAxes = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)].map((d) => {
    const o = new T.Object3D();
    o.position.copy(sensorAt).addScaledVector(d, 0.19);
    headFrame.add(o);
    return o;
  });
  // The sensors label points further back along the arm, clear of the axes.
  const armAnchor = new T.Object3D();
  armAnchor.position.lerpVectors(hinge, end, 0.74).add(new T.Vector3(ARM.w / 2, ARM.h / 2, 0));
  headFrame.add(armAnchor);
  const rimAnchor = new T.Object3D();
  rimAnchor.position.set(-(RIM.cx + RIM.w * 0.38 * cosW), EYE - RIM.h * 0.3, rimZ - RIM.w * 0.38 * sinW + RIM.depth);
  headFrame.add(rimAnchor);
  const faceFrom = new T.Object3D();
  faceFrom.position.set(0, EYE, 0.5);
  headFrame.add(faceFrom);
  const faceTo = new T.Object3D();
  faceTo.position.set(0, EYE, FACING_TO);
  headFrame.add(faceTo);

  // ---- The phone ---------------------------------------------------------------------------
  const phone = new T.Group();
  scene.add(phone);
  const caseGeo = new T.ExtrudeGeometry(roundRect(PHONE.w, PHONE.h, 0.06), { depth: PHONE.d, bevelEnabled: false, curveSegments: 3 });
  caseGeo.translate(0, 0, -PHONE.d / 2);
  const phoneCase = new T.Mesh(caseGeo, fillMat(CASE));
  creases(phoneCase, phoneLine, 40);
  phone.add(phoneCase);
  const screenGeo = new T.ShapeGeometry(roundRect(0.35, 0.7, 0.035), 3);
  const screen = new T.Mesh(screenGeo, screenMat(white));
  screen.position.z = PHONE.d / 2 + 0.001;
  creases(screen, detailLine, 1);
  phone.add(screen);
  const segGeo = new T.PlaneGeometry(0.13, 0.05);
  const segs = Array.from({ length: SEGMENTS }, (_, i) => {
    const m = new T.Mesh(segGeo, screenMat(SEG_OFF));
    m.position.set(0, -0.235 + i * 0.066, PHONE.d / 2 + 0.002);
    phone.add(m);
    return m;
  });
  const pauseGeo = new T.PlaneGeometry(0.058, 0.27);
  const pauseMat = screenMat(accent);
  const pauseBars = [-1, 1].map((s) => {
    const m = new T.Mesh(pauseGeo, pauseMat);
    m.position.set(s * 0.05, -0.005, PHONE.d / 2 + 0.003);
    phone.add(m);
    return m;
  });
  const phoneBottom = new T.Object3D();
  phoneBottom.position.set(0, -PHONE.h / 2, 0);
  phone.add(phoneBottom);
  const phonePort = new T.Object3D();
  phonePort.position.set(-0.12, 0.3, PHONE.d / 2);
  phone.add(phonePort);
  const qTurn = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), PHONE.turn);

  figure.updateMatrixWorld(true);

  // ---- Fixed points in the world --------------------------------------------------------------
  const headCentre = new T.Vector3(0, PIVOT_Y + HEAD_UP, HEAD_FWD);
  const pivotPt = new T.Vector3(0, PIVOT_Y, 0);
  const wedgeO = new T.Vector3(0, EYE_Y, 0);
  const arc = (n: number, f: (t: number) => THREE.Vector3) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));
  const wedgePts = arc(17, (t) => {
    const a = lerp(-40, 40, t) * DEG;
    return new T.Vector3(Math.sin(a) * WEDGE_R, EYE_Y, Math.cos(a) * WEDGE_R);
  });
  // The two 40 degree angles, each marked by an arc from forward to its edge, labelled inside it.
  const angleArcs = [-1, 1].map((s) =>
    arc(10, (t) => {
      const a = s * lerp(0, 40, t) * DEG;
      return new T.Vector3(Math.sin(a) * WEDGE_R * 0.7, EYE_Y, Math.cos(a) * WEDGE_R * 0.7);
    }),
  );
  const edgeLabel = [-1, 1].map((s) => new T.Vector3(Math.sin(s * 21 * DEG) * WEDGE_R * 0.85, EYE_Y, Math.cos(s * 21 * DEG) * WEDGE_R * 0.85));
  const fwdFrom = new T.Vector3(0, EYE_Y, FORWARD.from);
  const fwdTo = new T.Vector3(0, EYE_Y, FORWARD.to);
  // The head's right is -x, which is the screen's right when seen from behind.
  const tiltArc = (s: number) =>
    arc(12, (t) => {
      const a = lerp(14, 42, t) * DEG;
      return new T.Vector3(s * Math.sin(a) * TILT_R, PIVOT_Y + Math.cos(a) * TILT_R, 0);
    });
  const tiltRightPts = tiltArc(-1);
  const tiltLeftPts = tiltArc(1);
  const nodPts = arc(14, (t) => {
    const a = lerp(42, 4, t) * DEG;
    return new T.Vector3(0, PIVOT_Y + Math.sin(a) * NOD_R, Math.cos(a) * NOD_R);
  });

  // Points the camera keeps in frame: the figure at rest, plus what each step draws.
  const bodyPts: THREE.Vector3[] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    for (const [r, y] of [
      [0.76, -0.6],
      [0.77, -0.4],
      [0.57, -0.1],
    ])
      bodyPts.push(new T.Vector3(Math.cos(a) * r, y, Math.sin(a) * r * 0.52));
  }
  const ico = new T.IcosahedronGeometry(1, 0);
  {
    const ip = ico.getAttribute("position");
    for (let i = 0; i < ip.count; i++)
      bodyPts.push(new T.Vector3(ip.getX(i) * HEAD_R.x, ip.getY(i) * HEAD_R.y, ip.getZ(i) * HEAD_R.z).add(headCentre));
    for (const d of [
      [0, 1, 0],
      [0, -1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ])
      bodyPts.push(new T.Vector3(d[0] * HEAD_R.x, d[1] * HEAD_R.y, d[2] * HEAD_R.z).add(headCentre));
  }
  ico.dispose();
  // Room past the end of the forward line for its label, and the facing line turned out.
  const fwdRoom = new T.Vector3(0, EYE_Y, FORWARD.to + 0.3);
  const turnedTips = [-1, 1].map((s) =>
    new T.Vector3(Math.sin(s * 62 * DEG) * FACING_TO, EYE_Y, HEAD_FWD + Math.cos(s * 62 * DEG) * FACING_TO),
  );
  const extras: THREE.Vector3[][] = [
    [],
    [fwdTo, fwdRoom],
    [...wedgePts, fwdRoom, ...turnedTips],
    [...tiltLeftPts, ...tiltRightPts],
    [...nodPts],
  ];

  // ---- Camera --------------------------------------------------------------------------------
  let width = 1;
  let height = 1;
  const tan = Math.tan((FOV * DEG) / 2);
  const v = new T.Vector3();
  const right = new T.Vector3();
  const up = new T.Vector3();
  function placeCamera(target: THREE.Vector3, dist: number, yaw: number, pitch: number) {
    camera.position.set(
      target.x + dist * Math.sin(yaw) * Math.cos(pitch),
      target.y + dist * Math.sin(pitch),
      target.z + dist * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(target);
    camera.near = Math.max(0.05, dist * 0.2);
    camera.far = dist * 4;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
  /** The phone floats to the right of the head in the camera's own plane, so it always reads. */
  function phoneAt(out: THREE.Vector3) {
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    return out.copy(headCentre).addScaledVector(right, PHONE.right).addScaledVector(up, PHONE.up);
  }

  type Framing = { target: THREE.Vector3; dist: number };
  let framings: Framing[] = [];
  const corner = new T.Vector3();
  function fit() {
    const aspect = width / height;
    framings = SHOTS.map((shot, step) => {
      const pts = [...bodyPts, ...extras[step]];
      const target = new T.Vector3();
      for (const q of pts) target.add(q);
      target.divideScalar(pts.length);
      let dist = 8;
      for (let k = 0; k < 5; k++) {
        placeCamera(target, dist, shot.yaw, shot.pitch);
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        const add = (q: THREE.Vector3) => {
          v.copy(q).project(camera);
          x0 = Math.min(x0, v.x);
          x1 = Math.max(x1, v.x);
          y0 = Math.min(y0, v.y);
          y1 = Math.max(y1, v.y);
        };
        for (const q of pts) add(q);
        const pc = phoneAt(new T.Vector3());
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ])
          add(corner.copy(pc).addScaledVector(right, (sx * PHONE.w) / 2).addScaledVector(up, (sy * PHONE.h) / 2));
        // Recentre, then scale the distance so the box fills its share of the stage.
        const halfH = dist * tan;
        target.addScaledVector(right, ((x0 + x1) / 2) * halfH * aspect);
        target.addScaledVector(up, ((y0 + y1) / 2) * halfH);
        dist *= Math.max((y1 - y0) / 2 / shot.fill, (x1 - x0) / 2 / 0.86);
      }
      return { target, dist };
    });
  }

  const cam = { x: 0, y: 0, z: 0, d: 1, yaw: 0, pitch: 0, set: false };
  function aim(p: number, dt: number, sway: number) {
    if (!framings.length) fit();
    const gx = track(framings.map((f) => f.target.x), p, HOLD);
    const gy = track(framings.map((f) => f.target.y), p, HOLD);
    const gz = track(framings.map((f) => f.target.z), p, HOLD);
    const gd = Math.exp(track(framings.map((f) => Math.log(f.dist)), p, HOLD));
    const gyaw = track(SHOTS.map((s) => s.yaw), p, HOLD);
    const gpitch = track(SHOTS.map((s) => s.pitch), p, HOLD);
    const e = !cam.set || reducedMotion || dt === 0 ? 1 : 1 - Math.exp(-dt * 6);
    cam.x = lerp(cam.x, gx, e);
    cam.y = lerp(cam.y, gy, e);
    cam.z = lerp(cam.z, gz, e);
    cam.d = Math.exp(lerp(Math.log(cam.d), Math.log(gd), e));
    cam.yaw = lerp(cam.yaw, gyaw, e);
    cam.pitch = lerp(cam.pitch, gpitch, e);
    cam.set = true;
    placeCamera(v.set(cam.x, cam.y, cam.z), cam.d, cam.yaw + yawOff + sway, cam.pitch);
  }

  // ---- Drag to turn, with a little inertia ---------------------------------------------------
  let yawOff = 0;
  let vel = 0;
  let dragging: { id: number; x: number; t: number } | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = { id: e.pointerId, x: e.clientX, t: e.timeStamp };
    vel = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.dataset.dragging = "";
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const dx = (e.clientX - dragging.x) * -0.008;
    const dt = Math.max((e.timeStamp - dragging.t) / 1000, 1 / 240);
    yawOff = Math.max(-1.4, Math.min(1.4, yawOff + dx));
    vel = vel * 0.5 + (dx / dt) * 0.5;
    dragging.x = e.clientX;
    dragging.t = e.timeStamp;
    invalidate();
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    if ((e.timeStamp - dragging.t) / 1000 > 0.1 || reducedMotion) vel = 0;
    vel = Math.max(-3, Math.min(3, vel));
    dragging = null;
    delete canvas.dataset.dragging;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  // ---- Layout --------------------------------------------------------------------------------
  const callouts = Object.values(dom.callouts);
  const noteSizes = new Map<HTMLElement, { w: number; h: number }>();
  function resize() {
    const size = sizeRenderer(renderer, camera);
    if (!size) return;
    width = size.width;
    height = size.height;
    for (const m of lineMats) m.resolution.set(width, height);
    remeasureCallouts(callouts);
    noteSizes.clear();
    fit();
  }

  // ---- State from scroll position ------------------------------------------------------------
  const euler = new T.Euler(0, 0, 0, "YXZ");
  const segColor = new T.Color();
  let level = 6;
  let aware = 0;
  function apply(p: number, time: number) {
    const turn = turnDeg(p);
    const roll = rollDeg(p);
    const nod = nodDeg(p);
    const idle = reducedMotion ? 0 : 1;
    euler.set(
      (nod + idle * 0.8 * Math.sin(time * 0.43 + 1)) * DEG,
      (turn + idle * 1.4 * Math.sin(time * 0.37)) * DEG,
      roll * DEG,
    );
    headPivot.quaternion.setFromEuler(euler);

    // Step 0 is about the glasses.
    const lit = near(p, 0, 0.3, 0.6);
    for (const m of frameMats) m.color.copy(FRAME).lerp(frameLit, lit);
    for (const m of lensMats) m.color.copy(LENS).lerp(lensLit, lit);
    frameLine.color.copy(ink).lerp(accent, lit);
    frameLine.linewidth = 1.3 + 0.7 * lit;

    // The bar: blue from the turn on, a pause mark after the nod.
    aware = ramp(Math.abs(turn), 39.5, 40.5);
    level = aware > 0.5 ? AWARE_LEVEL : volumeAt(p);
    const hot = ramp(p, 1.3, 1.7);
    const pause = pauseAt(p);
    segColor.copy(SEG_ON).lerp(accent, hot);
    // A clean swap at the bottom of the nod: the bar goes and the pause mark takes its place.
    const paused = pause >= 0.5;
    segs.forEach((s, i) => {
      (s.material as THREE.MeshBasicMaterial).color.copy(i < level ? segColor : SEG_OFF);
      s.visible = !paused;
    });
    for (const m of pauseBars) m.visible = paused;
  }

  // ---- Outlines --------------------------------------------------------------------------------
  const inv = new T.Matrix4();
  const camLocal = new T.Vector3();
  function updateOutlines() {
    for (const o of outlines) {
      const { verts, ea, eb, f1, f2, crease, normals: N, centroids: C, valid, faceCount, edgeCount } = o.data;
      inv.copy(o.mesh.matrixWorld).invert();
      camLocal.copy(camera.position).applyMatrix4(inv);
      for (let f = 0; f < faceCount; f++) {
        const i = f * 3;
        o.facing[f] =
          valid[f] && N[i] * (camLocal.x - C[i]) + N[i + 1] * (camLocal.y - C[i + 1]) + N[i + 2] * (camLocal.z - C[i + 2]) > 0 ? 1 : 0;
      }
      let k = 0;
      for (let e = 0; e < edgeCount; e++) {
        const a = o.facing[f1[e]];
        const open = f2[e] < 0;
        const b = open ? 0 : o.facing[f2[e]];
        const draw = open ? a === 1 : a !== b || (crease[e] === 1 && (a === 1 || b === 1));
        if (!draw) continue;
        const va = ea[e] * 3;
        const vb = eb[e] * 3;
        o.buf[k++] = verts[va];
        o.buf[k++] = verts[va + 1];
        o.buf[k++] = verts[va + 2];
        o.buf[k++] = verts[vb];
        o.buf[k++] = verts[vb + 1];
        o.buf[k++] = verts[vb + 2];
      }
      o.geo.instanceCount = k / 6;
      o.attr.needsUpdate = true;
    }
  }

  // ---- Overlays --------------------------------------------------------------------------------
  const project = createProjector(T);
  const screenBox = createScreenBox(T);
  const sp = (): ScreenPoint => ({ x: 0, y: 0, behind: false });
  const P = {
    sensor: sp(),
    port: sp(),
    rim: sp(),
    bottom: sp(),
    fwdFrom: sp(),
    fwdTo: sp(),
    faceFrom: sp(),
    faceTo: sp(),
    wedgeO: sp(),
    pivot: sp(),
    tmp: sp(),
  };
  const axisPts = sensorAxes.map(sp);
  const wedgeScr = wedgePts.map(sp);
  const tiltRScr = tiltRightPts.map(sp);
  const tiltLScr = tiltLeftPts.map(sp);
  const nodScr = nodPts.map(sp);
  const edgeScr = edgeLabel.map(sp);
  const angleScr = angleArcs.map((a) => a.map(sp));
  const figBox: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  type Spec = { key: CalloutKey; anchor: THREE.Object3D; side: Side; narrowSide?: Side; weight: (p: number) => number };
  const SPECS: Spec[] = [
    // On a phone the model fills the stage's width, so this label goes above it instead.
    { key: "frames", anchor: rimAnchor, side: "left", narrowSide: "top", weight: (p) => near(p, 0) },
    { key: "sensors", anchor: armAnchor, side: "top", weight: (p) => near(p, 0) },
    { key: "tap", anchor: sensor, side: "top", weight: (p) => near(p, 1) },
  ];
  const items: CalloutPlacement[] = SPECS.map((s) => ({ callout: dom.callouts[s.key], x: 0, y: 0, side: s.side, opacity: 0 }));
  const mix = new T.Color();
  const mixCss = (t: number) => `#${mix.copy(ink).lerp(accent, t).getHexString()}`;
  const f1 = (n: number) => n.toFixed(1);
  const setOpacity = (el: Element, o: number) => {
    (el as HTMLElement | SVGElement).style.opacity = o > 0.01 ? o.toFixed(3) : "0";
  };
  const line = (pts: ScreenPoint[]) => pts.map((q, i) => `${i ? "L" : "M"} ${f1(q.x)} ${f1(q.y)}`).join(" ");
  /** An open arrowhead at (x, y), pointing along (dx, dy). */
  const chevron = (x: number, y: number, dx: number, dy: number, s = 7) => {
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l;
    const uy = dy / l;
    return ` M ${f1(x - ux * s - uy * s * 0.6)} ${f1(y - uy * s + ux * s * 0.6)} L ${f1(x)} ${f1(y)} L ${f1(x - ux * s + uy * s * 0.6)} ${f1(y - uy * s - ux * s * 0.6)}`;
  };
  const ring2 = (x: number, y: number, r: number) =>
    ` M ${f1(x - r)} ${f1(y)} a ${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0 a ${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`;

  /** Puts a plain note so (x, y) sits at its left, centre or right middle. */
  function note(el: HTMLElement, x: number, y: number, o: number, align: "left" | "center" | "right" = "left") {
    setOpacity(el, o);
    if (o <= 0.01) return;
    let s = noteSizes.get(el);
    if (!s || !s.w) {
      s = { w: el.offsetWidth, h: el.offsetHeight };
      noteSizes.set(el, s);
    }
    let left = align === "left" ? x : align === "right" ? x - s.w : x - s.w / 2;
    let top = y - s.h / 2;
    left = Math.min(Math.max(left, 4), width - s.w - 4);
    top = Math.min(Math.max(top, 4), height - s.h - 4);
    el.style.transform = `translate3d(${f1(left)}px, ${f1(top)}px, 0)`;
  }
  /** A note just past the end of a line, on its far side. */
  function noteBeyond(el: HTMLElement, a: ScreenPoint, b: ScreenPoint, o: number, gap = 14) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    const x = b.x + (dx / l) * gap;
    const y = b.y + (dy / l) * gap;
    const align = Math.abs(dx / l) < 0.4 ? "center" : dx > 0 ? "left" : "right";
    note(el, x, y + (align === "center" ? (dy > 0 ? 8 : -8) : 0), o, align);
  }
  const wp = new T.Vector3();
  const proj = (o: THREE.Object3D | THREE.Vector3, out: ScreenPoint) => project(o, camera, width, height, out);

  function overlays(p: number, time: number) {
    const w0 = near(p, 0);
    const w1 = near(p, 1);
    const w2 = near(p, 2);
    const w3 = near(p, 3);
    const w4 = near(p, 4);
    const { paths, notes } = dom;
    const narrow = width < 560;

    proj(sensor, P.sensor);
    proj(phonePort, P.port);
    proj(phoneBottom, P.bottom);
    // Is the left arm turned toward the camera?
    sensor.getWorldPosition(wp);
    const toCam = v.copy(camera.position).sub(wp).normalize();
    const out = right.set(1, 0, 0).transformDirection(headFrame.matrixWorld);
    const armShows = ramp(toCam.dot(out), 0.05, 0.3);

    // Step 0: axes on the arm, and the orientation going over Bluetooth to the phone.
    sensorAxes.forEach((o, i) => proj(o, axisPts[i]));
    let axes = "";
    for (const q of axisPts) axes += ` M ${f1(P.sensor.x)} ${f1(P.sensor.y)} L ${f1(q.x)} ${f1(q.y)}` + chevron(q.x, q.y, q.x - P.sensor.x, q.y - P.sensor.y, 6);
    paths.axes.setAttribute("d", axes);
    setOpacity(paths.axes, w0 * armShows);
    const mx = (P.sensor.x + P.port.x) / 2;
    const my = Math.min(P.sensor.y, P.port.y) - Math.max(36, Math.abs(P.port.x - P.sensor.x) * 0.35);
    paths.link.setAttribute("d", `M ${f1(P.sensor.x)} ${f1(P.sensor.y)} Q ${f1(mx)} ${f1(my)} ${f1(P.port.x)} ${f1(P.port.y)}`);
    paths.link.style.strokeDashoffset = reducedMotion ? "0" : f1(-time * 22);
    setOpacity(paths.link, w0);
    // On a phone the labels above the head take this spot, and the step text names Bluetooth.
    note(notes.bluetooth, mx, (my + Math.min(P.sensor.y, P.port.y)) / 2 - 12, narrow ? 0 : w0, "center");

    // Step 1: forward, and the double tap that sets it.
    const pulse = reducedMotion ? 0 : Math.sin(time * 3.2);
    paths.tap.setAttribute("d", ring2(P.sensor.x, P.sensor.y, 8 + pulse) + ring2(P.sensor.x, P.sensor.y, 15 + 1.6 * pulse));
    setOpacity(paths.tap, w1 * armShows);
    proj(fwdFrom, P.fwdFrom);
    proj(fwdTo, P.fwdTo);
    const wf = Math.max(w1, w2);
    const ref = ramp(p, 1.35, 1.75);
    paths.forward.setAttribute(
      "d",
      `M ${f1(P.fwdFrom.x)} ${f1(P.fwdFrom.y)} L ${f1(P.fwdTo.x)} ${f1(P.fwdTo.y)}` +
        chevron(P.fwdTo.x, P.fwdTo.y, P.fwdTo.x - P.fwdFrom.x, P.fwdTo.y - P.fwdFrom.y),
    );
    paths.forward.style.stroke = mixCss(1 - ref);
    paths.forward.style.strokeDasharray = ref > 0.5 ? "5 5" : "none";
    setOpacity(paths.forward, wf);
    noteBeyond(notes.forward, P.fwdFrom, P.fwdTo, wf);

    // Step 2: the 40 degree wedge on either side of forward, and the way the head faces now.
    proj(wedgeO, P.wedgeO);
    wedgePts.forEach((q, i) => proj(q, wedgeScr[i]));
    const rim = line(wedgeScr).slice(1);
    paths.wedgeFill.setAttribute("d", `M ${f1(P.wedgeO.x)} ${f1(P.wedgeO.y)} L${rim} Z`);
    paths.wedgeEdge.setAttribute("d", `M ${f1(P.wedgeO.x)} ${f1(P.wedgeO.y)} L${rim} L ${f1(P.wedgeO.x)} ${f1(P.wedgeO.y)}`);
    setOpacity(paths.wedgeFill, w2);
    setOpacity(paths.wedgeEdge, w2);
    angleArcs.forEach((a, k) => a.forEach((q, i) => proj(q, angleScr[k][i])));
    paths.angles.setAttribute("d", angleScr.map(line).join(" "));
    setOpacity(paths.angles, w2);
    edgeLabel.forEach((q, i) => proj(q, edgeScr[i]));
    note(notes.edgeL, edgeScr[0].x, edgeScr[0].y, w2, "center");
    note(notes.edgeR, edgeScr[1].x, edgeScr[1].y, w2, "center");
    proj(faceFrom, P.faceFrom);
    proj(faceTo, P.faceTo);
    paths.facing.setAttribute(
      "d",
      `M ${f1(P.faceFrom.x)} ${f1(P.faceFrom.y)} L ${f1(P.faceTo.x)} ${f1(P.faceTo.y)}` +
        chevron(P.faceTo.x, P.faceTo.y, P.faceTo.x - P.faceFrom.x, P.faceTo.y - P.faceFrom.y),
    );
    setOpacity(paths.facing, w2);

    // Under the phone: what it shows for the step.
    const nx = P.bottom.x;
    const ny = P.bottom.y + 18;
    note(notes.focused, nx, ny, w2 * (1 - aware), "center");
    note(notes.aware, nx, ny, w2 * aware, "center");
    note(notes.volume, nx, ny, w3, "center");
    note(notes.paused, nx, ny, w4 * pauseAt(p), "center");

    // Step 3: lean right for louder, left for quieter.
    tiltRightPts.forEach((q, i) => proj(q, tiltRScr[i]));
    tiltLeftPts.forEach((q, i) => proj(q, tiltLScr[i]));
    const roll = rollDeg(p);
    const tilted = (pts: ScreenPoint[], k: number, path: SVGPathElement) => {
      const n = pts.length;
      const a = pts[n - 2];
      const b = pts[n - 1];
      path.setAttribute("d", line(pts) + chevron(b.x, b.y, b.x - a.x, b.y - a.y));
      path.style.stroke = mixCss(k);
      setOpacity(path, w3 * (0.55 + 0.45 * k));
    };
    tilted(tiltRScr, ramp(roll, 6, 18), paths.tiltRight);
    tilted(tiltLScr, ramp(-roll, 6, 18), paths.tiltLeft);
    const n3 = tiltRScr.length;
    noteBeyond(notes.louder, tiltRScr[n3 - 2], tiltRScr[n3 - 1], w3, 10);
    noteBeyond(notes.quieter, tiltLScr[n3 - 2], tiltLScr[n3 - 1], w3, 10);

    // Step 4: the nod, down and back up.
    nodPts.forEach((q, i) => proj(q, nodScr[i]));
    const n4 = nodScr.length;
    paths.nod.setAttribute(
      "d",
      line(nodScr) +
        chevron(nodScr[n4 - 1].x, nodScr[n4 - 1].y, nodScr[n4 - 1].x - nodScr[n4 - 2].x, nodScr[n4 - 1].y - nodScr[n4 - 2].y) +
        chevron(nodScr[0].x, nodScr[0].y, nodScr[0].x - nodScr[1].x, nodScr[0].y - nodScr[1].y),
    );
    setOpacity(paths.nod, w4);
    proj(pivotPt, P.pivot);
    const mid = nodScr[Math.floor(n4 / 2)];
    noteBeyond(notes.nod, P.pivot, mid, w4, 16);

    // Labels on parts, outside the figure.
    screenBox(figure, camera, width, height, figBox);
    SPECS.forEach((s, i) => {
      const item = items[i];
      proj(s.anchor, P.tmp);
      item.x = P.tmp.x;
      item.y = P.tmp.y;
      item.side = narrow && s.narrowSide ? s.narrowSide : s.side;
      const shows = s.key === "frames" ? 1 : armShows;
      item.opacity = P.tmp.behind ? 0 : s.weight(p) * shows;
    });
    placeCallouts(items, figBox, { width, height }, narrow ? 12 : 20);
  }

  // ---- Frame ---------------------------------------------------------------------------------
  let time = 0;
  let lastP = -1;
  const phoneQ = new T.Quaternion();
  function frame(dt: number) {
    time += dt;
    const p = Math.min(LAST, Math.max(0, position.current ?? 0));
    // Scrolling eases any drag back to the story's view.
    if (lastP >= 0 && !dragging) {
      const dp = Math.abs(p - lastP);
      if (dp > 0) yawOff *= Math.max(0, 1 - dp * 2.5);
    }
    lastP = p;
    if (!dragging && Math.abs(vel) > 1e-3) {
      yawOff = Math.max(-1.4, Math.min(1.4, yawOff + vel * dt));
      vel *= Math.exp(-dt * 3.2);
    }
    apply(p, time);
    const sway = reducedMotion ? 0 : 0.035 * Math.sin(time * 0.23);
    aim(p, dt, sway);
    phoneAt(phone.position);
    phone.quaternion.copy(phoneQ.copy(camera.quaternion).multiply(qTurn));
    scene.updateMatrixWorld(true);
    updateOutlines();
    renderer.render(scene, camera);
    overlays(p, time);
  }

  resize();
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      remeasureCallouts(callouts);
      noteSizes.clear();
      invalidate();
    });
  }

  return {
    frame,
    resize,
    dispose() {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      for (const g of edgeGeos) g.dispose();
      for (const m of lineMats) m.dispose();
      disposeRenderer(renderer, scene);
    },
  };
}
