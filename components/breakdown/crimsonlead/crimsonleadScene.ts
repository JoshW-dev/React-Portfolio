import type * as THREE from "three";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
  createProjector,
  createRenderer,
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
import { US_HOLES, US_OUTLINE } from "./usOutline";

/*
  The Crimsonlead breakdown: one morning's records on a low-poly plate of the United
  States, followed to a single message. Scroll position (0 to 4, one per step) drives it:

  0  this morning's records: a pin pops up for each new record
  1  the filter: most pins tip over and go grey, with the reason beside a few of them
  2  grades: the pins left standing rise to three heights, A tallest
  3  a match: one A pin is joined by a red thread to a buyer across the map
  4  a person sends it: a message card lifts off the thread and stops by a person

  Crimson, the product's own colour, marks what each step is about. Labels are HTML over
  the canvas, placed outside the model from projected points every frame.
*/

type Three = typeof THREE;

/** The three.js line addons, loaded by the caller next to three.js, for edges wider than 1px. */
export type LineModules = {
  LineSegments2: typeof import("three/examples/jsm/lines/LineSegments2.js").LineSegments2;
  LineSegmentsGeometry: typeof import("three/examples/jsm/lines/LineSegmentsGeometry.js").LineSegmentsGeometry;
  LineMaterial: typeof import("three/examples/jsm/lines/LineMaterial.js").LineMaterial;
};

export type CalloutKey =
  | "mining"
  | "raise"
  | "trucking"
  | "permit"
  | "hvac"
  | "gov"
  | "individual"
  | "agent"
  | "contact"
  | "gradeA"
  | "gradeB"
  | "gradeC"
  | "record"
  | "buyer"
  | "draft"
  | "sender";

export type CrimsonDom = { callouts: Record<CalloutKey, Callout> };

/* ---------- the map (world units: 100 map pixels to one unit) ---------- */

const K = 0.01;
const CX = (79 + 952) / 2;
const CY = (25 + 568) / 2;
const PLATE_T = 0.13;

type Grade = "A" | "B" | "C";
type PinSpec = { at: [number, number]; grade: Grade | null };

/** One pin per new record, in the map's 960 by 600 frame. A null grade is turned away. */
const PINS: PinSpec[] = [
  { at: [250, 382], grade: "A" }, // 0 the trucking authority that gets matched
  { at: [812, 290], grade: "A" }, // 1 federal HVAC bid
  { at: [735, 248], grade: "A" },
  { at: [198, 252], grade: "B" }, // 3 mining claim
  { at: [636, 252], grade: "B" }, // 4
  { at: [530, 478], grade: "B" }, // 5 building permit
  { at: [842, 176], grade: "C" }, // 6 fundraising notice
  { at: [152, 150], grade: "C" }, // 7
  { at: [548, 140], grade: "C" },
  { at: [160, 340], grade: "C" },
  { at: [182, 72], grade: null },
  { at: [330, 108], grade: null },
  { at: [462, 112], grade: null },
  { at: [452, 176], grade: null },
  { at: [350, 198], grade: null },
  { at: [250, 165], grade: null },
  { at: [276, 262], grade: null }, // 16 government body
  { at: [372, 285], grade: null },
  { at: [352, 382], grade: null },
  { at: [500, 360], grade: null }, // 19 registered agent
  { at: [488, 300], grade: null },
  { at: [466, 236], grade: null },
  { at: [566, 222], grade: null },
  { at: [585, 300], grade: null }, // 23 private individual
  { at: [586, 378], grade: null },
  { at: [600, 452], grade: null },
  { at: [612, 170], grade: null },
  { at: [690, 178], grade: null },
  { at: [785, 388], grade: null },
  { at: [702, 312], grade: null },
  { at: [686, 414], grade: null },
  { at: [812, 338], grade: null }, // 31 no usable contact
  { at: [806, 222], grade: null },
  { at: [895, 172], grade: null },
  { at: [785, 495], grade: null },
  { at: [118, 260], grade: null },
];
const MATCHED = 0;
const BUYER_AT: [number, number] = [680, 350];
const PERSON_AT: [number, number] = [748, 372];

const BASE_H = 0.42;
const GRADE_H: Record<Grade, number> = { A: 1.5, B: 0.95, C: 0.55 };
/** How much of the accent each grade keeps once graded. */
const GRADE_TINT: Record<Grade, number> = { A: 1, B: 0, C: 0 };
const HEAD_R = 0.085;
const HEAD_STRETCH = 1.35;

/** Camera per step: which part to frame, how much of the stage height it fills, pitch. */
type Shot = { frame: "map" | "send"; fill: number; pitch: number };
const SHOTS: Shot[] = [
  { frame: "map", fill: 0.7, pitch: 1.0 },
  { frame: "map", fill: 0.7, pitch: 1.0 },
  { frame: "map", fill: 0.7, pitch: 0.82 },
  { frame: "map", fill: 0.7, pitch: 0.88 },
  { frame: "send", fill: 0.7, pitch: 0.7 },
];
/** Seen from the south-southeast, so the map runs a little away to the upper left. */
const YAW = 0.5;
const FOV = 24;

export function createCrimsonleadBreakdown(T: Three, ctx: SceneContext, dom: CrimsonDom, fat: LineModules): BreakdownScene {
  const { canvas, host, position, reducedMotion, invalidate } = ctx;
  const palette = readPalette(host);
  const renderer = createRenderer(T, canvas);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(FOV, 1, 0.1, 400);
  const lights = paperLights(T, scene);
  // Dimmer than the kit's daylight, so the plate's top reads as light grey on the white page.
  lights.hemi.intensity = 1.85;
  lights.key.intensity = 1.2;

  const ink = new T.Color(palette.ink);
  const accent = new T.Color(palette.agent);
  const white = new T.Color("#ffffff");
  const fills = palette.fills.map((h) => new T.Color(h));
  /** A pale wash of the accent for large faces, and a stronger one for the small pin heads. */
  const washPale = white.clone().lerp(accent, 0.18);
  const washHead = white.clone().lerp(accent, 0.6);

  const at = (mx: number, my: number, y = 0) => new T.Vector3((mx - CX) * K, y, (my - CY) * K);

  // ---- Lines in CSS pixels ---------------------------------------------------------
  const lineMats: LineMaterial[] = [];
  const lineMat = (color: THREE.Color, width: number, opacity = 0.9) => {
    const m = new fat.LineMaterial({ color: color.getHex(), linewidth: width, transparent: true, opacity, depthWrite: false });
    m.toneMapped = false;
    lineMats.push(m);
    return m;
  };
  const edgeGeos = new Map<THREE.BufferGeometry, LineSegmentsGeometry>();
  const edgesOf = (geo: THREE.BufferGeometry, threshold = 25) => {
    let e = edgeGeos.get(geo);
    if (!e) {
      const eg = new T.EdgesGeometry(geo, threshold);
      e = new fat.LineSegmentsGeometry().fromEdgesGeometry(eg);
      eg.dispose();
      edgeGeos.set(geo, e);
    }
    return e;
  };
  const outline = (mesh: THREE.Mesh, mat: LineMaterial, threshold?: number) => {
    const l = new fat.LineSegments2(edgesOf(mesh.geometry, threshold), mat);
    l.raycast = () => {};
    mesh.add(l);
    return l;
  };
  const fillMat = (color: THREE.Color) =>
    new T.MeshLambertMaterial({
      color,
      flatShading: true,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

  const world = new T.Group();
  scene.add(world);

  // ---- The plate -------------------------------------------------------------------
  const shape = new T.Shape();
  for (let i = 0; i < US_OUTLINE.length; i += 2) {
    const x = (US_OUTLINE[i] - CX) * K;
    const y = (US_OUTLINE[i + 1] - CY) * K;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (const h of US_HOLES) {
    const path = new T.Path();
    for (let i = 0; i < h.length; i += 2) {
      const x = (h[i] - CX) * K;
      const y = (h[i + 1] - CY) * K;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    shape.holes.push(path);
  }
  const plateGeo = new T.ExtrudeGeometry(shape, { depth: PLATE_T, bevelEnabled: false });
  // Shape x/y become world x/z, and the plate hangs down from y = 0.
  plateGeo.rotateX(Math.PI / 2);
  const plateMat = fillMat(fills[1]);
  plateMat.transparent = false;
  const plate = new T.Mesh(plateGeo, plateMat);
  outline(plate, lineMat(ink, 1.15, 0.9), 30);
  world.add(plate);
  const ringPts: THREE.Vector3[] = [];
  for (let i = 0; i < US_OUTLINE.length; i += 2) ringPts.push(at(US_OUTLINE[i], US_OUTLINE[i + 1]));

  // ---- Pins ------------------------------------------------------------------------
  const headGeo = new T.OctahedronGeometry(HEAD_R, 0);
  headGeo.scale(1, HEAD_STRETCH, 1);
  const stemGeo = new fat.LineSegmentsGeometry().setPositions([0, 0, 0, 0, 1, 0]);
  const dotGeo = new T.CircleGeometry(0.04, 6);
  dotGeo.rotateX(-Math.PI / 2);

  type Pin = {
    spec: PinSpec;
    base: THREE.Vector3;
    group: THREE.Group;
    tilt: THREE.Group;
    stem: THREE.Object3D;
    head: THREE.Mesh;
    headMat: THREE.MeshLambertMaterial;
    edgeMat: LineMaterial;
    stemMat: LineMaterial;
    dotMat: THREE.MeshBasicMaterial;
    /** Where the label leader points: the top of the head. */
    tip: THREE.Object3D;
    axis: THREE.Vector3;
    i: number;
  };
  const pins: Pin[] = PINS.map((spec, i) => {
    const base = at(spec.at[0], spec.at[1]);
    const group = new T.Group();
    group.position.copy(base);
    const tilt = new T.Group();
    group.add(tilt);
    const stemMat = lineMat(ink, 1.25, 0.9);
    const stem = new fat.LineSegments2(stemGeo, stemMat);
    tilt.add(stem);
    const headMat = fillMat(fills[0]);
    const head = new T.Mesh(headGeo, headMat);
    const edgeMat = lineMat(ink, 1, 0.9);
    outline(head, edgeMat, 10);
    tilt.add(head);
    const tip = new T.Object3D();
    tip.position.y = HEAD_R * HEAD_STRETCH;
    head.add(tip);
    const dotMat = new T.MeshBasicMaterial({ color: ink, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });
    const dot = new T.Mesh(dotGeo, dotMat);
    dot.position.y = 0.003;
    group.add(dot);
    world.add(group);
    // Pins that are turned away fall over inland, each at an angle of its own, so none
    // hangs off the coast.
    const inland = Math.atan2(-base.z, -base.x) + Math.sin(i * 2.39996) * 0.7;
    const axis = new T.Vector3(Math.sin(inland), 0, -Math.cos(inland));
    return { spec, base, group, tilt, stem, head, headMat, edgeMat, stemMat, dotMat, tip, axis, i };
  });

  // ---- The buyer, the person and the message ---------------------------------------
  type Part = { group: THREE.Group; mats: { mat: THREE.MeshLambertMaterial; base: THREE.Color }[]; edge: LineMaterial };
  const part = (edgeWidth = 1.1): Part => ({ group: new T.Group(), mats: [], edge: lineMat(ink, edgeWidth, 0.9) });
  const box = (p: Part, w: number, h: number, d: number, shade: THREE.Color, pos: [number, number, number]) => {
    const geo = new T.BoxGeometry(w, h, d);
    const mat = fillMat(shade);
    const m = new T.Mesh(geo, mat);
    m.position.set(...pos);
    outline(m, p.edge);
    p.group.add(m);
    p.mats.push({ mat, base: shade.clone() });
    return m;
  };
  /** Tint toward the accent, fade toward the page, and grow from nothing. */
  const style = (p: Part, tint: number, show: number, wash = washPale) => {
    for (const { mat, base } of p.mats) {
      mat.color.copy(base).lerp(wash, tint);
      mat.opacity = show;
    }
    p.edge.color.copy(ink).lerp(accent, tint);
    p.edge.opacity = 0.9 * show;
    p.group.visible = show > 0.01;
  };

  const buyer = part();
  box(buyer, 0.5, 0.56, 0.38, fills[0], [0, 0.28, 0]);
  box(buyer, 0.56, 0.06, 0.44, fills[2], [0, 0.59, 0]);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) box(buyer, 0.09, 0.08, 0.012, fills[2], [-0.14 + c * 0.14, 0.43 - r * 0.15, 0.196]);
  box(buyer, 0.12, 0.17, 0.012, fills[2], [0, 0.085, 0.196]);
  buyer.group.position.copy(at(...BUYER_AT));
  buyer.group.rotation.y = 0.2;
  world.add(buyer.group);
  const buyerTop = new T.Object3D();
  buyerTop.position.set(0, 0.62, 0);
  buyer.group.add(buyerTop);

  const person = part();
  {
    const bodyGeo = new T.CylinderGeometry(0.075, 0.13, 0.38, 6);
    const bodyMat = fillMat(fills[1]);
    const body = new T.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.19;
    outline(body, person.edge);
    person.group.add(body);
    person.mats.push({ mat: bodyMat, base: fills[1].clone() });
    const headGeo2 = new T.IcosahedronGeometry(0.085, 0);
    const hMat = fillMat(fills[0]);
    const h = new T.Mesh(headGeo2, hMat);
    h.position.y = 0.5;
    outline(h, person.edge);
    person.group.add(h);
    person.mats.push({ mat: hMat, base: fills[0].clone() });
  }
  person.group.position.copy(at(...PERSON_AT));
  world.add(person.group);
  const personTop = new T.Object3D();
  personTop.position.set(0, 0.59, 0);
  person.group.add(personTop);

  const card = part(1.25);
  box(card, 0.5, 0.34, 0.02, white, [0, 0, 0]);
  box(card, 0.3, 0.028, 0.006, fills[2], [-0.07, 0.09, 0.013]);
  box(card, 0.38, 0.028, 0.006, fills[2], [-0.03, 0.03, 0.013]);
  box(card, 0.24, 0.028, 0.006, fills[2], [-0.1, -0.03, 0.013]);
  box(card, 0.12, 0.05, 0.008, washHead, [0.14, -0.11, 0.014]);
  world.add(card.group);
  const cardEdge = new T.Object3D();
  cardEdge.position.set(0.22, -0.06, 0);
  card.group.add(cardEdge);

  // ---- The thread ------------------------------------------------------------------
  const tipAt = (p: Pin, h: number) => p.base.clone().setY(h + HEAD_R * HEAD_STRETCH * 2);
  const threadFrom = tipAt(pins[MATCHED], GRADE_H.A);
  const threadTo = buyer.group.localToWorld(new T.Vector3(0, 0.66, 0));
  world.updateMatrixWorld(true);
  threadTo.copy(buyer.group.localToWorld(new T.Vector3(0, 0.66, 0)));
  const lift = 1.5;
  const c1 = threadFrom.clone().lerp(threadTo, 0.3).setY(threadFrom.y + lift);
  const c2 = threadFrom.clone().lerp(threadTo, 0.72).setY(threadTo.y + lift * 0.95);
  const thread = new T.CubicBezierCurve3(threadFrom, c1, c2, threadTo);
  const SEG = 96;
  const threadPts = thread.getSpacedPoints(SEG);
  const flatPts: number[] = [];
  for (let i = 0; i < SEG; i++) flatPts.push(...threadPts[i].toArray(), ...threadPts[i + 1].toArray());
  const threadGeo = new fat.LineSegmentsGeometry().setPositions(flatPts);
  const threadMat = lineMat(accent, 2.25, 1);
  const threadLine = new fat.LineSegments2(threadGeo, threadMat);
  world.add(threadLine);
  const bead = new T.Mesh(new T.IcosahedronGeometry(0.05, 0), new T.MeshBasicMaterial({ color: accent, toneMapped: false }));
  world.add(bead);
  const threadApex = thread.getPointAt(0.5);

  // Where the card leaves the thread, and where it stops: beside the person, toward the camera.
  const cardFrom = thread.getPointAt(0.78);
  const personPos = at(...PERSON_AT);
  const toCam = new T.Vector3(Math.sin(YAW), 0, Math.cos(YAW));
  const camRight = new T.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
  const cardTo = personPos.clone().addScaledVector(toCam, 0.4).addScaledVector(camRight, 0.22).setY(0.3);

  world.updateMatrixWorld(true);

  // ---- Drag to turn, with a little inertia -------------------------------------------
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
    const dx = (e.clientX - dragging.x) * -0.005;
    const dt = Math.max((e.timeStamp - dragging.t) / 1000, 1 / 240);
    yawOff = Math.max(-0.9, Math.min(0.9, yawOff + dx));
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

  // ---- Framing: each shot fills a set share of the stage ------------------------------
  let width = 1;
  let height = 1;
  const tan = Math.tan((FOV * Math.PI) / 360);
  const v = new T.Vector3();
  const right = new T.Vector3();
  const up = new T.Vector3();
  type Frame = { target: THREE.Vector3; dist: number };
  let frames: Frame[] = [];

  function heightAt(p: Pin, step: number) {
    if (!p.spec.grade) return BASE_H;
    return step >= 2 ? GRADE_H[p.spec.grade] : BASE_H;
  }
  function samples(step: number): THREE.Vector3[] {
    if (SHOTS[step].frame === "send") {
      // The buyer, the person and the card, with the end of the thread and some map around them.
      const pts = [cardTo.clone().add(new T.Vector3(0, 0.25, 0)), personPos.clone().setY(0.75)];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        pts.push(personPos.clone().add(new T.Vector3(Math.cos(a) * 1.7, 0, Math.sin(a) * 1.3)));
      }
      for (let u = 0.55; u <= 1; u += 0.15) pts.push(thread.getPointAt(u));
      return pts;
    }
    const pts = ringPts.map((p) => p.clone());
    for (const pin of pins) if (step < 1 || pin.spec.grade) pts.push(tipAt(pin, heightAt(pin, step)));
    if (step >= 3) pts.push(threadApex.clone());
    return pts;
  }
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
  function fit() {
    const aspect = width / height;
    frames = SHOTS.map((shot, step) => {
      const pts = samples(step);
      const target = new T.Vector3();
      for (const p of pts) target.add(p);
      target.divideScalar(pts.length);
      let dist = 20;
      for (let k = 0; k < 4; k++) {
        placeCamera(target, dist, YAW, shot.pitch);
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const p of pts) {
          v.copy(p).project(camera);
          x0 = Math.min(x0, v.x);
          x1 = Math.max(x1, v.x);
          y0 = Math.min(y0, v.y);
          y1 = Math.max(y1, v.y);
        }
        // Recentre, then scale the distance so the box fills its share of the stage.
        right.setFromMatrixColumn(camera.matrixWorld, 0);
        up.setFromMatrixColumn(camera.matrixWorld, 1);
        const halfH = dist * tan;
        target.addScaledVector(right, ((x0 + x1) / 2) * halfH * aspect);
        target.addScaledVector(up, ((y0 + y1) / 2) * halfH);
        const s = Math.max((y1 - y0) / 2 / shot.fill, (x1 - x0) / 2 / 0.94);
        dist *= s;
      }
      return { target, dist };
    });
  }

  const callouts = Object.values(dom.callouts);
  function resize() {
    const size = sizeRenderer(renderer, camera);
    if (!size) return;
    width = size.width;
    height = size.height;
    for (const m of lineMats) m.resolution.set(width, height);
    remeasureCallouts(callouts);
    fit();
  }

  // ---- State from scroll position ----------------------------------------------------
  const easeOutBack = (t: number) => {
    const c = 1.5;
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  };
  const qTilt = new T.Quaternion();
  const headColor = new T.Color();

  function apply(p: number, time: number) {
    const w = [0, 1, 2, 3, 4].map((i) => near(p, i));
    for (const pin of pins) {
      const kept = pin.spec.grade !== null;
      // Each pin pops up in turn the first time the stage is on screen.
      const pop = reducedMotion ? 1 : ramp(time, 0.1 + pin.i * 0.035, 0.45 + pin.i * 0.035);
      let h = BASE_H;
      let tint = 1;
      let fall = 0;
      let alpha = 1;
      let sink = 0;
      if (kept) {
        const g = pin.spec.grade as Grade;
        const rise = ramp(p, 1.35 + 0.04 * (pin.i % 5), 1.8 + 0.04 * (pin.i % 5));
        h = lerp(BASE_H, GRADE_H[g], rise);
        // From the match on, only the matched pin stays red.
        // Grading leaves the accent on the A pins; from the match on, only the matched pin keeps it.
        const graded = lerp(1, GRADE_TINT[g], rise);
        tint = pin.i === MATCHED ? 1 : graded * (1 - ramp(p, 2.3, 2.75));
        alpha = pin.i === MATCHED ? 1 : 1 - 0.3 * ramp(p, 2.3, 2.75) - 0.5 * ramp(p, 3.3, 3.75);
      } else {
        const o = (pin.i % 7) * 0.035;
        fall = ramp(p, 0.3 + o, 0.68 + o);
        tint = 1 - fall;
        alpha = 1 - 0.55 * fall - 0.45 * ramp(p, 1.3, 1.75);
        sink = ramp(p, 1.3, 1.75);
      }
      const s = Math.max(0.001, easeOutBack(pop));
      pin.group.scale.setScalar(s);
      pin.group.visible = pop > 0.002 && alpha > 0.01;
      pin.group.position.copy(pin.base);
      pin.group.position.y = 0.05 * fall - 0.25 * sink;
      qTilt.setFromAxisAngle(pin.axis, 1.38 * fall);
      pin.tilt.quaternion.copy(qTilt);
      pin.stem.scale.set(1, Math.max(0.001, h), 1);
      pin.head.position.y = h + HEAD_R * HEAD_STRETCH;
      headColor.copy(fills[0]).lerp(washHead, tint).lerp(white, 0.6 * (1 - alpha));
      pin.headMat.color.copy(headColor);
      pin.headMat.opacity = alpha;
      pin.edgeMat.color.copy(ink).lerp(accent, tint);
      pin.edgeMat.opacity = 0.9 * alpha;
      pin.stemMat.color.copy(ink).lerp(accent, tint);
      pin.stemMat.opacity = 0.85 * alpha;
      pin.dotMat.opacity = 0.55 * alpha * (1 - fall);
    }

    // The thread draws out from the record to the buyer.
    const draw = ramp(p, 2.2, 2.85);
    threadGeo.instanceCount = Math.round(draw * SEG);
    threadLine.visible = draw > 0.005;
    const buyerShow = ramp(p, 2.15, 2.6);
    buyer.group.scale.setScalar(Math.max(0.001, easeOutBack(buyerShow)));
    style(buyer, Math.max(w[3], 0), buyerShow);

    // A bead runs along the thread while the match is on screen.
    const u = reducedMotion ? 0 : (time / 2.4) % 1;
    thread.getPointAt(u, bead.position);
    const beadOn = w[3] * Math.min(1, u / 0.08, (1 - u) / 0.08);
    bead.visible = !reducedMotion && beadOn > 0.02 && draw > 0.99;
    bead.scale.setScalar(Math.max(0.001, beadOn));

    // The person, and the card that lifts off the thread and stops in front of them.
    const personShow = ramp(p, 3.05, 3.45);
    person.group.scale.setScalar(Math.max(0.001, 1.2 * easeOutBack(personShow)));
    style(person, 0, personShow);
    const fly = ramp(p, 3.2, 3.85);
    card.group.position.lerpVectors(cardFrom, cardTo, fly);
    card.group.position.y += Math.sin(fly * Math.PI) * 0.35;
    const cardShow = ramp(p, 3.05, 3.3);
    card.group.scale.setScalar(Math.max(0.001, lerp(0.35, 1, ramp(fly, 0, 0.6)) * cardShow));
    style(card, 1, cardShow);
  }

  // ---- Camera ------------------------------------------------------------------------
  const cam = { x: 0, y: 0, z: 0, d: 1, pitch: 0, set: false };
  function aim(p: number, dt: number, time: number) {
    if (!frames.length) fit();
    const goal = {
      x: track(frames.map((f) => f.target.x), p),
      y: track(frames.map((f) => f.target.y), p),
      z: track(frames.map((f) => f.target.z), p),
      d: Math.exp(track(frames.map((f) => Math.log(f.dist)), p)),
      pitch: track(SHOTS.map((s) => s.pitch), p),
    };
    const e = !cam.set || reducedMotion || dt === 0 ? 1 : 1 - Math.exp(-dt * 6);
    cam.x = lerp(cam.x, goal.x, e);
    cam.y = lerp(cam.y, goal.y, e);
    cam.z = lerp(cam.z, goal.z, e);
    cam.d = Math.exp(lerp(Math.log(cam.d), Math.log(goal.d), e));
    cam.pitch = lerp(cam.pitch, goal.pitch, e);
    cam.set = true;
    const sway = reducedMotion ? 0 : 0.03 * Math.sin(time * 0.23);
    v.set(cam.x, cam.y, cam.z);
    placeCamera(v, cam.d, YAW + yawOff + sway, cam.pitch);
  }

  // ---- Labels ------------------------------------------------------------------------
  const project = createProjector(T);
  type Spec = {
    key: CalloutKey;
    anchor: THREE.Object3D;
    side: Side;
    step: number;
    /** Left out on a narrow stage. */
    wide?: boolean;
    /** The side on a narrow stage, when it differs. */
    narrowSide?: Side;
    /** Placed around this part's own box, instead of the whole map's. */
    own?: "send";
  };
  const SPECS: Spec[] = [
    { key: "mining", anchor: pins[3].tip, side: "top", step: 0 },
    { key: "raise", anchor: pins[6].tip, side: "top", step: 0 },
    { key: "trucking", anchor: pins[0].tip, side: "bottom", step: 0 },
    { key: "permit", anchor: pins[5].tip, side: "bottom", step: 0, wide: true },
    { key: "hvac", anchor: pins[1].tip, side: "bottom", step: 0 },
    { key: "gov", anchor: pins[16].tip, side: "top", step: 1 },
    { key: "individual", anchor: pins[23].tip, side: "top", step: 1, wide: true },
    { key: "agent", anchor: pins[19].tip, side: "bottom", step: 1, wide: true },
    { key: "contact", anchor: pins[31].tip, side: "bottom", step: 1 },
    { key: "gradeC", anchor: pins[7].tip, side: "top", step: 2 },
    { key: "gradeB", anchor: pins[4].tip, side: "top", step: 2 },
    { key: "gradeA", anchor: pins[0].tip, side: "bottom", step: 2 },
    { key: "record", anchor: pins[0].tip, side: "bottom", step: 3 },
    { key: "buyer", anchor: buyerTop, side: "top", step: 3 },
    { key: "draft", anchor: cardEdge, side: "bottom", step: 4, own: "send" },
    { key: "sender", anchor: personTop, side: "right", narrowSide: "top", step: 4, own: "send" },
  ];
  const sp: ScreenPoint = { x: 0, y: 0, behind: false };
  const mapBox: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const sendBox: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const items: CalloutPlacement[] = SPECS.map((s) => ({ callout: dom.callouts[s.key], x: 0, y: 0, side: s.side, opacity: 0 }));

  const grow = (r: Rect, x: number, y: number) => {
    if (x < r.left) r.left = x;
    if (x > r.right) r.right = x;
    if (y < r.top) r.top = y;
    if (y > r.bottom) r.bottom = y;
  };
  const reset = (r: Rect) => {
    r.left = Infinity;
    r.top = Infinity;
    r.right = -Infinity;
    r.bottom = -Infinity;
  };
  const tipPos = new T.Vector3();
  function boxes() {
    reset(mapBox);
    for (const q of ringPts) {
      project(q, camera, width, height, sp);
      grow(mapBox, sp.x, sp.y);
    }
    for (const pin of pins) {
      if (!pin.group.visible || pin.headMat.opacity < 0.5) continue;
      project(pin.tip.getWorldPosition(tipPos), camera, width, height, sp);
      grow(mapBox, sp.x, sp.y - 2);
    }
    if (threadLine.visible) {
      project(threadApex, camera, width, height, sp);
      grow(mapBox, sp.x, sp.y);
    }
    reset(sendBox);
    for (const o of [card.group, personTop]) {
      const r = o === card.group ? 0.26 : 0.12;
      o.getWorldPosition(tipPos);
      for (const dx of [-r, r])
        for (const dy of [-r, r]) {
          v.copy(tipPos).addScaledVector(right.setFromMatrixColumn(camera.matrixWorld, 0), dx);
          v.addScaledVector(up.setFromMatrixColumn(camera.matrixWorld, 1), dy);
          project(v, camera, width, height, sp);
          grow(sendBox, sp.x, sp.y);
        }
    }
  }

  function overlays(p: number) {
    const narrow = width < 560;
    const stage = { width, height };
    boxes();
    const gap = narrow ? 12 : 18;
    // Labels on each side are placed together, so they step clear of each other.
    const top: CalloutPlacement[] = [];
    const rest: CalloutPlacement[] = [];
    SPECS.forEach((s, i) => {
      const item = items[i];
      let o = near(p, s.step);
      if (s.wide && narrow) o = 0;
      item.opacity = 0;
      if (o > 0.01) {
        project(s.anchor, camera, width, height, sp);
        item.x = sp.x;
        item.y = sp.y;
        item.side = narrow && s.narrowSide ? s.narrowSide : s.side;
        const off = sp.x < 0 || sp.x > width || sp.y < 0 || sp.y > height;
        item.opacity = sp.behind || off ? 0 : o;
      }
      (s.own ? rest : top).push(item);
    });
    placeCallouts(top, mapBox, stage, gap);
    placeCallouts(rest, sendBox, stage, gap);
  }

  // ---- Frame -------------------------------------------------------------------------
  let time = 0;
  let lastP = -1;
  function frame(dt: number) {
    time += dt;
    const p = Math.min(4, Math.max(0, position.current ?? 0));
    if (lastP >= 0 && !dragging) {
      const dp = Math.abs(p - lastP);
      if (dp > 0) yawOff *= Math.max(0, 1 - dp * 2.5);
    }
    lastP = p;
    if (!dragging && Math.abs(vel) > 1e-3) {
      yawOff = Math.max(-0.9, Math.min(0.9, yawOff + vel * dt));
      vel *= Math.exp(-dt * 3.2);
    }
    apply(p, time);
    aim(p, dt, time);
    card.group.quaternion.copy(camera.quaternion);
    world.updateMatrixWorld(true);
    renderer.render(scene, camera);
    overlays(p);
  }

  resize();
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      remeasureCallouts(callouts);
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
      for (const g of edgeGeos.values()) g.dispose();
      stemGeo.dispose();
      threadGeo.dispose();
      for (const m of lineMats) m.dispose();
      disposeRenderer(renderer, scene);
    },
  };
}
