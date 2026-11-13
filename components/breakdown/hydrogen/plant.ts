import type * as THREE from "three";
import { paperMaterial, type Palette } from "@/components/breakdown/kit";

/*
  A low-poly blue hydrogen plant on a ground tile, built from three.js primitives for the
  hydrogen breakdown. It is a generic plant drawn for the page, not the real layout.

  Units are loose (about 10 m each). Process runs left to right along x: the feed comes in
  on the left, the reformer and shift vessels stand in the back row, the capture columns
  next to them, a pipe rack runs down the middle at z = 0, and the hydrogen leaves on the
  right. CO2 drops into the ground at a wellhead at the front right.

  layout(compact, depth) moves everything for the story: compact pulls every unit toward
  the middle (pipes follow, equipment keeps its shape), depth opens the ground below the
  tile so the CO2 line can be seen going down to storage.
*/

type Three = typeof THREE;
export type V3 = [number, number, number];

/** Everything in a group turns blue together. */
export type TintGroup = "plant" | "ground" | "reaction" | "capture" | "storage" | "feed" | "syngas" | "h2" | "co2" | "bar";
export type StreamName = "feed" | "syngas" | "h2" | "co2";

/** A path point. edge: stays at the tile edge when the plant compacts. deep: follows the opened ground. */
type Pt = { p: V3; edge?: boolean; deep?: boolean };

const PIPE_R = 0.085;
export const TILE = { w: 17, d: 11, t: 0.5 };
/** How far the ground opens below the tile, at depth 1. */
const DEPTH = 3.9;

const STREAMS: Record<StreamName, Pt[]> = {
  feed: [{ p: [-9.4, 0.18, 3.0], edge: true }, { p: [-4.0, 0.18, 3.0] }, { p: [-4.0, 0.18, -2.5] }],
  syngas: [
    { p: [-3.6, 0.7, -3.0] },
    { p: [-1.8, 0.7, -3.0] },
    { p: [-1.8, 2.45, -3.0] },
    { p: [-0.8, 2.45, -3.0] },
    { p: [-0.8, 0.6, -3.0] },
    { p: [0.6, 0.6, -3.0] },
    { p: [0.6, 4.9, -3.0] },
  ],
  h2: [
    { p: [0.6, 4.9, -3.0] },
    { p: [0.6, 5.5, -3.0] },
    { p: [0.6, 5.5, -2.33] },
    { p: [0.6, 2.05, -2.33] },
    { p: [0.6, 2.05, 0.32] },
    { p: [0.6, 1.74, 0.32] },
    { p: [5.7, 1.74, 0.32] },
    { p: [5.7, 0.18, 0.32] },
    { p: [9.4, 0.18, 0.32], edge: true },
  ],
  co2: [
    { p: [0.6, 0.35, -3.0] },
    { p: [2.2, 0.35, -3.0] },
    { p: [2.2, 4.75, -3.0] },
    { p: [2.2, 4.75, -2.42] },
    { p: [2.2, 2.05, -2.42] },
    { p: [2.2, 2.05, 1.85] },
    { p: [2.2, 0.55, 1.85] },
    { p: [2.2, 0.55, 2.6] },
    { p: [5.6, 0.55, 2.6] },
    { p: [5.6, 0.55, 4.0] },
    { p: [5.6, -0.45, 4.0], deep: true },
  ],
};

/** Pipes along the rack that carry nothing in the story, at [y, z]. */
const RACK_PIPES: [number, number][] = [
  [1.74, -0.32],
  [1.74, -0.12],
  [1.74, 0.12],
  [1.14, -0.25],
  [1.14, 0.25],
];
const RACK_X: [number, number] = [-5.75, 5.35];
const BENTS = Array.from({ length: 10 }, (_, i) => -5.6 + i * 1.2);

/** The plot line drawn round the plant in the scope step, in plant coordinates. */
const PLOT: [number, number, number, number] = [-8.0, -4.65, 7.4, 4.05];

const TREES: [number, number, number][] = [
  [-8.0, -4.95, 1],
  [-7.35, -5.1, 0.8],
  [-8.05, 4.85, 0.9],
  [-7.4, 5.1, 1.1],
  [-2.9, 5.1, 0.8],
  [8.0, -4.9, 1.1],
  [7.35, -5.1, 0.85],
  [8.05, 4.9, 0.95],
  [7.3, 5.1, 0.8],
  [0.5, -5.15, 0.9],
];

export type AnchorName = "reformer" | "stack" | "absorber" | "wellhead" | "storage" | "barMid" | "barTop" | "barCut";

export type Plant = {
  root: THREE.Group;
  /** Compaction (0 to 1) and how far the ground is open (0 to 1). Cheap when nothing changed. */
  layout(compact: number, depth: number): void;
  /** World position s units along a stream. */
  sample(stream: StreamName, s: number, out: THREE.Vector3): THREE.Vector3;
  length(stream: StreamName): number;
  tint(group: TintGroup, t: number): void;
  anchors: Record<AnchorName, THREE.Object3D>;
  fans: THREE.Object3D[];
  /** The plot line now, and the original one left behind as a ghost. */
  plot: THREE.LineLoop;
  plotGhost: THREE.LineLoop;
  bar: {
    /** Scale this for the bar coming up out of its tile. */
    root: THREE.Group;
    /** The part of the bar the sessions took off. */
    cut: THREE.Mesh;
    cutLine: THREE.LineBasicMaterial;
    /** Dashed outline where the cut part was. */
    ghost: THREE.LineSegments;
  };
  ground: { block: THREE.Mesh; rock: THREE.Mesh };
  dispose(): void;
};

export function buildPlant(T: Three, palette: Palette): Plant {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const keep = <G extends THREE.BufferGeometry>(g: G) => {
    geos.push(g);
    return g;
  };

  const ink = new T.Color(palette.ink);
  const agent = new T.Color(palette.agent);
  const tintFill = new T.Color(0xffffff).lerp(agent, 0.2);
  const [F0, F1, F2] = palette.fills;

  // ---- Paints: one fill and one edge material per group and shade, so a group tints at once.
  type Paint = { group: TintGroup; mat: THREE.MeshLambertMaterial; line: THREE.LineBasicMaterial; fill: THREE.Color; base: number };
  const paints: Paint[] = [];
  const paintCache = new Map<string, Paint>();
  function paint(group: TintGroup, fill: string, base = 0.85): Paint {
    const key = `${group}|${fill}|${base}`;
    let p = paintCache.get(key);
    if (!p) {
      const mat = paperMaterial(T, fill);
      const line = new T.LineBasicMaterial({ color: ink, transparent: true, opacity: base, depthWrite: false, toneMapped: false });
      mats.push(mat, line);
      p = { group, mat, line, fill: new T.Color(fill), base };
      paints.push(p);
      paintCache.set(key, p);
    }
    return p;
  }
  const tints = new Map<TintGroup, number>();
  function tint(group: TintGroup, t: number) {
    t = Math.min(1, Math.max(0, t));
    if (tints.get(group) === t) return;
    tints.set(group, t);
    for (const p of paints) {
      if (p.group !== group) continue;
      p.mat.color.copy(p.fill).lerp(tintFill, t);
      p.line.color.copy(ink).lerp(agent, t);
      p.line.opacity = p.base + (1 - p.base) * t;
    }
  }

  const edgeCache = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();
  function mesh(geo: THREE.BufferGeometry, p: Paint, threshold = 20) {
    const m = new T.Mesh(geo, p.mat);
    let e = edgeCache.get(geo);
    if (!e) {
      e = keep(new T.EdgesGeometry(geo, threshold));
      edgeCache.set(geo, e);
    }
    const l = new T.LineSegments(e, p.line);
    l.raycast = () => {};
    m.add(l);
    return m;
  }

  // ---- Geometry helpers ------------------------------------------------------------------
  const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
    const g = new T.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return keep(g);
  };
  const cyl = (rTop: number, rBottom: number, h: number, seg: number, x = 0, y = 0, z = 0) => {
    const g = new T.CylinderGeometry(rTop, rBottom, h, seg, 1);
    g.translate(x, y, z);
    return keep(g);
  };
  /** A vertical vessel with a domed head, from y = 0 to the top of the head. */
  const vessel = (r: number, h: number, seg = 8) => {
    const V = T.Vector2;
    return keep(new T.LatheGeometry([new V(0, 0), new V(r, 0), new V(r, h), new V(r * 0.7, h + r * 0.3), new V(0, h + r * 0.45)], seg));
  };
  /** A pitched roof, ridge along x, sitting on y = 0. */
  const gable = (length: number, width: number, height: number) => {
    const s = new T.Shape();
    s.moveTo(-width / 2, 0);
    s.lineTo(width / 2, 0);
    s.lineTo(0, height);
    s.closePath();
    const g = new T.ExtrudeGeometry(s, { depth: length, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(-length / 2, 0, 0);
    return keep(g);
  };
  /** Joins position-and-normal geometries into one (boxes and cylinders). */
  const merge = (list: THREE.BufferGeometry[]) => {
    const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0;
    for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array as Float32Array, o * 3);
      nor.set(g.attributes.normal.array as Float32Array, o * 3);
      o += g.attributes.position.count;
    }
    const out = new T.BufferGeometry();
    out.setAttribute("position", new T.BufferAttribute(pos, 3));
    out.setAttribute("normal", new T.BufferAttribute(nor, 3));
    parts.forEach((g) => g.dispose());
    list.forEach((g) => g.dispose());
    return keep(out);
  };

  const root = new T.Group();
  const plantGroup = new T.Group();
  root.add(plantGroup);

  // ---- Ground tile -------------------------------------------------------------------------
  const tile = mesh(box(TILE.w, TILE.t, TILE.d, 0, -TILE.t / 2, 0), paint("ground", F0, 0.9));
  root.add(tile);

  // The ground under the tile: a see-through block that opens downward, with a rock layer.
  const blockGeo = box(TILE.w, 1, TILE.d, 0, -0.5, 0);
  const blockMat = new T.MeshLambertMaterial({ color: F1, transparent: true, opacity: 0.2, depthWrite: false, flatShading: true });
  const blockLine = new T.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false });
  mats.push(blockMat, blockLine);
  const block = new T.Mesh(blockGeo, blockMat);
  block.add(new T.LineSegments(keep(new T.EdgesGeometry(blockGeo)), blockLine));
  block.position.y = -TILE.t;
  block.renderOrder = 2;
  root.add(block);

  const rockGeo = keep(new T.BoxGeometry(TILE.w - 0.5, 0.45, TILE.d - 0.5, 9, 1, 6));
  {
    // A broken top surface, so the layer reads as rock.
    const pa = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      if (y <= 0) continue;
      const x = pa.getX(i);
      const z = pa.getZ(i);
      const edge = Math.abs(Math.abs(x) - (TILE.w - 0.5) / 2) < 1e-3 || Math.abs(Math.abs(z) - (TILE.d - 0.5) / 2) < 1e-3;
      const n = Math.sin(x * 1.7 + z * 0.9) * 0.5 + Math.sin(x * 0.6 - z * 2.1) * 0.5;
      pa.setY(i, y + n * (edge ? 0.12 : 0.2));
    }
    rockGeo.computeVertexNormals();
  }
  const rock = mesh(rockGeo, paint("storage", F1, 0.6), 25);
  root.add(rock);
  // Below the front face of the rock layer, under the well.
  const storageMark = new T.Object3D();
  root.add(storageMark);

  // ---- Units: equipment that keeps its shape and moves when the plant compacts. -------------
  type Unit = { obj: THREE.Object3D; base: V3 };
  const units: Unit[] = [];
  const unit = (base: V3, ...children: THREE.Object3D[]) => {
    const g = new T.Group();
    g.position.set(...base);
    g.add(...children);
    plantGroup.add(g);
    units.push({ obj: g, base });
    return g;
  };
  const anchorAt = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const a = new T.Object3D();
    a.position.set(x, y, z);
    parent.add(a);
    return a;
  };

  const plant = paint("plant", F1);
  const plantPale = paint("plant", F0);
  const reaction = paint("reaction", F1);
  const capture = paint("capture", F1);
  const co2Paint = paint("co2", F1);

  // Reformer: a long firebox with a pitched roof, a taller section at one end and its stack.
  const reformer = unit(
    [-4.2, 0, -3.0],
    mesh(box(3.2, 1.5, 2.0, 0, 0.75, 0), reaction),
    mesh(gable(2.4, 2.0, 0.34), reaction),
    mesh(box(0.8, 1.0, 1.5, 1.2, 2.0, 0), reaction),
    mesh(cyl(0.17, 0.22, 3.2, 8, 1.2, 4.1, 0), reaction),
  );
  reformer.children[1].position.set(-0.4, 1.5, 0);
  const aReformer = anchorAt(reformer, -0.6, 1.85, 0);
  const aStack = anchorAt(reformer, 1.2, 5.7, 0);

  // Two shift vessels on small pads.
  const shiftGeo = vessel(0.38, 2.0);
  const padGeo = box(1.0, 0.08, 1.0, 0, 0.04, 0);
  for (const x of [-1.8, -0.8]) unit([x, 0, -3.0], mesh(shiftGeo, reaction), mesh(padGeo, plantPale));

  // Capture: the absorber and the regenerator, with platforms.
  const absorber = unit(
    [0.6, 0, -3.0],
    mesh(vessel(0.45, 5.0), capture),
    ...[1.7, 3.3, 4.6].map((y) => mesh(cyl(0.57, 0.57, 0.05, 8, 0, y, 0), capture)),
  );
  const aAbsorber = anchorAt(absorber, 0, 3.0, 0.45);
  unit(
    [2.2, 0, -3.0],
    mesh(vessel(0.38, 4.2), capture),
    ...[1.5, 3.0].map((y) => mesh(cyl(0.48, 0.48, 0.05, 8, 0, y, 0), capture)),
  );

  // A row of smaller vessels at the back right.
  const smallGeo = vessel(0.22, 1.4);
  for (const x of [3.4, 3.9, 4.4]) unit([x, 0, -3.0], mesh(smallGeo, plant));
  unit([3.9, 0, -3.0], mesh(box(1.7, 0.08, 0.8, 0, 0.04, 0), plantPale));

  // Compressor house for the CO2.
  const houseRoof = mesh(gable(1.8, 1.2, 0.3), capture);
  houseRoof.position.y = 0.9;
  unit([2.5, 0, 2.6], mesh(box(1.8, 0.9, 1.2, 0, 0.45, 0), capture), houseRoof);

  // Wellhead where the CO2 goes into the ground.
  const wellhead = unit(
    [5.6, 0, 4.0],
    mesh(box(1.0, 0.06, 1.0, 0, 0.03, 0), co2Paint),
    mesh(cyl(0.13, 0.13, 0.42, 8, 0, 0.21, 0), co2Paint),
    mesh(box(0.5, 0.1, 0.1, 0, 0.3, 0), co2Paint),
  );
  const aWellhead = anchorAt(wellhead, 0, 0.45, 0);

  // Two storage tanks with low cone roofs.
  const tankGeo = (r: number, h: number) => {
    const V = T.Vector2;
    return keep(new T.LatheGeometry([new V(0, 0), new V(r, 0), new V(r, h), new V(0, h + r * 0.28)], 10));
  };
  unit([-2.2, 0, 3.1], mesh(tankGeo(0.75, 0.9), plant));
  unit([-0.6, 0, 3.3], mesh(tankGeo(0.6, 0.75), plant));

  // Control building and two small skids on the feed and product lines.
  unit([-6.8, 0, -1.2], mesh(box(1.6, 0.8, 1.2, 0, 0.4, 0), plantPale), mesh(box(1.7, 0.06, 1.3, 0, 0.83, 0), plant));
  unit([-7.2, 0, 3.0], mesh(box(0.8, 0.42, 0.6, 0, 0.21, 0), plant));
  unit([6.8, 0, 0.32], mesh(box(0.7, 0.42, 0.55, 0, 0.21, 0), plant));

  // Pipe rack: one bent (two posts, two beams) every 1.2.
  const bentGeo = merge([
    box(0.14, 1.66, 0.14, 0, 0.83, -0.5),
    box(0.14, 1.66, 0.14, 0, 0.83, 0.5),
    box(0.14, 0.1, 1.14, 0, 1.0, 0),
    box(0.14, 0.1, 1.14, 0, 1.6, 0),
  ]);
  for (const x of BENTS) unit([x, 0, 0], mesh(bentGeo, plant));

  // Air cooler on top of the rack, with three fans that turn.
  const fans: THREE.Object3D[] = [];
  const shroudGeo = cyl(0.36, 0.36, 0.12, 10);
  const bladeGeo = merge([box(0.64, 0.02, 0.09, 0, 0, 0), box(0.09, 0.02, 0.64, 0, 0, 0)]);
  const cooler = unit([-2.4, 0, 0], mesh(box(2.5, 0.14, 1.2, 0, 1.97, 0), plant));
  for (const x of [-0.8, 0, 0.8]) {
    const shroud = mesh(shroudGeo, plantPale);
    shroud.position.set(x, 2.1, 0);
    const fan = mesh(bladeGeo, plant);
    fan.position.set(x, 2.18, 0);
    fan.rotation.y = x;
    fans.push(fan);
    cooler.add(shroud, fan);
  }

  // Trees round the edge of the tile (they don't move).
  const treeGeo = merge([cyl(0, 0.42, 0.8, 6, 0, 0.55, 0), cyl(0, 0.3, 0.6, 6, 0, 1.0, 0), cyl(0.06, 0.06, 0.2, 5, 0, 0.1, 0)]);
  const treePaint = paint("ground", F1, 0.6);
  for (const [x, z, s] of TREES) {
    const t = mesh(treeGeo, treePaint);
    t.position.set(x, 0, z);
    t.scale.setScalar(s);
    t.rotation.y = x * 1.3;
    root.add(t);
  }

  // ---- Pipes: segments placed from mapped end points every layout --------------------------
  type Seg = { a: Pt; b: Pt; m: THREE.Mesh; r: number };
  const segs: Seg[] = [];
  const pipeGeo = keep(new T.CylinderGeometry(1, 1, 1, 6, 1));
  const addPipe = (pts: Pt[], p: Paint, r = PIPE_R) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const m = mesh(pipeGeo, p);
      root.add(m);
      segs.push({ a: pts[i], b: pts[i + 1], m, r });
    }
  };
  addPipe(STREAMS.feed, paint("feed", F1, 0.7));
  addPipe(STREAMS.syngas, paint("syngas", F1, 0.7));
  addPipe(STREAMS.h2, paint("h2", F1, 0.7));
  addPipe(STREAMS.co2, paint("co2", F1, 0.7));
  const rackPipe = paint("plant", F1, 0.55);
  for (const [y, z] of RACK_PIPES) addPipe([{ p: [RACK_X[0], y, z] }, { p: [RACK_X[1], y, z] }], rackPipe, 0.07);

  // ---- Plot lines ------------------------------------------------------------------------
  const plotPoints = () => {
    const [x0, z0, x1, z1] = PLOT;
    return [x0, 0.03, z0, x1, 0.03, z0, x1, 0.03, z1, x0, 0.03, z1];
  };
  const plotGeo = keep(new T.BufferGeometry());
  plotGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(plotPoints()), 3));
  const plotMat = new T.LineDashedMaterial({ color: agent, dashSize: 0.32, gapSize: 0.2, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const plot = new T.LineLoop(plotGeo, plotMat);
  plot.computeLineDistances();
  const ghostGeo = keep(new T.BufferGeometry());
  ghostGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(plotPoints()), 3));
  const ghostMat = new T.LineDashedMaterial({ color: ink, dashSize: 0.32, gapSize: 0.2, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const plotGhost = new T.LineLoop(ghostGeo, ghostMat);
  plotGhost.computeLineDistances();
  mats.push(plotMat, ghostMat);
  root.add(plot, plotGhost);

  // ---- Capital bar, on its own small tile to the right -------------------------------------
  const barRoot = new T.Group();
  barRoot.position.set(10.8, 0, 2.8);
  root.add(barRoot);
  const barPaint = paint("bar", F2, 0.9);
  barRoot.add(mesh(box(2.2, TILE.t, 2.2, 0, -TILE.t / 2, 0), paint("bar", F0, 0.9)));
  const BAR_W = 1.3;
  const KEEP_H = 3.4;
  const CUT_H = 1.2;
  barRoot.add(mesh(box(BAR_W, KEEP_H, BAR_W, 0, KEEP_H / 2, 0), barPaint));
  const cutGeo = box(BAR_W, CUT_H - 0.03, BAR_W, 0, KEEP_H + 0.03 + (CUT_H - 0.03) / 2, 0);
  const cutMat = paperMaterial(T, F1);
  cutMat.transparent = true;
  const cutLine = new T.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
  mats.push(cutMat, cutLine);
  const cut = new T.Mesh(cutGeo, cutMat);
  cut.add(new T.LineSegments(keep(new T.EdgesGeometry(cutGeo)), cutLine));
  barRoot.add(cut);
  const ghostBarMat = new T.LineDashedMaterial({ color: agent, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  mats.push(ghostBarMat);
  const ghost = new T.LineSegments(keep(new T.EdgesGeometry(cutGeo)), ghostBarMat);
  ghost.computeLineDistances();
  barRoot.add(ghost);
  const h = BAR_W / 2;
  // The label sits under the tile; the cut figure sits on top of the dashed outline.
  const aBarMid = anchorAt(barRoot, 0, -TILE.t, 1.1);
  const aBarTop = anchorAt(barRoot, 0, KEEP_H, 0);
  const aBarCut = anchorAt(barRoot, 0, KEEP_H + CUT_H + 0.1, -h);

  // ---- Layout ------------------------------------------------------------------------------
  let kx = 1;
  let kz = 1;
  let deepY = STREAMS.co2[STREAMS.co2.length - 1].p[1];
  const world = (pt: Pt, out: THREE.Vector3) => out.set(pt.edge ? pt.p[0] : pt.p[0] * kx, pt.deep ? deepY : pt.p[1], pt.p[2] * kz);

  const A = new T.Vector3();
  const B = new T.Vector3();
  const D = new T.Vector3();
  const UP = new T.Vector3(0, 1, 0);

  type Path = { pts: THREE.Vector3[]; acc: number[]; total: number };
  const paths = {} as Record<StreamName, Path>;
  for (const name of Object.keys(STREAMS) as StreamName[])
    paths[name] = { pts: STREAMS[name].map(() => new T.Vector3()), acc: STREAMS[name].map(() => 0), total: 0 };

  let lastC = -1;
  let lastD = -1;
  function layout(compact: number, depth: number) {
    if (compact === lastC && depth === lastD) return;
    const moved = compact !== lastC;
    lastC = compact;
    lastD = depth;
    kx = 1 - 0.2 * compact;
    kz = 1 - 0.17 * compact;
    const open = depth * DEPTH;
    deepY = -0.45 - Math.max(0, open - 0.35);

    if (moved) for (const u of units) u.obj.position.set(u.base[0] * kx, u.base[1], u.base[2] * kz);

    for (const s of segs) {
      world(s.a, A);
      world(s.b, B);
      D.subVectors(B, A);
      const len = D.length();
      s.m.position.addVectors(A, B).multiplyScalar(0.5);
      if (len > 1e-6) s.m.quaternion.setFromUnitVectors(UP, D.divideScalar(len));
      s.m.scale.set(s.r, len + s.r * 2, s.r);
      s.m.visible = len > 1e-3;
    }

    for (const name of Object.keys(STREAMS) as StreamName[]) {
      const path = paths[name];
      let total = 0;
      STREAMS[name].forEach((pt, i) => {
        world(pt, path.pts[i]);
        if (i > 0) total += path.pts[i].distanceTo(path.pts[i - 1]);
        path.acc[i] = total;
      });
      path.total = total;
    }

    if (moved) {
      const pa = plotGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const base = ghostGeo.attributes.position as THREE.BufferAttribute;
        pa.setXYZ(i, base.getX(i) * kx, base.getY(i), base.getZ(i) * kz);
      }
      pa.needsUpdate = true;
      plot.computeLineDistances();
    }

    block.scale.y = Math.max(open, 0.001);
    block.visible = open > 0.01;
    rock.position.set(0, -TILE.t - open + 0.28, 0);
    rock.visible = open > 0.9;
    storageMark.position.set(STREAMS.co2[STREAMS.co2.length - 1].p[0] * kx, -TILE.t - open, TILE.d / 2);
  }

  function sample(stream: StreamName, s: number, out: THREE.Vector3) {
    const path = paths[stream];
    const n = path.pts.length;
    if (s <= 0) return out.copy(path.pts[0]);
    if (s >= path.total) return out.copy(path.pts[n - 1]);
    let i = 1;
    while (i < n - 1 && path.acc[i] < s) i++;
    const a = path.acc[i - 1];
    const t = (s - a) / (path.acc[i] - a || 1);
    return out.lerpVectors(path.pts[i - 1], path.pts[i], t);
  }

  layout(0, 0);

  return {
    root,
    layout,
    sample,
    length: (stream) => paths[stream].total,
    tint,
    anchors: {
      reformer: aReformer,
      stack: aStack,
      absorber: aAbsorber,
      wellhead: aWellhead,
      storage: storageMark,
      barMid: aBarMid,
      barTop: aBarTop,
      barCut: aBarCut,
    },
    fans,
    plot,
    plotGhost,
    bar: { root: barRoot, cut, cutLine, ghost },
    ground: { block, rock },
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}
