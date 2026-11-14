import type * as THREE from "three";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { buildCubeSat, CAMERA, SET, type EdgeLines, type PointName, type Role, type SetIndex } from "./cubesat";
import {
  createProjector,
  createRenderer,
  disposeRenderer,
  isWideStage,
  lerp,
  near,
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
  The CubeSat breakdown. Scroll position (0 to 5, one per step) drives everything:

  0  the task: the whole satellite over Earth, a radio uplink to the antennas
  1  power: the wings fold and open flat, the nine cells turn blue, the array faces the sun
  2  pointing: the units slide apart, drawing look, the wheels and magnetorquers in blue
  3  computer: focus moves to the top unit, charged particles cross it
  4  the photo: back together, slewed so the camera holds on a target
  5  the camera: still on target, focus closes in on the end unit, its skin goes see-through,
     the lens and image sensor in blue, light from the target through the lens onto the sensor

  Blue marks the part each step is about. Overlays (sun, particles, sight line) are SVG over
  the canvas, placed from projected 3D points every frame. Earth's limb is one faint arc low
  on the stage, behind the canvas, the same in every step, so the satellite is always in orbit
  over it; the ground station and the target sit on it.

  The drawing look keeps the parts solid: light grey faces under modelled light, the cells
  their own dark blue, and ink edges a little over a pixel wide, heavier on the subject.
*/

type Three = typeof THREE;

/** The three.js line addons, loaded by the caller next to three.js, for edges wider than 1px. */
export type LineModules = {
  LineSegments2: typeof import("three/examples/jsm/lines/LineSegments2.js").LineSegments2;
  LineSegmentsGeometry: typeof import("three/examples/jsm/lines/LineSegmentsGeometry.js").LineSegmentsGeometry;
  LineMaterial: typeof import("three/examples/jsm/lines/LineMaterial.js").LineMaterial;
};

export type CalloutKey = "antenna" | "camera" | "array" | "wheels" | "torquers" | "computer" | "lens" | "sensor";
export type NoteKey = "station" | "sun" | "angle10" | "particles" | "target" | "angle65";

export type CubeSatDom = {
  earth: SVGPathElement;
  station: SVGPathElement;
  uplink: SVGPathElement;
  sun: SVGGElement;
  rays: SVGPathElement;
  wedge: SVGPathElement;
  tracks: SVGPathElement;
  particles: SVGCircleElement[];
  sight: SVGPathElement;
  cone: SVGPathElement;
  target: SVGGElement;
  light: SVGPathElement;
  callouts: Record<CalloutKey, Callout>;
  notes: Record<NoteKey, HTMLElement>;
};

type V3 = [number, number, number];
/** An attitude: where the long axis (antenna end) and the array normal point on screen. */
type Pose = { L: V3; N: V3; primary: "L" | "N" };
/** Where the model sits on the stage, as fractions: left, top, right, bottom. */
type Frame = [number, number, number, number];

// Screen axes: x right, y up, z toward the viewer.
const POSES_TALL: Pose[] = [
  { L: [-0.14, 0.9, -0.4], N: [-0.82, -0.2, 0.55], primary: "L" },
  { L: [0.15, 1, 0], N: [-0.58, 0.48, 0.66], primary: "N" },
  { L: [0.1, 1, 0.34], N: [-0.9, 0, 0.42], primary: "L" },
  { L: [-0.08, 1, 0.34], N: [0.25, 0, 1], primary: "L" },
  { L: [0.3, 0.92, -0.3], N: [0.62, -0.2, 0.75], primary: "L" },
  // Still pointing down at the target, rolled so a plain side faces the viewer: the rails
  // sit at the edges of the unit, clear of the lens, and the wings turn edge-on.
  { L: [0.22, 0.97, -0.12], N: [1, 0, 0.05], primary: "L" },
];
// Short, wide stages (phones) lay the taken-apart stack on its side.
const POSES_WIDE: Pose[] = [
  POSES_TALL[0],
  POSES_TALL[1],
  { L: [1, 0.12, 0.3], N: [-0.25, 0.75, 0.6], primary: "L" },
  { L: [1, -0.1, 0.32], N: [0.1, 0.35, 1], primary: "L" },
  POSES_TALL[4],
  POSES_TALL[5],
];
// The model fills about 70% of the stage's height, centred on the step text beside it. The
// steps with something on the ground (0, 4, 5) sit higher, to leave room for the line down
// to Earth's limb at LIMB.
const FRAMES_TALL: Frame[] = [
  [0.12, 0.08, 0.88, 0.79],
  [0.24, 0.1, 0.98, 0.84],
  [0.27, 0.0, 0.73, 1.0],
  [0.27, 0.0, 0.73, 1.0],
  [0.2, 0.05, 0.8, 0.66],
  [0.2, 0.05, 0.8, 0.66],
];
const FRAMES_WIDE: Frame[] = [
  [0.12, 0.05, 0.88, 0.74],
  [0.22, 0.1, 0.97, 0.8],
  [0.04, 0.18, 0.96, 0.82],
  [0.04, 0.18, 0.96, 0.82],
  [0.18, 0.04, 0.82, 0.64],
  [0.18, 0.04, 0.82, 0.64],
];
/** The top of Earth's limb, as a fraction of the stage height. */
const LIMB = { tall: 0.885, wide: 0.86 };
/** The last step's position. */
const LAST = POSES_TALL.length - 1;
/** Steps 2 and 3 close in on one unit; this is where that unit sits. */
const FOCUS_TALL: Frame = [0.25, 0.14, 0.75, 0.8];
const FOCUS_WIDE: Frame = [0.2, 0.08, 0.8, 0.82];
/** Step 5 closes in on the camera unit higher up, leaving room for the light below it. */
const CLOSE_UPS: { unit: number; step: number; tall: Frame; wide: Frame }[] = [
  { unit: 1, step: 2, tall: FOCUS_TALL, wide: FOCUS_WIDE },
  { unit: 2, step: 3, tall: FOCUS_TALL, wide: FOCUS_WIDE },
  { unit: 0, step: 5, tall: [0.25, 0.04, 0.75, 0.6], wide: [0.24, 0.03, 0.76, 0.6] },
];

type CalloutSpec = { key: CalloutKey; point: PointName; weight: (p: number) => number; tall: Side; wide: Side };
const CALLOUTS: CalloutSpec[] = [
  { key: "antenna", point: "antenna", weight: (p) => near(p, 0), tall: "right", wide: "right" },
  { key: "camera", point: "lens", weight: (p) => Math.max(near(p, 0), near(p, 4)), tall: "left", wide: "left" },
  { key: "array", point: "array", weight: (p) => near(p, 1, 0.2, 0.45), tall: "right", wide: "bottom" },
  { key: "wheels", point: "wheels", weight: (p) => near(p, 2), tall: "left", wide: "top" },
  { key: "torquers", point: "torquers", weight: (p) => near(p, 2), tall: "right", wide: "bottom" },
  { key: "computer", point: "computer", weight: (p) => near(p, 3), tall: "left", wide: "top" },
  { key: "lens", point: "barrel", weight: (p) => near(p, 5), tall: "left", wide: "left" },
  { key: "sensor", point: "sensor", weight: (p) => near(p, 5), tall: "right", wide: "right" },
];

const ADCS_PARTS: Role[] = ["rotor", "copper", "black", "gold"];
const COMPUTER_PARTS: Role[] = ["pcb", "chip", "gold"];
/** In the payload set, "black" is the lens housing and barrel and "glass" its front element. */
const CAMERA_PARTS: Role[] = ["black", "glass", "sensor"];
const ALL_SETS: SetIndex[] = [SET.payload, SET.adcs, SET.power, SET.wings];

export function createCubeSatBreakdown(T: Three, ctx: SceneContext, dom: CubeSatDom, fat?: LineModules): BreakdownScene {
  const { canvas, host, position, reducedMotion, invalidate } = ctx;
  const palette = readPalette(host);
  const renderer = createRenderer(T, canvas, { toneMapping: "neutral" });

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(24, 1, 0.05, 30);

  // Studio reflections for the real-materials look: a grey room with three soft boxes.
  const pmrem = new T.PMREMGenerator(renderer);
  const room = new T.Scene();
  const roomGeo = new T.BoxGeometry(10, 6, 10);
  const roomMat = new T.MeshBasicMaterial({ color: 0x5c6066, side: T.BackSide });
  room.add(new T.Mesh(roomGeo, roomMat));
  const boxGeo = new T.PlaneGeometry(1, 1);
  const boxMat = new T.MeshBasicMaterial({ color: 0xffffff });
  for (const [x, y, z, w, h] of [
    [0, 2.9, 0, 6, 3],
    [-4.9, 0.8, 1.5, 3, 2.4],
    [4.9, 1.2, -1, 2.4, 3],
  ]) {
    const m = new T.Mesh(boxGeo, boxMat);
    m.position.set(x, y, z);
    m.scale.set(w, h, 1);
    m.lookAt(0, 0, 0);
    room.add(m);
  }
  const envTarget = pmrem.fromScene(room, 0.04);
  scene.environment = envTarget.texture;
  roomGeo.dispose();
  roomMat.dispose();
  boxGeo.dispose();
  boxMat.dispose();

  const hemi = new T.HemisphereLight(0xffffff, 0xd6dae2, 1.0);
  const key = new T.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.5, 2.6, 2.2);
  const rim = new T.DirectionalLight(0xffffff, 0.9);
  rim.position.set(-2, 1.2, -1.8);
  scene.add(hemi, key, rim);

  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  // Edges in CSS pixels: plain WebGL lines are one device pixel, a hairline on a retina screen.
  const lineMats: LineMaterial[] = [];
  const lines: EdgeLines | undefined = fat && {
    material() {
      const m = new fat.LineMaterial({ color: palette.ink, linewidth: 1, transparent: true, opacity: 0, depthWrite: false });
      m.toneMapped = false;
      lineMats.push(m);
      return m;
    },
    object(edges, material) {
      return new fat.LineSegments2(new fat.LineSegmentsGeometry().fromEdgesGeometry(edges), material as LineMaterial);
    },
  };
  const sat = buildCubeSat(T, { interior: true, edges: true, lines, ink: palette.ink, accent: palette.agent, ground: palette.bg, anisotropy });
  // pivot (drag) > sway > story attitude > satellite
  const pivot = new T.Group();
  const sway = new T.Group();
  const attitude = new T.Group();
  attitude.add(sat.root);
  sway.add(attitude);
  pivot.add(sway);
  scene.add(pivot);

  // ---- Poses ---------------------------------------------------------------------------
  const m4 = new T.Matrix4();
  const toQuat = (pose: Pose) => {
    const l = new T.Vector3(...pose.L).normalize();
    const n = new T.Vector3(...pose.N).normalize();
    if (pose.primary === "L") n.addScaledVector(l, -n.dot(l)).normalize();
    else l.addScaledVector(n, -l.dot(n)).normalize();
    const x = new T.Vector3().crossVectors(l, n);
    return new T.Quaternion().setFromRotationMatrix(m4.makeBasis(x, l, n));
  };
  const quatsTall = POSES_TALL.map(toQuat);
  const quatsWide = POSES_WIDE.map(toQuat);

  // ---- Drag to turn, with a little inertia -------------------------------------------
  const qTmp = new T.Quaternion();
  const qIdentity = new T.Quaternion();
  const axisX = new T.Vector3(1, 0, 0);
  const axisY = new T.Vector3(0, 1, 0);
  let velX = 0;
  let velY = 0;
  let dragging: { id: number; x: number; y: number; t: number } | null = null;
  const SENS = 0.0085;
  const turn = (dx: number, dy: number) => {
    pivot.quaternion.premultiply(qTmp.setFromAxisAngle(axisY, dx));
    pivot.quaternion.premultiply(qTmp.setFromAxisAngle(axisX, dy));
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    velX = 0;
    velY = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.dataset.dragging = "";
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const dx = (e.clientX - dragging.x) * SENS;
    // Touch scrolls the page vertically (touch-action: pan-y), so only a mouse or pen tilts.
    const dy = e.pointerType === "touch" ? 0 : (e.clientY - dragging.y) * SENS;
    const dt = Math.max((e.timeStamp - dragging.t) / 1000, 1 / 240);
    turn(dx, dy);
    velX = velX * 0.5 + (dx / dt) * 0.5;
    velY = velY * 0.5 + (dy / dt) * 0.5;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    dragging.t = e.timeStamp;
    invalidate();
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    if ((e.timeStamp - dragging.t) / 1000 > 0.1 || reducedMotion) {
      velX = 0;
      velY = 0;
    }
    velX = Math.max(-6, Math.min(6, velX));
    velY = Math.max(-6, Math.min(6, velY));
    dragging = null;
    delete canvas.dataset.dragging;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  // ---- Layout --------------------------------------------------------------------------
  let width = 1;
  let height = 1;
  let wide = false;
  const callouts = Object.values(dom.callouts);
  function resize() {
    const size = sizeRenderer(renderer, camera);
    if (!size) return;
    width = size.width;
    height = size.height;
    wide = isWideStage(width, height);
    for (const m of lineMats) m.resolution.set(width, height);
    remeasureCallouts(callouts);
    noteSizes.clear();
  }

  // ---- State from scroll position -----------------------------------------------------
  function apply(p: number) {
    // Into the drawing look while the satellite turns to the sun, back for the photo, and
    // into it again for the camera.
    const schematic = p < 1 ? ramp(p, 0.12, 0.45) : track([1, 1, 1, 0, 1], p - 1);
    const explode = track([0, 0, 1, 1, 0, 0], p);
    // The wings fold in against the sides and open out flat again on the way to step 1.
    const deploy = p < 1.5 ? 1 - ramp(p, 0.28, 0.5) + ramp(p, 0.58, 0.92) : 1;
    sat.setSchematic(schematic);
    sat.setExplode(explode);
    sat.setDeploy(deploy);
    // At step 5 only the camera unit's skin goes see-through; the other units stay closed.
    const skins = track([0, 0, 1, 1, 0, 0], p);
    sat.setGhost(SET.payload, track([0, 0, 1, 1, 0, 1], p));
    sat.setGhost(SET.adcs, skins);
    sat.setGhost(SET.power, skins);
    sat.setGhost(SET.wings, track([0, 0, 1, 1, 0, 1], p));
    sat.setFocus(SET.payload, track([1, 0.4, 0.3, 0.3, 1, 1], p));
    sat.setFocus(SET.adcs, track([1, 0.4, 1, 0.3, 1, 0.3], p));
    sat.setFocus(SET.power, track([1, 0.4, 0.3, 1, 1, 0.3], p));
    sat.setFocus(SET.wings, track([1, 1, 0.6, 0.6, 1, 0.6], p));
    const cells = ramp(p, 0.7, 0.95) * (1 - ramp(p, 1.2, 1.6));
    for (const s of ALL_SETS) sat.setTint(s, ["cell"], cells);
    sat.setTint(SET.adcs, ADCS_PARTS, near(p, 2, 0.25, 0.6));
    sat.setTint(SET.power, COMPUTER_PARTS, near(p, 3, 0.25, 0.6));
    sat.setTint(SET.payload, CAMERA_PARTS, near(p, 5, 0.25, 0.6));
    // Softer, brighter light for the drawing, still directional so each face reads as a
    // plane; modelled light for the real thing.
    hemi.intensity = 1.0 + 0.9 * schematic;
    key.intensity = 2.2 - 0.6 * schematic;
    rim.intensity = 0.9 - 0.45 * schematic;
    return explode;
  }

  function poseAt(p: number, out: THREE.Quaternion) {
    const quats = wide ? quatsWide : quatsTall;
    const n = quats.length;
    if (p <= 0) return out.copy(quats[0]);
    if (p >= n - 1) return out.copy(quats[n - 1]);
    const i = Math.floor(p);
    return out.slerpQuaternions(quats[i], quats[i + 1], ramp(p - i, 0.15, 0.85));
  }

  function frameAt(p: number): Frame {
    const frames = wide ? FRAMES_WIDE : FRAMES_TALL;
    return [0, 1, 2, 3].map((k) => track(frames.map((f) => f[k]), p)) as Frame;
  }

  // ---- Fit the camera to what is visible ------------------------------------------------
  // Corners of each visible mesh's own box, in world space. Faded parts don't count.
  type Corners = { pts: THREE.Vector3[]; n: number };
  const whole: Corners = { pts: [], n: 0 };
  const part: Corners = { pts: [], n: 0 };
  const v = new T.Vector3();
  function gather(into: Corners, obj: THREE.Object3D, skipAntennas = false) {
    into.n = 0;
    obj.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.edge) return;
      if (skipAntennas && m.userData.role === "tape") return;
      const mat = m.material as THREE.Material;
      if (mat.transparent && mat.opacity < 0.5) return;
      const bb = m.geometry.boundingBox!;
      for (let k = 0; k < 8; k++) {
        if (into.n >= into.pts.length) into.pts.push(new T.Vector3());
        into.pts[into.n++]
          .set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z)
          .applyMatrix4(m.matrixWorld);
      }
    });
  }

  type Fit = { x: number; y: number; z: number; d: number; rx: number; ry: number };
  /** Camera centre and distance that fit the corners inside frame f of the stage. */
  function solve(c: Corners, f: Frame, out: Fit): Fit {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < c.n; i++) {
      const q = c.pts[i];
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
      z0 = Math.min(z0, q.z);
      z1 = Math.max(z1, q.z);
    }
    out.x = (x0 + x1) / 2;
    out.y = (y0 + y1) / 2;
    out.z = (z0 + z1) / 2;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = (tan * (f[2] - f[0]) * width) / height;
    const tanV = tan * (f[3] - f[1]);
    let d = 0.1;
    for (let i = 0; i < c.n; i++) {
      const q = c.pts[i];
      const dz = q.z - out.z;
      d = Math.max(d, dz + Math.abs(q.x - out.x) / tanH, dz + Math.abs(q.y - out.y) / tanV);
    }
    out.d = d;
    out.rx = ((f[0] + f[2]) / 2) * width;
    out.ry = ((f[1] + f[3]) / 2) * height;
    return out;
  }

  const units = ["payload", "adcs", "power"].map((n) => sat.root.getObjectByName(n)!);
  const fitWhole: Fit = { x: 0, y: 0, z: 0, d: 1, rx: 0, ry: 0 };
  const fitPart: Fit = { x: 0, y: 0, z: 0, d: 1, rx: 0, ry: 0 };
  const goal: Fit = { x: 0, y: 0, z: 0, d: 1, rx: 0, ry: 0 };
  const cam: Fit & { set: boolean } = { x: 0, y: 0, z: 0, d: 1, rx: 0, ry: 0, set: false };
  const keys = ["x", "y", "z", "d", "rx", "ry"] as const;

  /** The unit the camera has closed in on, if any, for placing labels around it. */
  let closeUp = -1;
  function fit(p: number, dt: number) {
    closeUp = -1;
    gather(whole, sat.root);
    if (!whole.n) return;
    solve(whole, frameAt(p), fitWhole);
    for (const k of keys) goal[k] = fitWhole[k];
    // Close in on the ADCS at step 2, the computer at step 3 and the camera at step 5.
    for (const { unit, step, tall, wide: frameWide } of CLOSE_UPS) {
      const w = near(p, step, 0.25, 0.6);
      if (w <= 0) continue;
      gather(part, units[unit], true);
      if (!part.n) continue;
      solve(part, wide ? frameWide : tall, fitPart);
      for (const k of keys) goal[k] += (fitPart[k] - fitWhole[k]) * w;
      if (w > 0.5) closeUp = unit;
    }
    // Ease toward the fit while animating; snap on the first frame and on still redraws.
    const e = !cam.set || reducedMotion || dt === 0 ? 1 : 1 - Math.exp(-dt * 7);
    for (const k of keys) cam[k] = lerp(cam[k], goal[k], e);
    cam.set = true;
    camera.position.set(cam.x, cam.y, cam.z + cam.d);
    camera.quaternion.identity();
    camera.setViewOffset(width, height, width / 2 - cam.rx, height / 2 - cam.ry, width, height);
    camera.updateMatrixWorld(true);
  }

  const box: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  function screenBox() {
    let c = whole;
    if (closeUp >= 0) {
      gather(part, units[closeUp], true);
      if (part.n) c = part;
    }
    box.left = Infinity;
    box.top = Infinity;
    box.right = -Infinity;
    box.bottom = -Infinity;
    for (let i = 0; i < c.n; i++) {
      v.copy(c.pts[i]).project(camera);
      const x = ((v.x + 1) / 2) * width;
      const y = ((1 - v.y) / 2) * height;
      box.left = Math.min(box.left, x);
      box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y);
      box.bottom = Math.max(box.bottom, y);
    }
  }

  // ---- Overlays ---------------------------------------------------------------------------
  const project = createProjector(T);
  const pts = {} as Record<PointName, ScreenPoint>;
  for (const k of Object.keys(sat.points) as PointName[]) pts[k] = { x: 0, y: 0, behind: false };
  const tipPts: ScreenPoint[] = sat.antennaTips.map(() => ({ x: 0, y: 0, behind: false }));
  // Scratch for the step 5 light path and label anchors.
  const wLens = new T.Vector3();
  const wAxis = new T.Vector3();
  const wSide = new T.Vector3();
  const wTmp = new T.Vector3();
  const edgePt: ScreenPoint = { x: 0, y: 0, behind: false };
  const sideA: ScreenPoint = { x: 0, y: 0, behind: false };
  const sideB: ScreenPoint = { x: 0, y: 0, behind: false };
  const lensAnchor: ScreenPoint = { x: 0, y: 0, behind: false };
  const sensorAnchor: ScreenPoint = { x: 0, y: 0, behind: false };
  const placements: CalloutPlacement[] = CALLOUTS.map((c) => ({
    callout: dom.callouts[c.key],
    x: 0,
    y: 0,
    side: c.tall,
    opacity: 0,
  }));
  const noteSizes = new Map<HTMLElement, { w: number; h: number }>();
  /** The stage width and limb height the limb was last drawn for. */
  let limbW = 0;
  let limbTop = 0;
  const f1 = (n: number) => n.toFixed(1);
  const setOpacity = (el: Element, o: number) => {
    (el as HTMLElement | SVGElement).style.opacity = o > 0.01 ? o.toFixed(3) : "0";
  };

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

  /** First hit of a ray with a circle, or null. */
  function hitCircle(ox: number, oy: number, ux: number, uy: number, cx: number, cy: number, r: number) {
    const fx = ox - cx;
    const fy = oy - cy;
    const b = fx * ux + fy * uy;
    const c = fx * fx + fy * fy - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t <= 0) return null;
    return { x: ox + ux * t, y: oy + uy * t, t };
  }

  function overlays(p: number, time: number) {
    for (const k of Object.keys(sat.points) as PointName[]) project(sat.points[k], camera, width, height, pts[k]);
    sat.antennaTips.forEach((t, i) => project(t, camera, width, height, tipPts[i]));
    const W = width;
    const H = height;

    // Earth's limb: one wide arc low on the stage, the same in every step. It sits behind the
    // canvas, so the satellite passes in front of it.
    const R = Math.max(W, H) * 2.4;
    const yTop = H * (wide ? LIMB.wide : LIMB.tall);
    const ex = W / 2;
    const ey = yTop + R;
    const yAt = (x: number) => ey - Math.sqrt(R * R - (x - ex) * (x - ex));
    const rise = 0;
    if (W !== limbW || yTop !== limbTop) {
      limbW = W;
      limbTop = yTop;
      dom.earth.setAttribute("d", `M -2 ${f1(yAt(-2))} A ${f1(R)} ${f1(R)} 0 0 1 ${f1(W + 2)} ${f1(yAt(W + 2))} L ${f1(W + 2)} ${f1(H + 2)} L -2 ${f1(H + 2)} Z`);
    }

    // Step 0: a ground station radios the coordinates up to the antennas.
    const w0 = near(p, 0, 0.25, 0.5);
    const sx = W * (wide ? 0.14 : 0.13);
    const sy = yAt(sx) + rise;
    dom.station.setAttribute("d", `M ${f1(sx - 6)} ${f1(sy + 1)} L ${f1(sx)} ${f1(sy - 9)} L ${f1(sx + 6)} ${f1(sy + 1)} Z`);
    setOpacity(dom.station, w0);
    // To the antenna tip nearest the station, so the line stays clear of the body.
    let a = tipPts[0];
    for (const t of tipPts) if (Math.hypot(t.x - sx, t.y - sy) < Math.hypot(a.x - sx, a.y - sy)) a = t;
    dom.uplink.setAttribute("d", `M ${f1(sx)} ${f1(sy - 12)} L ${f1(a.x)} ${f1(a.y)}`);
    dom.uplink.style.strokeDashoffset = reducedMotion ? "0" : f1(-time * 22);
    setOpacity(dom.uplink, w0);
    note(dom.notes.station, sx, sy + 20, w0, "center");

    // Step 1: the sun, and the 10 degree cone from the array that it has to sit inside.
    const w1 = near(p, 1, 0.2, 0.45);
    let dx = pts.arrayNormal.x - pts.array.x;
    let dy = pts.arrayNormal.y - pts.array.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const ax0 = pts.array.x;
    const ay0 = pts.array.y;
    const reach = Math.min(W, H) * (wide ? 0.4 : 0.44);
    const tan10 = Math.tan((10 * Math.PI) / 180);
    const rad = reach * tan10;
    const sunX = Math.min(Math.max(ax0 + dx * reach, rad + 8), W - rad - 8);
    const sunY = Math.min(Math.max(ay0 + dy * reach, rad + 8), H - rad - 8);
    dom.sun.setAttribute("transform", `translate(${f1(sunX)} ${f1(sunY)})`);
    setOpacity(dom.sun, w1);
    // Recompute the axis from the clamped sun so the cone always meets its circle.
    let sx1 = sunX - ax0;
    let sy1 = sunY - ay0;
    const sd = Math.hypot(sx1, sy1) || 1;
    sx1 /= sd;
    sy1 /= sd;
    const r1 = sd * tan10;
    const half = Math.asin(Math.min(1, r1 / sd));
    const edgeAt = (s: number) => {
      const c = Math.cos(s * half);
      const n = Math.sin(s * half);
      const len = sd * Math.cos(half);
      return { x: ax0 + (sx1 * c - sy1 * n) * len, y: ay0 + (sx1 * n + sy1 * c) * len };
    };
    const ea = edgeAt(-1);
    const eb = edgeAt(1);
    dom.rays.setAttribute("d", `M ${f1(ea.x)} ${f1(ea.y)} L ${f1(ax0)} ${f1(ay0)} L ${f1(eb.x)} ${f1(eb.y)}`);
    setOpacity(dom.rays, w1);
    dom.wedge.setAttribute(
      "d",
      `M ${f1(sunX - r1)} ${f1(sunY)} A ${f1(r1)} ${f1(r1)} 0 1 0 ${f1(sunX + r1)} ${f1(sunY)} A ${f1(r1)} ${f1(r1)} 0 1 0 ${f1(sunX - r1)} ${f1(sunY)}`,
    );
    setOpacity(dom.wedge, w1);
    note(dom.notes.sun, sunX, sunY - r1 - 14, w1, "center");
    // "10°" just outside the cone, on its outer side, halfway along.
    const outer = sy1 * -1 > 0 ? eb : ea;
    const px = -sy1;
    const py = sx1;
    const flip = (outer.x - ax0) * px + (outer.y - ay0) * py > 0 ? 1 : -1;
    const mx = ax0 + (outer.x - ax0) * 0.55 + px * flip * 14;
    const my = ay0 + (outer.y - ay0) * 0.55 + py * flip * 14;
    note(dom.notes.angle10, mx, my, w1, px * flip > 0 ? "left" : "right");

    // Step 3: charged particles cross the computer.
    const w3 = near(p, 3);
    const c = pts.computer;
    const ux = -0.5;
    const uy = 0.866;
    const vx = 0.866;
    const vy = 0.5;
    const span = Math.hypot(W, H);
    let tracks = "";
    let entry = { x: 0, y: 0 };
    [-1, 0, 1].forEach((k, i) => {
      const ox = c.x + vx * k * 16;
      const oy = c.y + vy * k * 16;
      tracks += `M ${f1(ox - ux * span)} ${f1(oy - uy * span)} L ${f1(ox + ux * span)} ${f1(oy + uy * span)} `;
      const dot = dom.particles[i];
      // Each particle runs from the top edge to the bottom edge, staggered.
      const t0 = (oy - 0) / uy;
      const t1 = (H - oy) / uy;
      const len = t0 + t1;
      const phase = reducedMotion ? 0.42 : ((time * 260) / len + i * 0.37) % 1;
      const along = -t0 + phase * len;
      dot.setAttribute("cx", f1(ox + ux * along));
      dot.setAttribute("cy", f1(oy + uy * along));
      setOpacity(dot, w3);
      if (k === 1) entry = { x: ox - ux * t0, y: 0 };
    });
    dom.tracks.setAttribute("d", tracks);
    setOpacity(dom.tracks, w3 * 0.55);
    note(dom.notes.particles, entry.x + 12, 22, w3, "left");

    // Step 4: the camera's line of sight to the target, inside a 6.5 degree cone. The sight
    // line and target stay for step 5.
    const w4 = near(p, 4, 0.18, 0.42);
    const wSight = p >= 4 ? 1 : w4;
    const L = pts.lens;
    let ux4 = pts.lensAhead.x - L.x;
    let uy4 = pts.lensAhead.y - L.y;
    const ul = Math.hypot(ux4, uy4) || 1;
    ux4 /= ul;
    uy4 /= ul;
    const hit = hitCircle(L.x, L.y, ux4, uy4, ex, ey - rise, R);
    if (hit && wSight > 0.01) {
      const tx = hit.x;
      const ty = hit.y;
      dom.sight.setAttribute("d", `M ${f1(L.x)} ${f1(L.y)} L ${f1(tx)} ${f1(ty)}`);
      const a65 = (6.5 * Math.PI) / 180;
      const edge = (s: number) => {
        const rx = ux4 * Math.cos(s * a65) - uy4 * Math.sin(s * a65);
        const ry = ux4 * Math.sin(s * a65) + uy4 * Math.cos(s * a65);
        return hitCircle(L.x, L.y, rx, ry, ex, ey - rise, R) ?? { x: L.x + rx * hit.t, y: L.y + ry * hit.t, t: hit.t };
      };
      const e1 = edge(-1);
      const e2 = edge(1);
      dom.cone.setAttribute("d", `M ${f1(e1.x)} ${f1(e1.y)} L ${f1(L.x)} ${f1(L.y)} L ${f1(e2.x)} ${f1(e2.y)}`);
      dom.target.setAttribute("transform", `translate(${f1(tx)} ${f1(ty)})`);
      const right = e2.x > e1.x ? e2 : e1;
      note(dom.notes.angle65, right.x * 0.55 + L.x * 0.45 + 10, right.y * 0.55 + L.y * 0.45, w4, "left");
      note(dom.notes.target, tx + 16, ty + 16, wSight, "left");
    } else {
      setOpacity(dom.notes.angle65, 0);
      setOpacity(dom.notes.target, 0);
    }
    setOpacity(dom.sight, hit ? wSight : 0);
    setOpacity(dom.cone, hit ? w4 * 0.7 : 0);
    setOpacity(dom.target, hit ? wSight : 0);

    // Step 5: light from the target comes up the sight line to both edges of the lens and
    // meets on the sensor. The lens and sensor labels anchor on the sides of their parts.
    const w5 = near(p, 5, 0.18, 0.42);
    sat.points.lens.getWorldPosition(wLens);
    sat.points.lensAhead.getWorldPosition(wAxis).sub(wLens).normalize();
    wSide.subVectors(camera.position, wLens).cross(wAxis).normalize();
    const S = pts.sensor;
    let light = "";
    for (const s of [-1, 1]) {
      const e = project(wTmp.copy(wLens).addScaledVector(wSide, s * CAMERA.aperture), camera, W, H, edgePt);
      const fx = hit ? hit.x : e.x + ux4 * H * 0.3;
      const fy = hit ? hit.y : e.y + uy4 * H * 0.3;
      light += `M ${f1(fx)} ${f1(fy)} L ${f1(e.x)} ${f1(e.y)} L ${f1(S.x)} ${f1(S.y)} `;
    }
    dom.light.setAttribute("d", light);
    dom.light.style.strokeDashoffset = reducedMotion ? "0" : f1(-time * 22);
    setOpacity(dom.light, w5);
    const sideAnchor = (spec: CalloutSpec, half: number, out: ScreenPoint) => {
      sat.points[spec.point].getWorldPosition(wTmp);
      project(wTmp.addScaledVector(wSide, half), camera, W, H, sideA);
      project(wTmp.addScaledVector(wSide, -2 * half), camera, W, H, sideB);
      const side = wide ? spec.wide : spec.tall;
      const a = side === "left" || side === "right" ? sideA.x - sideB.x : sideA.y - sideB.y;
      const pick = (side === "left" || side === "top") === a < 0 ? sideA : sideB;
      out.x = pick.x;
      out.y = pick.y;
      out.behind = pick.behind;
      return out;
    };

    // Labels on parts.
    CALLOUTS.forEach((spec, i) => {
      const pl = placements[i];
      const pt =
        spec.key === "lens"
          ? sideAnchor(spec, CAMERA.barrel * 0.8, lensAnchor)
          : spec.key === "sensor"
            ? sideAnchor(spec, CAMERA.sensorHalf * 0.6, sensorAnchor)
            : pts[spec.point];
      pl.x = pt.x;
      pl.y = pt.y;
      pl.side = wide ? spec.wide : spec.tall;
      pl.opacity = pt.behind ? 0 : spec.weight(p);
    });
    placeCallouts(placements, box, { width: W, height: H }, wide ? 12 : 22);
  }

  // ---- Frame ------------------------------------------------------------------------------
  const qPose = new T.Quaternion();
  const eSway = new T.Euler();
  let time = 0;
  let lastP = -1;

  function frame(dt: number) {
    time += dt;
    const p = Math.min(LAST, Math.max(0, position.current ?? 0));

    // Scrolling eases any drag back to the story's view.
    if (lastP >= 0 && !dragging) {
      const dp = Math.abs(p - lastP);
      if (dp > 0) pivot.quaternion.slerp(qIdentity, Math.min(1, dp * 2.5));
    }
    lastP = p;
    if (!dragging && Math.abs(velX) + Math.abs(velY) > 1e-3) {
      turn(velX * dt, velY * dt);
      const k = Math.exp(-dt * 3.2);
      velX *= k;
      velY *= k;
    }

    const explode = apply(p);
    if (!reducedMotion) {
      sat.spin(dt * (0.25 + 0.75 * explode));
      eSway.set(0.022 * Math.sin(time * 0.45), 0.035 * Math.sin(time * 0.31 + 1), 0);
      sway.quaternion.setFromEuler(eSway);
    }
    attitude.quaternion.copy(poseAt(p, qPose));
    scene.updateMatrixWorld(true);

    fit(p, dt);
    renderer.render(scene, camera);
    screenBox();
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
      sat.dispose();
      envTarget.dispose();
      pmrem.dispose();
      disposeRenderer(renderer);
    },
  };
}
