import type * as THREE from "three";
import { paperMaterial, type Palette } from "@/components/breakdown/kit";

/*
  A low-poly packaging line for the production-lines breakdown, plus the small flow model
  that moves cartons along it.

  The line runs along +x on a floor plate. Four generic machines sit on one conveyor:
  M1 makes cartons (they come out of it), M2 works on them under a gantry, M3 is the slow
  spot with a guide rail on its infeed, and M4 packs them into cases on a pallet. Nothing
  here is modelled on a real machine.

  three.js is passed in (T), so importing this file never pulls three.js into a bundle.
*/

type Three = typeof THREE;

/* ---------- layout, in world units ---------- */

const BELT_Y = 0.78;
const BELT_X0 = -5.0;
const BELT_X1 = 5.0;
/** Where cartons appear, inside M1, and where they leave, inside M4. */
const SOURCE_S = -4.85;
const SINK_S = 3.75;
/** Where each machine works on a carton. M1 is the source. */
export const GATE = [-5.4, -2.2, 0.9, 4.4] as const;
/** Where a carton waits while a machine is stopped. */
const STOP_AT = [-Infinity, -2.5, 0.62, 3.2] as const;
/** The step 1 chart floats this high over the line. */
const CHART_Y = 3.1;
/** Stop time per machine on the step 1 chart (bar heights). */
const STOP_TIME = [0.5, 0.78, 2.4, 0.62];
/** Downtime before and after, as bar heights: after is 35% lower. */
const RESULT = { before: 2.6, after: 2.6 * 0.65 };
const RESULT_X = { before: 7.6, after: 8.3 };
/** The floor plate starts here; its length changes when the result bars come in. */
const PLATE_X0 = -6.6;
export const PLATE_LEN = { line: 13.9, result: 15.4 };

const CARTON = { w: 0.26, h: 0.4, gable: 0.09, d: 0.26 };

/* ---------- materials ---------- */

/** Materials that fade together. Opacity is base opacity times the fade. */
export class Fade {
  private items: { m: THREE.Material; base: number }[] = [];
  private value = 1;

  add<M extends THREE.Material>(m: M): M {
    this.items.push({ m, base: m.opacity });
    return m;
  }

  set(o: number) {
    if (Math.abs(o - this.value) < 1e-4) return;
    this.value = o;
    for (const { m, base } of this.items) {
      const see = o < 0.999 || base < 0.999;
      if (m.transparent !== see) {
        m.transparent = see;
        m.needsUpdate = true;
      }
      m.opacity = base * o;
    }
  }
}

/** Moves a fill and its edges from their own colours toward the site blue. */
export type Tint = (t: number) => void;

function makeTint(
  T: Three,
  fill: THREE.MeshLambertMaterial,
  edge: THREE.LineBasicMaterial,
  fillTo: string,
  edgeTo: string,
): Tint {
  const f0 = fill.color.clone();
  const e0 = edge.color.clone();
  const f1 = new T.Color(fillTo);
  const e1 = new T.Color(edgeTo);
  let last = -1;
  return (t) => {
    if (Math.abs(t - last) < 1e-3) return;
    last = t;
    fill.color.copy(f0).lerp(f1, t);
    edge.color.copy(e0).lerp(e1, t);
  };
}

/* ---------- the flow model ---------- */

export type Carton = { s: number; tilt: number; obj: THREE.Object3D };

/**
 * Cartons ride the belt at one speed, never closer than a packed pitch. A stopped machine
 * holds the next carton at its infeed, so a queue builds behind it and everything past it
 * runs on and out. M1 adds a carton whenever there's room behind the last one.
 */
export class LineSim {
  readonly speed = 1.05;
  readonly pitch = 0.62;
  readonly packed = 0.31;
  stopped = [false, false, false, false];
  /** True while M3's stop is a jam, which tips the waiting carton. */
  jam = false;
  /** Cartons packed so far. */
  out = 0;
  /** Distance cartons have moved through M2 and M3; drives their moving parts. */
  work = [0, 0, 0, 0];
  /** Belt travel, for the slats. */
  belt = 0;
  active: Carton[] = [];
  private pool: Carton[];

  constructor(cartons: Carton[]) {
    this.pool = [...cartons];
    for (const c of cartons) c.obj.visible = false;
  }

  reset() {
    while (this.active.length) this.release(this.active.pop()!);
    this.out = 0;
    this.work.fill(0);
  }

  private release(c: Carton) {
    c.obj.visible = false;
    c.tilt = 0;
    this.pool.push(c);
  }

  step(dt: number) {
    if (dt <= 0) return;
    const { speed, packed } = this;
    this.belt += speed * dt;
    let ahead = Infinity;
    // Downstream first, so each carton knows where the one ahead of it ended up.
    for (const c of this.active) {
      let to = Math.min(c.s + speed * dt, ahead - packed);
      for (let k = 1; k < 4; k++) {
        if (this.stopped[k] && c.s <= STOP_AT[k] + 1e-6 && to > STOP_AT[k]) to = STOP_AT[k];
      }
      if (to < c.s) to = c.s;
      const moved = to - c.s;
      for (let k = 1; k < 4; k++) if (Math.abs(c.s - GATE[k]) < 0.45) this.work[k] += moved;
      c.s = to;
      ahead = to;
      const tip = this.jam && Math.abs(c.s - STOP_AT[2]) < 0.02 ? 1 : 0;
      c.tilt += (tip - c.tilt) * Math.min(1, dt * 9);
    }
    while (this.active.length && this.active[0].s >= SINK_S) {
      this.release(this.active.shift()!);
      this.out++;
    }
    const last = this.active[this.active.length - 1];
    if (!this.stopped[0] && this.pool.length && (!last || last.s - this.pitch >= SOURCE_S)) {
      const c = this.pool.pop()!;
      c.s = last ? last.s - this.pitch : SOURCE_S;
      c.tilt = 0;
      c.obj.visible = true;
      this.active.push(c);
      this.work[0] += this.pitch;
    }
  }

  /** Runs the model for a while at a fixed step, for a still picture or a warm start. */
  run(seconds: number, stops?: (t: number) => boolean[]) {
    const dt = 1 / 30;
    for (let t = 0; t < seconds; t += dt) {
      if (stops) this.stopped = stops(t);
      this.step(dt);
    }
  }

  /** Moves the carton objects to the model's positions. */
  sync() {
    for (const c of this.active) {
      c.obj.position.x = c.s;
      c.obj.rotation.z = -c.tilt * 0.32;
    }
  }
}

/* ---------- the line ---------- */

export type LineModel = {
  root: THREE.Group;
  /** Every material on the line, for fading the whole line in. */
  fade: Fade;
  /** The floor plate. Its x scale is its length. */
  plate: THREE.Mesh;
  machines: { body: Tint; light: Tint }[];
  heads: { m2: THREE.Object3D; m3: THREE.Object3D };
  oldRail: { group: THREE.Group; fade: Fade };
  newRail: { group: THREE.Group; fade: Fade; tint: Tint };
  operator: { group: THREE.Group; fade: Fade; board: Tint; hand: THREE.Object3D };
  cases: THREE.Object3D[];
  result: { group: THREE.Group; bars: THREE.Mesh[]; afterTop: THREE.Object3D };
  marks: { m1Top: THREE.Object3D; front: THREE.Object3D; m3Light: THREE.Object3D; rail: THREE.Object3D };
  cartons: Carton[];
  /** Moves the belt slats to a belt travel distance. */
  belt(travel: number): void;
};

type Builder = {
  T: Three;
  edgesOf(geo: THREE.BufferGeometry): THREE.EdgesGeometry;
};

function edgeMaterial(T: Three, color: string, opacity = 0.85) {
  return new T.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
}

/** A mesh with ink edges, added to parent. */
function part(
  b: Builder,
  geo: THREE.BufferGeometry,
  fill: THREE.Material,
  edge: THREE.LineBasicMaterial | null,
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
) {
  const T = b.T;
  const m = new T.Mesh(geo, fill);
  m.position.set(x, y, z);
  if (edge) {
    const l = new T.LineSegments(b.edgesOf(geo), edge);
    l.raycast = () => {};
    m.add(l);
  }
  parent.add(m);
  return m;
}

function marker(T: Three, parent: THREE.Object3D, x: number, y: number, z: number) {
  const o = new T.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

export function buildLine(T: Three, palette: Palette): LineModel {
  const cache = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();
  const b: Builder = {
    T,
    edgesOf(geo) {
      let e = cache.get(geo);
      if (!e) {
        e = new T.EdgesGeometry(geo, 20);
        cache.set(geo, e);
      }
      return e;
    },
  };
  const [f0, f1, f2] = palette.fills;
  const fade = new Fade();
  const mat = (color: string) => fade.add(paperMaterial(T, color));
  const ink = (opacity = 0.85) => fade.add(edgeMaterial(T, palette.ink, opacity));
  const box = (w: number, h: number, d: number) => new T.BoxGeometry(w, h, d);

  const root = new T.Group();
  const paper0 = mat(f0);
  const paper1 = mat(f1);
  const paper2 = mat(f2);
  const white = mat("#ffffff");
  const edge = ink();
  const faint = ink(0.28);

  // Floor plate, one unit long and stretched to length.
  const plateGeo = box(1, 0.04, 3.0);
  plateGeo.translate(0.5, 0, 0);
  const plate = part(b, plateGeo, paper0, faint, root, PLATE_X0, -0.02, 0);
  plate.scale.x = PLATE_LEN.line;

  // Conveyor: belt, side frames, legs.
  const beltLen = BELT_X1 - BELT_X0;
  const beltMid = (BELT_X0 + BELT_X1) / 2;
  part(b, box(beltLen, 0.06, 0.6), paper2, edge, root, beltMid, BELT_Y - 0.03, 0);
  const frameGeo = box(beltLen, 0.12, 0.05);
  for (const z of [-0.33, 0.33]) part(b, frameGeo, paper1, edge, root, beltMid, BELT_Y - 0.02, z);
  const legGeo = box(0.06, BELT_Y - 0.08, 0.06);
  for (const x of [-3.55, -0.75, 2.25]) {
    for (const z of [-0.28, 0.28]) part(b, legGeo, paper2, edge, root, x, (BELT_Y - 0.08) / 2, z);
  }

  // Belt slats, which show the belt running.
  const SLAT = 0.25;
  const slatCount = Math.floor(beltLen / SLAT);
  const slatPos = new Float32Array(slatCount * 6);
  const slatGeo = new T.BufferGeometry();
  slatGeo.setAttribute("position", new T.BufferAttribute(slatPos, 3));
  const slats = new T.LineSegments(slatGeo, fade.add(edgeMaterial(T, palette.ink, 0.22)));
  slats.frustumCulled = false;
  root.add(slats);
  const belt = (travel: number) => {
    const off = travel % SLAT;
    for (let i = 0; i < slatCount; i++) {
      const x = BELT_X0 + ((i * SLAT + off) % beltLen);
      const j = i * 6;
      slatPos[j] = x;
      slatPos[j + 1] = BELT_Y + 0.002;
      slatPos[j + 2] = -0.28;
      slatPos[j + 3] = x;
      slatPos[j + 4] = BELT_Y + 0.002;
      slatPos[j + 5] = 0.28;
    }
    slatGeo.attributes.position.needsUpdate = true;
  };
  belt(0);

  // Each machine has its own body and light materials, so a stopped one can turn blue.
  type Pair = { fill: THREE.MeshLambertMaterial; edge: THREE.LineBasicMaterial };
  const machines: { body: Tint; light: Tint }[] = [];
  const bodyMats: Pair[] = [];
  const lampMats: Pair[] = [];
  const lightTops: THREE.Object3D[] = [];
  for (let k = 0; k < 4; k++) {
    const body = { fill: mat(f1), edge: ink() };
    const lamp = { fill: mat(f0), edge: ink() };
    bodyMats.push(body);
    lampMats.push(lamp);
    machines.push({
      body: makeTint(T, body.fill, body.edge, palette.agentPale, palette.agent),
      light: makeTint(T, lamp.fill, lamp.edge, palette.agent, palette.agent),
    });
  }
  const lightGeo = new T.CylinderGeometry(0.075, 0.075, 0.17, 6);
  const poleGeo = new T.CylinderGeometry(0.022, 0.022, 0.3, 5);
  /** A stack light on a short pole standing at (x, y, z). */
  const stackLight = (k: number, x: number, y: number, z: number) => {
    part(b, poleGeo, bodyMats[k].fill, bodyMats[k].edge, root, x, y + 0.15, z);
    part(b, lightGeo, lampMats[k].fill, lampMats[k].edge, root, x, y + 0.385, z);
    lightTops[k] = marker(T, root, x, y + 0.47, z);
  };

  // M1, where cartons come from: a cabinet with a hopper on top.
  {
    const { fill, edge: e } = bodyMats[0];
    part(b, box(1.6, 1.55, 1.5), fill, e, root, -5.4, 0.775, 0);
    part(b, box(0.02, 0.62, 0.72), paper2, e, root, -4.59, BELT_Y + 0.27, 0);
    const hopper = part(b, new T.CylinderGeometry(0.62, 0.32, 0.55, 4, 1), fill, e, root, -5.55, 1.825, 0);
    hopper.rotation.y = Math.PI / 4;
    part(b, box(0.5, 0.36, 0.02), paper0, e, root, -5.75, 0.95, 0.76);
    stackLight(0, -6.0, 1.55, -0.55);
  }
  const m1Top = marker(T, root, -5.55, 2.1, 0);
  const front = marker(T, root, -5.4, 0, 1.5);

  // M2: a gantry over the belt with a tank on top and a head that dips as cartons pass.
  const m2Head = new T.Group();
  {
    const { fill, edge: e } = bodyMats[1];
    const colGeo = box(0.8, 1.8, 0.3);
    for (const z of [-0.62, 0.62]) part(b, colGeo, fill, e, root, -2.2, 0.9, z);
    part(b, box(0.8, 0.3, 1.54), fill, e, root, -2.2, 1.95, 0);
    part(b, new T.CylinderGeometry(0.34, 0.34, 0.5, 8), fill, e, root, -2.2, 2.35, 0);
    part(b, new T.CylinderGeometry(0.05, 0.34, 0.16, 8), fill, e, root, -2.2, 2.68, 0);
    m2Head.position.set(-2.2, 1.68, 0);
    root.add(m2Head);
    part(b, box(0.5, 0.16, 0.4), fill, e, m2Head, 0, 0, 0);
    const nozzle = new T.CylinderGeometry(0.035, 0.035, 0.14, 6);
    for (const x of [-0.12, 0.12]) part(b, nozzle, paper2, e, m2Head, x, -0.15, 0);
    part(b, box(0.05, 0.12, 0.05), paper2, e, root, -2.2, 1.74, 0);
    stackLight(1, -2.48, 2.1, -0.6);
  }

  // M3, the slow spot: a cabinet behind the belt, an arm over it, a turning head.
  const m3Head = new T.Group();
  {
    const { fill, edge: e } = bodyMats[2];
    part(b, box(1.1, 1.8, 0.56), fill, e, root, 0.9, 0.9, -0.78);
    part(b, box(0.34, 0.24, 0.86), fill, e, root, 0.9, 1.68, -0.25);
    part(b, new T.CylinderGeometry(0.04, 0.04, 0.1, 6), paper2, e, root, 0.9, 1.52, 0);
    m3Head.position.set(0.9, 1.42, 0);
    root.add(m3Head);
    part(b, new T.CylinderGeometry(0.17, 0.17, 0.12, 8), fill, e, m3Head, 0, 0, 0);
    part(b, box(0.07, 0.08, 0.07), paper2, e, m3Head, 0.19, 0, 0);
    part(b, box(0.5, 0.4, 0.02), paper0, e, root, 0.9, 1.2, -0.49);
    stackLight(2, 0.5, 1.8, -0.95);
  }
  const m3Light = lightTops[2];

  // The guide rails on M3's infeed. The far rail stays; the near one is the part that
  // gets changed: the old one sits crooked and pinches the lane, the new one is straight
  // with a flared lead-in.
  const railGeo = box(1.0, 0.07, 0.035);
  const bracketGeo = box(0.03, 0.03, 0.15);
  const postGeo = box(0.03, 0.18, 0.03);
  const RAIL_Y = BELT_Y + 0.2;
  const RAIL_X = 0.05;
  const rail = (parent: THREE.Object3D, fill: THREE.Material, e: THREE.LineBasicMaterial, z: number, skew: number) => {
    const s = Math.sign(z);
    const r = part(b, railGeo, fill, e, parent, RAIL_X, RAIL_Y, z);
    r.rotation.y = skew;
    for (const x of [-0.3, 0.4]) {
      part(b, bracketGeo, fill, e, parent, x, RAIL_Y, z + s * 0.075);
      part(b, postGeo, fill, e, parent, x, BELT_Y + 0.13, s * 0.33);
    }
  };
  rail(root, paper1, edge, -0.18, 0);

  const oldFade = new Fade();
  const oldRail = new T.Group();
  {
    const fill = oldFade.add(fade.add(paperMaterial(T, f1)));
    const e = oldFade.add(fade.add(edgeMaterial(T, palette.ink)));
    rail(oldRail, fill, e, 0.18, 0.12);
  }
  root.add(oldRail);

  const newFade = new Fade();
  const newRail = new T.Group();
  const newFill = newFade.add(fade.add(paperMaterial(T, f1)));
  const newEdge = newFade.add(fade.add(edgeMaterial(T, palette.ink)));
  {
    rail(newRail, newFill, newEdge, 0.18, 0);
    const flare = part(b, box(0.24, 0.07, 0.035), newFill, newEdge, newRail, RAIL_X - 0.6, RAIL_Y, 0.225);
    flare.rotation.y = 0.45;
  }
  root.add(newRail);
  const railMark = marker(T, root, RAIL_X - 0.15, RAIL_Y + 0.03, 0.2);

  // M4, where cartons go: a case packer, and a pallet of cases beside it.
  const cases: THREE.Object3D[] = [];
  {
    const { fill, edge: e } = bodyMats[3];
    part(b, box(2.0, 1.6, 1.5), fill, e, root, 4.4, 0.8, 0);
    part(b, box(0.02, 0.62, 0.72), paper2, e, root, 3.39, BELT_Y + 0.27, 0);
    part(b, box(1.1, 0.5, 0.02), paper0, e, root, 4.5, 1.0, 0.76);
    part(b, box(0.7, 0.3, 0.6), fill, e, root, 4.65, 1.75, -0.2);
    part(b, box(0.5, 0.06, 0.6), paper1, edge, root, 5.65, 0.45, 0);
    stackLight(3, 3.7, 1.6, -0.55);
    // Pallet.
    part(b, box(1.0, 0.04, 1.0), paper2, edge, root, 6.5, 0.12, 0);
    const runner = box(1.0, 0.1, 0.12);
    for (const z of [-0.42, 0, 0.42]) part(b, runner, paper2, edge, root, 6.5, 0.05, z);
    const caseGeo = box(0.46, 0.32, 0.46);
    for (let i = 0; i < 8; i++) {
      const layer = Math.floor(i / 4);
      const j = i % 4;
      const c = part(b, caseGeo, paper1, edge, root, 6.5 + (j & 1 ? 0.24 : -0.24), 0.14 + 0.16 + layer * 0.33, j & 2 ? 0.24 : -0.24);
      c.visible = false;
      cases.push(c);
    }
  }

  // Downtime before and after, at the end of the line, for the last step.
  const result = new T.Group();
  root.add(result);
  const barGeo = (h: number) => {
    const g = box(0.56, h, 0.56);
    g.translate(0, h / 2, 0);
    return g;
  };
  const beforeBar = part(b, barGeo(RESULT.before), paper1, edge, result, RESULT_X.before, 0, 0);
  const afterBar = part(
    b,
    barGeo(RESULT.after),
    mat(palette.agentPale),
    fade.add(edgeMaterial(T, palette.agent, 0.95)),
    result,
    RESULT_X.after,
    0,
    0,
  );
  // The label anchor: the after bar's right top corner, as seen from the front right.
  const afterTop = marker(T, afterBar, 0.28, RESULT.after, -0.28);

  // An operator with a written procedure, between M2 and M3.
  const opFade = new Fade();
  const operator = new T.Group();
  operator.position.set(-0.6, 0, 1.12);
  operator.rotation.y = 0.5;
  root.add(operator);
  const opBody = opFade.add(fade.add(paperMaterial(T, f1)));
  const opLight = opFade.add(fade.add(paperMaterial(T, "#ffffff")));
  const opEdge = opFade.add(fade.add(edgeMaterial(T, palette.ink)));
  const boardFill = opFade.add(fade.add(paperMaterial(T, "#ffffff")));
  const boardEdge = opFade.add(fade.add(edgeMaterial(T, palette.ink)));
  {
    const leg = box(0.13, 0.78, 0.15);
    for (const x of [-0.09, 0.09]) part(b, leg, opBody, opEdge, operator, x, 0.39, 0);
    part(b, box(0.42, 0.62, 0.24), opBody, opEdge, operator, 0, 1.09, 0);
    part(b, new T.IcosahedronGeometry(0.12, 0), opLight, opEdge, operator, 0, 1.54, 0);
    part(b, new T.SphereGeometry(0.135, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), opLight, opEdge, operator, 0, 1.6, 0);
    part(b, new T.CylinderGeometry(0.17, 0.17, 0.02, 8), opLight, opEdge, operator, 0, 1.6, 0);
    const arm = box(0.09, 0.4, 0.09);
    for (const x of [-0.25, 0.25]) {
      const a = part(b, arm, opBody, opEdge, operator, x, 1.16, 0.12);
      a.rotation.x = -0.75;
    }
    const board = part(b, box(0.32, 0.42, 0.025), boardFill, boardEdge, operator, 0, 1.12, 0.3);
    board.rotation.x = -0.35;
  }
  const hand = marker(T, operator, -0.14, 1.16, 0.31);

  // Cartons: a gable-top body with a fin on the ridge.
  const shape = new T.Shape();
  shape.moveTo(-CARTON.w / 2, 0);
  shape.lineTo(CARTON.w / 2, 0);
  shape.lineTo(CARTON.w / 2, CARTON.h);
  shape.lineTo(0, CARTON.h + CARTON.gable);
  shape.lineTo(-CARTON.w / 2, CARTON.h);
  shape.closePath();
  const cartonGeo = new T.ExtrudeGeometry(shape, { depth: CARTON.d, bevelEnabled: false });
  cartonGeo.translate(0, 0, -CARTON.d / 2);
  const finGeo = box(0.02, 0.05, CARTON.d);
  const cartons: Carton[] = [];
  for (let i = 0; i < 30; i++) {
    const g = new T.Group();
    g.position.set(SOURCE_S, BELT_Y, 0);
    part(b, cartonGeo, white, edge, g, 0, 0, 0);
    part(b, finGeo, white, edge, g, 0, CARTON.h + CARTON.gable + 0.02, 0);
    root.add(g);
    cartons.push({ s: SOURCE_S, tilt: 0, obj: g });
  }

  return {
    root,
    fade,
    plate,
    machines,
    heads: { m2: m2Head, m3: m3Head },
    oldRail: { group: oldRail, fade: oldFade },
    newRail: { group: newRail, fade: newFade, tint: makeTint(T, newFill, newEdge, palette.agentPale, palette.agent) },
    operator: {
      group: operator,
      fade: opFade,
      board: makeTint(T, boardFill, boardEdge, palette.agentPale, palette.agent),
      hand,
    },
    cases,
    result: { group: result, bars: [beforeBar, afterBar], afterTop },
    marks: { m1Top, front, m3Light, rail: railMark },
    cartons,
    belt,
  };
}

/* ---------- the stop-time chart for step 1 ---------- */

export type StopChart = {
  root: THREE.Group;
  fade: Fade;
  bars: THREE.Mesh[];
  /** Top of each bar, following its height. */
  tops: THREE.Object3D[];
  /** The plate's far end, for the chart's note. */
  start: THREE.Object3D;
};

/**
 * A thin plate floating over the line with one bar per machine, each standing over its
 * machine. M3's bar is the tall blue one.
 */
export function buildStopChart(T: Three, palette: Palette): StopChart {
  const fade = new Fade();
  const root = new T.Group();
  const edges = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();
  const b: Builder = {
    T,
    edgesOf(geo) {
      let e = edges.get(geo);
      if (!e) {
        e = new T.EdgesGeometry(geo, 20);
        edges.set(geo, e);
      }
      return e;
    },
  };
  const plateFill = fade.add(paperMaterial(T, palette.fills[0]));
  const ink = fade.add(edgeMaterial(T, palette.ink));
  const barFill = fade.add(paperMaterial(T, palette.fills[1]));
  const blueFill = fade.add(paperMaterial(T, palette.agentPale));
  const blueEdge = fade.add(edgeMaterial(T, palette.agent, 0.95));
  const drop = fade.add(edgeMaterial(T, palette.ink, 0.25));

  const x0 = GATE[0] - 0.75;
  const x1 = GATE[3] + 0.75;
  part(b, new T.BoxGeometry(x1 - x0, 0.04, 0.62), plateFill, ink, root, (x0 + x1) / 2, CHART_Y - 0.02, 0);

  const bars: THREE.Mesh[] = [];
  const tops: THREE.Object3D[] = [];
  const tops0 = [2.12, 2.78, 1.82, 1.92];
  const dropPos: number[] = [];
  STOP_TIME.forEach((h, k) => {
    const g = new T.BoxGeometry(0.46, h, 0.46);
    g.translate(0, h / 2, 0);
    const worst = k === 2;
    const bar = part(b, g, worst ? blueFill : barFill, worst ? blueEdge : ink, root, GATE[k], CHART_Y, 0);
    bars.push(bar);
    tops.push(marker(T, bar, 0, h, 0));
    dropPos.push(GATE[k], CHART_Y - 0.04, 0, GATE[k], tops0[k] + 0.08, 0);
  });
  const dropGeo = new T.BufferGeometry();
  dropGeo.setAttribute("position", new T.Float32BufferAttribute(dropPos, 3));
  root.add(new T.LineSegments(dropGeo, drop));

  return { root, fade, bars, tops, start: marker(T, root, x0 + 0.05, CHART_Y, 0) };
}
