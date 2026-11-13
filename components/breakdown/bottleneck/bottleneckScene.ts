import type * as THREE from "three";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
  createRenderer,
  disposeRenderer,
  isWideStage,
  lerp,
  near,
  ramp,
  readPalette,
  sizeRenderer,
  track,
} from "@/components/breakdown/kit";
import type { BreakdownScene, SceneContext } from "@/components/breakdown/ScrollBreakdown";

/*
  The Bottleneck Radar breakdown: a low-poly globe with land as dots. Scroll position (0 to
  4, one per step) drives everything:

  0  the money: close on the US from the south, five capex bars rise over it
  1  money becomes hardware: the bars sink and four stacks rise in their place (power, GPUs,
     HBM, turbines)
  2  where each part is made: the camera pulls back over the North Pacific, markers light
     where each supply figure comes from
  3  the arcs: arcs run from each origin to Texas and Northern Virginia, the tightest in blue
  4  the call: close on Korea from the south, the blue marker grows into this month's bar,
     with a ghost bar for next month and a dashed line that would prove the call wrong

  Blue marks what each step is about. The call shown is an example, not a month's result.
  Labels are HTML over the canvas, placed from projected 3D points every frame; the rim of
  the globe is an SVG circle behind the canvas.
*/

type Three = typeof THREE;

/** The three.js line addons, loaded next to three.js, for edges wider than 1px. */
export type LineModules = {
  LineSegments2: typeof import("three/examples/jsm/lines/LineSegments2.js").LineSegments2;
  LineSegmentsGeometry: typeof import("three/examples/jsm/lines/LineSegmentsGeometry.js").LineSegmentsGeometry;
  LineMaterial: typeof import("three/examples/jsm/lines/LineMaterial.js").LineMaterial;
};

export type TagKey =
  | "amazon"
  | "alphabet"
  | "microsoft"
  | "meta"
  | "oracle"
  | "power"
  | "gpus"
  | "hbm"
  | "turbines"
  | "korea"
  | "taiwan"
  | "takasago"
  | "berlin"
  | "greenville"
  | "queue"
  | "texas"
  | "virginia"
  | "tightest"
  | "call"
  | "next"
  | "line";
export type NoteKey = "capex";

export type Pin = { el: HTMLElement; line: SVGLineElement; dot: SVGCircleElement };

export type BottleneckDom = {
  rim: SVGCircleElement;
  threshold: SVGPathElement;
  tags: Record<TagKey, Pin>;
  notes: Record<NoteKey, HTMLElement>;
};

/* ---------- places and data ---------- */

type PlaceKey = "korea" | "taiwan" | "takasago" | "berlin" | "greenville" | "texas" | "virginia";
/** The dashboard's own coordinates (src/radar/site.py in the bottleneck-radar repo). */
const PLACES: Record<PlaceKey, [number, number]> = {
  korea: [37.27, 127.44],
  taiwan: [24.8, 120.97],
  takasago: [34.75, 134.79],
  berlin: [52.52, 13.4],
  greenville: [34.85, -82.4],
  texas: [32.45, -99.73],
  virginia: [39.04, -77.49],
};
type Input = "memory" | "chips" | "turbines" | "grid";
/** The example call drawn in blue. The real one changes each month. */
const CALL: Input = "memory";
/** The same arcs the dashboard draws, from where each input is made to the two markets. */
const ARCS: { from: PlaceKey; to: PlaceKey; input: Input }[] = [
  { from: "korea", to: "texas", input: "memory" },
  { from: "korea", to: "virginia", input: "memory" },
  { from: "taiwan", to: "texas", input: "chips" },
  { from: "taiwan", to: "virginia", input: "chips" },
  { from: "greenville", to: "texas", input: "turbines" },
  { from: "greenville", to: "virginia", input: "turbines" },
  { from: "berlin", to: "virginia", input: "turbines" },
  { from: "takasago", to: "texas", input: "turbines" },
];
const ORIGINS: { place: PlaceKey; input: Input; tag: TagKey }[] = [
  { place: "korea", input: "memory", tag: "korea" },
  { place: "taiwan", input: "chips", tag: "taiwan" },
  { place: "takasago", input: "turbines", tag: "takasago" },
  { place: "berlin", input: "turbines", tag: "berlin" },
  { place: "greenville", input: "turbines", tag: "greenville" },
  { place: "texas", input: "grid", tag: "queue" },
];

/**
 * Capex over the four quarters to mid-2026, in $B, from the September 2026 run's
 * demand.json. Only the bars' relative heights use it.
 */
const COMPANIES: { key: TagKey; capex: number }[] = [
  { key: "amazon", capex: 173 },
  { key: "alphabet", capex: 132 },
  { key: "microsoft", capex: 116 },
  { key: "meta", capex: 89 },
  { key: "oracle", capex: 76 },
];
const ROW_LAT = 38.4;
const BAR_LNG = [-113, -105.5, -98, -90.5, -83];
const STACK_LNG = [-111, -101.5, -92, -82.5];
const BAR_MAX = 0.2;
const BAR_W = 0.045;
/** The ghost bar for next month's figure, west of the Korea marker, clear of its arcs. */
const GHOST: [number, number] = [36.6, 123.2];
const CALL_H = 0.2;
const GHOST_H = 0.15;
const LINE_H = 0.12;

/* ---------- views ---------- */

/** left, top, right, bottom of the stage, as fractions. */
type Frame = [number, number, number, number];
/** A view: the camera looks at the globe's centre from above lat/lng. */
type ViewSpec =
  /** The whole globe, its radius a fraction of the stage's short side, its centre at cx, cy. */
  | { lat: number; lng: number; whole: { rad: number; cx: number; cy: number } }
  /** Close in: the region and what stands on it fitted into a frame on the stage. */
  | { lat: number; lng: number; fit: "us"; frame: { tall: Frame; wide: Frame } }
  /** Close in by hand: globe radius as above, with one place put at a spot on the stage. */
  | { lat: number; lng: number; focus: { rad: number; at: [number, number]; place: [number, number] } };

// Longitudes are unwrapped so each turn takes the short way round: -195 is 165 E.
// Step 2 centres East Asia; Texas, Greenville and Berlin sit near the rim, still in sight.
// Step 3 turns east over the Pacific so the arcs cross the middle of the globe.
const VIEWS: ViewSpec[] = [
  { lat: -4, lng: -97, fit: "us", frame: { tall: [0.06, 0.2, 0.94, 0.86], wide: [0.04, 0.24, 0.96, 0.92] } },
  { lat: -4, lng: -97, fit: "us", frame: { tall: [0.06, 0.2, 0.94, 0.86], wide: [0.04, 0.24, 0.96, 0.92] } },
  { lat: 40, lng: -195, whole: { rad: 0.355, cx: 0.5, cy: 0.52 } },
  { lat: 52, lng: -174, whole: { rad: 0.355, cx: 0.5, cy: 0.53 } },
  { lat: 0, lng: -232, focus: { rad: 0.8, at: [0.46, 0.6], place: [36.2, 128] } },
];
/** The globe's radius on the stage in whole views on phones, as a fraction of the short side. */
const WIDE_RAD = 0.3;
const FOV = 11;
const DEG = Math.PI / 180;

type Dir = [number, number];

export function createBottleneckScene(
  T: Three,
  ctx: SceneContext,
  dom: BottleneckDom,
  fat: LineModules,
  land: Float32Array,
): BreakdownScene {
  const { canvas, host, position, reducedMotion, invalidate } = ctx;
  const palette = readPalette(host);
  const renderer = createRenderer(T, canvas);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(FOV, 1, 0.05, 100);
  scene.add(camera);

  // Soft daylight, with the key fixed to the camera so the shading holds as the globe turns.
  const hemi = new T.HemisphereLight(0xffffff, 0xcfd4dc, 2.35);
  const key = new T.DirectionalLight(0xffffff, 1.0);
  key.position.set(-1.4, 2.2, 1.6);
  camera.add(key);
  scene.add(hemi);

  const ink = new T.Color(palette.ink);
  const blue = new T.Color(palette.agent);
  const fillA = new T.Color(palette.fills[0]);
  const fillB = new T.Color(palette.fills[1]);
  const fillC = new T.Color(palette.fills[2]);
  const blueFill = new T.Color(palette.agent).lerp(new T.Color("#ffffff"), 0.3);

  // ---- helpers ------------------------------------------------------------------------
  const surface = (lat: number, lng: number, r: number, out: THREE.Vector3) => {
    const p = lat * DEG;
    const l = lng * DEG;
    return out.set(r * Math.cos(p) * Math.sin(l), r * Math.sin(p), r * Math.cos(p) * Math.cos(l));
  };
  const m4 = new T.Matrix4();
  const vE = new T.Vector3();
  const vN = new T.Vector3();
  const vS = new T.Vector3();
  /** A group standing on the globe at lat/lng: local y points out, x east, z south. */
  const standAt = (lat: number, lng: number) => {
    const g = new T.Group();
    const l = lng * DEG;
    surface(lat, lng, 1, vN).normalize();
    vE.set(Math.cos(l), 0, -Math.sin(l));
    vS.crossVectors(vE, vN);
    g.quaternion.setFromRotationMatrix(m4.makeBasis(vE, vN, vS));
    surface(lat, lng, 1, g.position);
    return g;
  };

  const lineMats: LineMaterial[] = [];
  const lineMat = (color: THREE.Color, width: number, opacity = 1) => {
    const m = new fat.LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false });
    m.toneMapped = false;
    lineMats.push(m);
    return m;
  };
  const edgeGeos: LineSegmentsGeometry[] = [];
  /** Ink outlines on a mesh's hard edges, as wide lines, added as a child. */
  const outline = (mesh: THREE.Mesh, mat: LineMaterial) => {
    const eg = new T.EdgesGeometry(mesh.geometry, 20);
    const geo = new fat.LineSegmentsGeometry().fromEdgesGeometry(eg);
    eg.dispose();
    edgeGeos.push(geo);
    const l = new fat.LineSegments2(geo, mat);
    l.raycast = () => {};
    mesh.add(l);
    return l;
  };
  const solid = (color: THREE.Color) =>
    new T.MeshLambertMaterial({
      color,
      flatShading: true,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

  /** A part that can be tinted blue and faded: its fill material and its edge material. */
  type Part = { mat: THREE.MeshLambertMaterial; edge: LineMaterial; base: THREE.Color };
  const parts: Part[] = [];
  const part = (geo: THREE.BufferGeometry, base: THREE.Color, width = 1.25) => {
    const mat = solid(base);
    const edge = lineMat(ink, width);
    const mesh = new T.Mesh(geo, mat);
    outline(mesh, edge);
    const p: Part = { mat, edge, base };
    parts.push(p);
    return { mesh, part: p };
  };
  const shade = (p: Part, blueAmount: number, opacity = 1) => {
    p.mat.color.copy(p.base).lerp(blueFill, blueAmount);
    p.mat.opacity = opacity;
    p.mat.depthWrite = opacity > 0.6;
    p.edge.color.copy(ink).lerp(blue, blueAmount * 0.75);
    p.edge.opacity = opacity;
  };

  // ---- the globe ----------------------------------------------------------------------
  const globeGeo = new T.IcosahedronGeometry(1, 6);
  const globeMat = new T.MeshLambertMaterial({
    color: fillA,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const globe = new T.Mesh(globeGeo, globeMat);
  scene.add(globe);
  // The facets, very faint, so the globe reads as low-poly.
  const facetGeo = new T.EdgesGeometry(globeGeo, 1);
  const facetMat = new T.LineBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.07, depthWrite: false });
  globe.add(new T.LineSegments(facetGeo, facetMat));

  // Land: one small hexagon per dot, flat on the surface.
  const dotCount = land.length / 2;
  const dotGeo = new T.CircleGeometry(1, 6);
  const dotMat = new T.MeshBasicMaterial({ color: new T.Color("#8f949c"), toneMapped: false });
  const dots = new T.InstancedMesh(dotGeo, dotMat, Math.max(1, dotCount));
  dots.count = dotCount;
  {
    const q = new T.Quaternion();
    const zAxis = new T.Vector3(0, 0, 1);
    const pos = new T.Vector3();
    const n = new T.Vector3();
    const s = new T.Vector3(0.0057, 0.0057, 0.0057);
    for (let i = 0; i < dotCount; i++) {
      surface(land[i * 2], land[i * 2 + 1], 1, n);
      n.normalize();
      q.setFromUnitVectors(zAxis, n);
      pos.copy(n).multiplyScalar(1.0016);
      dots.setMatrixAt(i, m4.compose(pos, q, s));
    }
    dots.instanceMatrix.needsUpdate = true;
  }
  scene.add(dots);

  // ---- step 0: capex bars over the US ---------------------------------------------------
  const boxGeo = new T.BoxGeometry(BAR_W, 1, BAR_W).translate(0, 0.5, 0);
  const bars = COMPANIES.map((c, i) => {
    const g = standAt(ROW_LAT, BAR_LNG[i]);
    const { mesh, part: p } = part(boxGeo, fillB, 1.25);
    g.add(mesh);
    scene.add(g);
    return { key: c.key, g, mesh, part: p, h: (BAR_MAX * c.capex) / COMPANIES[0].capex };
  });

  // ---- step 1: four stacks, one per kind of hardware -------------------------------------
  type Stack = { key: TagKey; g: THREE.Group; units: THREE.Mesh[]; parts: Part[]; top: number };
  const stackGeos: THREE.BufferGeometry[] = [];
  const keep = <G extends THREE.BufferGeometry>(geo: G) => {
    stackGeos.push(geo);
    return geo;
  };
  function buildStack(key: TagKey, lng: number, units: { geo: THREE.BufferGeometry; y: number; color: THREE.Color }[], top: number): Stack {
    const g = standAt(ROW_LAT, lng);
    const meshes: THREE.Mesh[] = [];
    const ps: Part[] = [];
    for (const u of units) {
      const { mesh, part: p } = part(u.geo, u.color, 1.15);
      mesh.position.y = u.y;
      g.add(mesh);
      meshes.push(mesh);
      ps.push(p);
    }
    scene.add(g);
    return { key, g, units: meshes, parts: ps, top };
  }
  // Power: a tapered tower in three sections.
  const tower = [0, 1, 2].map((k) => {
    const r0 = 0.04 - k * 0.0085;
    const r1 = r0 - 0.0085;
    return keep(new T.CylinderGeometry(r1, r0, 0.07, 4, 1).rotateY(Math.PI / 4).translate(0, 0.035, 0));
  });
  const power = buildStack(
    "power",
    STACK_LNG[0],
    tower.map((geo, k) => ({ geo, y: k * 0.072, color: k % 2 ? fillC : fillB })),
    0.216,
  );
  // GPUs: flat boards, like trays in a rack.
  const board = keep(new T.BoxGeometry(0.075, 0.022, 0.055).translate(0, 0.011, 0));
  const gpus = buildStack(
    "gpus",
    STACK_LNG[1],
    [0, 1, 2, 3, 4, 5].map((k) => ({ geo: board, y: k * 0.031, color: k % 2 ? fillC : fillB })),
    0.18,
  );
  // HBM: thin dies stacked on a base, which is what high-bandwidth memory is.
  const base = keep(new T.BoxGeometry(0.07, 0.014, 0.06).translate(0, 0.007, 0));
  const die = keep(new T.BoxGeometry(0.042, 0.0125, 0.042).translate(0, 0.00625, 0));
  const hbm = buildStack(
    "hbm",
    STACK_LNG[2],
    [{ geo: base, y: 0, color: fillC }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ geo: die, y: 0.016 + k * 0.0155, color: fillB }))],
    0.14,
  );
  // Gas turbines: three horizontal drums, stacked.
  const drum = keep(new T.CylinderGeometry(0.024, 0.024, 0.085, 8, 1).rotateZ(Math.PI / 2).translate(0, 0.024, 0));
  const turbines = buildStack(
    "turbines",
    STACK_LNG[3],
    [0, 1, 2].map((k) => ({ geo: drum, y: k * 0.05, color: k % 2 ? fillC : fillB })),
    0.148,
  );
  const stacks = [power, gpus, hbm, turbines];

  // ---- steps 2 to 4: markers where things are made, and the two markets ----------------------
  const hexGeo = new T.CylinderGeometry(0.024, 0.024, 1, 6, 1).translate(0, 0.5, 0);
  const MARK_H = 0.032;
  const markers = {} as Record<PlaceKey, { g: THREE.Group; mesh: THREE.Mesh; part: Part }>;
  for (const k of Object.keys(PLACES) as PlaceKey[]) {
    const [lat, lng] = PLACES[k];
    const g = standAt(lat, lng);
    const { mesh, part: p } = part(hexGeo, fillB, 1.25);
    mesh.scale.y = MARK_H;
    g.add(mesh);
    scene.add(g);
    markers[k] = { g, mesh, part: p };
  }
  // Next month's figure: a dashed outline, since nobody knows it yet. Built at its real
  // height so the dashes keep their length.
  const ghostGeo = keep(new T.CylinderGeometry(0.024, 0.024, GHOST_H, 6, 1).translate(0, GHOST_H / 2, 0));
  const ghost = (() => {
    const g = standAt(GHOST[0], GHOST[1]);
    const mat = solid(fillA);
    const edge = lineMat(ink, 1.25);
    edge.dashed = true;
    edge.dashSize = 0.011;
    edge.gapSize = 0.008;
    const mesh = new T.Mesh(ghostGeo, mat);
    const lines = outline(mesh, edge);
    lines.computeLineDistances();
    g.add(mesh);
    scene.add(g);
    return { g, mesh, mat, edge };
  })();

  // ---- arcs ---------------------------------------------------------------------------
  const SEG = 56;
  const a3 = new T.Vector3();
  const b3 = new T.Vector3();
  const p3 = new T.Vector3();
  /** A point along the great circle from a to b, lifted off the surface in the middle. */
  const arcPoint = (a: THREE.Vector3, b: THREE.Vector3, omega: number, lift: number, t: number, out: THREE.Vector3) => {
    const s = Math.sin(omega) || 1;
    out
      .copy(a)
      .multiplyScalar(Math.sin((1 - t) * omega) / s)
      .addScaledVector(b, Math.sin(t * omega) / s);
    return out.multiplyScalar(1.004 + lift * Math.sin(Math.PI * t));
  };
  const arcs = ARCS.map((arc) => {
    surface(...PLACES[arc.from], 1, a3);
    surface(...PLACES[arc.to], 1, b3);
    const omega = a3.angleTo(b3);
    const lift = 0.03 + 0.3 * (omega / Math.PI);
    const pos = new Float32Array(SEG * 6);
    for (let i = 0; i < SEG; i++) {
      arcPoint(a3, b3, omega, lift, i / SEG, p3).toArray(pos, i * 6);
      arcPoint(a3, b3, omega, lift, (i + 1) / SEG, p3).toArray(pos, i * 6 + 3);
    }
    const geo = new fat.LineSegmentsGeometry();
    geo.setPositions(pos);
    edgeGeos.push(geo);
    const isCall = arc.input === CALL;
    const mat = lineMat(isCall ? blue : ink, isCall ? 2.25 : 1.4);
    const line: LineSegments2 = new fat.LineSegments2(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 2;
    scene.add(line);
    return { ...arc, a: a3.clone(), b: b3.clone(), omega, lift, geo, mat, line, isCall };
  });
  // A bead runs along each arc once it is drawn.
  const beadGeo = new T.IcosahedronGeometry(1, 0);
  const beadMat = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const beads = new T.InstancedMesh(beadGeo, beadMat, arcs.length);
  beads.frustumCulled = false;
  arcs.forEach((a, i) => beads.setColorAt(i, a.isCall ? blue : ink));
  if (beads.instanceColor) beads.instanceColor.needsUpdate = true;
  scene.add(beads);

  // ---- drag to turn, with a little inertia ------------------------------------------------
  let dragLng = 0;
  let vel = 0;
  let dragging: { id: number; x: number; t: number } | null = null;
  const SENS = 0.28;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = { id: e.pointerId, x: e.clientX, t: e.timeStamp };
    vel = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.dataset.dragging = "";
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const d = -(e.clientX - dragging.x) * SENS;
    const dt = Math.max((e.timeStamp - dragging.t) / 1000, 1 / 240);
    dragLng = Math.max(-150, Math.min(150, dragLng + d));
    vel = vel * 0.5 + (d / dt) * 0.5;
    dragging.x = e.clientX;
    dragging.t = e.timeStamp;
    invalidate();
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    if ((e.timeStamp - dragging.t) / 1000 > 0.1 || reducedMotion) vel = 0;
    vel = Math.max(-200, Math.min(200, vel));
    dragging = null;
    delete canvas.dataset.dragging;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  // ---- layout and views -----------------------------------------------------------------
  let width = 1;
  let height = 1;
  let wide = false;
  let focal = 1;
  const sizes = new Map<HTMLElement, { w: number; h: number }>();
  type Cam = { lat: number; lng: number; d: number; ox: number; oy: number };
  let views: Cam[] = [];

  const camX = new T.Vector3();
  const camY = new T.Vector3();
  const camZ = new T.Vector3();
  const UP = new T.Vector3(0, 1, 0);
  function basis(lat: number, lng: number) {
    surface(lat, lng, 1, camZ).normalize();
    camX.crossVectors(UP, camZ).normalize();
    camY.crossVectors(camZ, camX);
  }

  /** World points the US close-up must show: the country's outline and everything standing on it. */
  function fitPoints(): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const add = (lat: number, lng: number, r = 1) => pts.push(surface(lat, lng, r, new T.Vector3()));
    for (const [lat, lng] of [
      [48.5, -124.5],
      [48.5, -95],
      [45, -68],
      [40.5, -74],
      [30, -81.3],
      [25.3, -80.4],
      [29.5, -94],
      [24, -98],
      [30, -116],
      [40, -124.3],
    ])
      add(lat, lng);
    BAR_LNG.forEach((lng, i) => add(ROW_LAT, lng, 1 + bars[i].h));
    STACK_LNG.forEach((lng, i) => add(ROW_LAT, lng, 1 + stacks[i].top));
    return pts;
  }

  function focusView(spec: Extract<ViewSpec, { focus: object }>): Cam {
    const { rad, at, place } = spec.focus;
    const r = (wide ? rad * 1.3 : rad) * Math.min(width, height);
    const d = 1 / Math.sin(Math.atan(r / focal));
    basis(spec.lat, spec.lng);
    const q = surface(place[0], place[1], 1, new T.Vector3());
    const depth = d - q.dot(camZ);
    const sx = width / 2 + (focal * q.dot(camX)) / depth;
    const sy = height / 2 - (focal * q.dot(camY)) / depth;
    return { lat: spec.lat, lng: spec.lng, d, ox: sx - at[0] * width, oy: sy - at[1] * height };
  }

  function fitView(spec: Extract<ViewSpec, { fit: "us" }>): Cam {
    basis(spec.lat, spec.lng);
    const pts = fitPoints();
    const f = wide ? spec.frame.wide : spec.frame.tall;
    const fw = (f[2] - f[0]) * width;
    const fh = (f[3] - f[1]) * height;
    let zMax = 0;
    for (const q of pts) zMax = Math.max(zMax, q.dot(camZ));
    const box = (d: number) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const q of pts) {
        const depth = d - q.dot(camZ);
        const sx = width / 2 + (focal * q.dot(camX)) / depth;
        const sy = height / 2 - (focal * q.dot(camY)) / depth;
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
      }
      return { x0, x1, y0, y1 };
    };
    let lo = zMax + 0.08;
    let hi = 40;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      const b = box(mid);
      if (b.x1 - b.x0 <= fw && b.y1 - b.y0 <= fh) hi = mid;
      else lo = mid;
    }
    const b = box(hi);
    return {
      lat: spec.lat,
      lng: spec.lng,
      d: hi,
      ox: (b.x0 + b.x1) / 2 - ((f[0] + f[2]) / 2) * width,
      oy: (b.y0 + b.y1) / 2 - ((f[1] + f[3]) / 2) * height,
    };
  }

  function wholeView(spec: Extract<ViewSpec, { whole: object }>): Cam {
    const rad = wide ? WIDE_RAD : spec.whole.rad;
    const r = rad * Math.min(width, height);
    const alpha = Math.atan(r / focal);
    return {
      lat: spec.lat,
      lng: spec.lng,
      d: 1 / Math.sin(alpha),
      ox: width / 2 - spec.whole.cx * width,
      oy: height / 2 - spec.whole.cy * height,
    };
  }

  function resize() {
    const size = sizeRenderer(renderer, camera);
    if (!size) return;
    width = size.width;
    height = size.height;
    wide = isWideStage(width, height);
    focal = height / 2 / Math.tan((FOV * DEG) / 2);
    for (const m of lineMats) m.resolution.set(width, height);
    views = VIEWS.map((v) => ("whole" in v ? wholeView(v) : "focus" in v ? focusView(v) : fitView(v)));
    sizes.clear();
  }
  const measure = (el: HTMLElement) => {
    let s = sizes.get(el);
    if (!s || !s.w) {
      s = { w: el.offsetWidth, h: el.offsetHeight };
      sizes.set(el, s);
    }
    return s;
  };

  // ---- camera ------------------------------------------------------------------------------
  const cur: Cam & { set: boolean } = { lat: 0, lng: 0, d: 3, ox: 0, oy: 0, set: false };
  const goal: Cam = { lat: 0, lng: 0, d: 3, ox: 0, oy: 0 };
  const camKeys = ["lat", "lng", "d", "ox", "oy"] as const;
  /** The globe's centre and radius on the stage this frame. */
  const disc = { x: 0, y: 0, r: 0 };

  function placeCamera(dt: number, p: number, sway: number) {
    for (const k of camKeys) goal[k] = track(views.map((v) => v[k]), p);
    const e = !cur.set || reducedMotion || dt === 0 ? 1 : 1 - Math.exp(-dt * 6);
    for (const k of camKeys) cur[k] = lerp(cur[k], goal[k], e);
    cur.set = true;
    basis(cur.lat, cur.lng + dragLng + sway);
    camera.position.copy(camZ).multiplyScalar(cur.d);
    camera.up.copy(UP);
    camera.lookAt(0, 0, 0);
    camera.setViewOffset(width, height, cur.ox, cur.oy, width, height);
    camera.updateMatrixWorld(true);
    disc.x = width / 2 - cur.ox;
    disc.y = height / 2 - cur.oy;
    disc.r = focal * Math.tan(Math.asin(Math.min(1, 1 / cur.d)));
  }

  // ---- story state ---------------------------------------------------------------------------
  /** 0 to 1 over the first 1.4 s on screen, by the clock: the bars rise once, on arrival. */
  let grow = reducedMotion ? 1 : 0;
  let riseStart = 0;
  const sTmp = new T.Vector3();
  function apply(p: number, time: number, rise: number) {
    // Step 0: the bars rise when the globe first comes into view, and sink on the way to step 1.
    const barsOn = rise * (1 - ramp(p, 0.12, 0.48));
    for (const b of bars) {
      b.g.visible = barsOn > 0.005;
      b.mesh.scale.y = Math.max(0.0001, b.h * barsOn);
      shade(b.part, 1);
    }

    // Step 1: the stacks build up unit by unit, then go as the camera pulls away.
    const stacksOn = ramp(p, 0.5, 0.88) * (1 - ramp(p, 1.2, 1.5));
    for (const s of stacks) {
      s.g.visible = stacksOn > 0.005;
      const n = s.units.length;
      s.units.forEach((u, k) => {
        const on = ramp(stacksOn * (n + 1) - k, 0, 1.2);
        u.visible = on > 0.01;
        u.scale.setScalar(Math.max(0.0001, on));
      });
      for (const pt of s.parts) shade(pt, 1);
    }

    // Steps 2 to 4: markers. The call's origin stays blue; the rest go back to ink after step 2.
    const marksOn = ramp(p, 1.4, 1.85);
    // At step 4 everything but the call goes, so the close-up shows only the call.
    const others = 1 - ramp(p, 3.15, 3.6);
    for (const o of ORIGINS) {
      const m = markers[o.place];
      const isCall = o.input === CALL;
      const on = marksOn * (isCall || o.place === "texas" ? 1 : others);
      m.g.visible = on > 0.005;
      m.g.scale.setScalar(Math.max(0.0001, marksOn));
      shade(m.part, isCall ? 1 : near(p, 2), isCall ? 1 : on);
    }
    // Northern Virginia comes in with the arcs.
    const va = markers.virginia;
    const vaOn = ramp(p, 2.25, 2.7);
    va.g.visible = vaOn > 0.005;
    va.g.scale.setScalar(Math.max(0.0001, vaOn));
    shade(va.part, 0, 1);
    // Step 4: the call's marker grows into this month's bar.
    const callUp = ramp(p, 3.2, 3.75);
    markers.korea.mesh.scale.y = lerp(MARK_H, CALL_H, callUp);
    const ghostOn = ramp(p, 3.35, 3.85);
    ghost.g.visible = ghostOn > 0.005;
    ghost.mat.opacity = 0.6 * ghostOn;
    ghost.mat.depthWrite = false;
    ghost.edge.opacity = 0.9 * ghostOn;

    // Step 3: arcs draw out from each origin; at step 4 all but the call's fade.
    const reveal = ramp(p, 2.2, 2.85);
    const fadeOthers = others;
    arcs.forEach((a, i) => {
      const k = Math.round(SEG * ramp(reveal * 1.25 - (i % 4) * 0.06, 0, 1));
      a.line.visible = k > 0 && (a.isCall || fadeOthers > 0.01);
      a.geo.instanceCount = k;
      a.mat.opacity = a.isCall ? 1 : fadeOthers;
      // The bead.
      const showBead = !reducedMotion && reveal > 0.98 && (a.isCall || fadeOthers > 0.5);
      const t = (time * 0.16 + i * 0.137) % 1;
      arcPoint(a.a, a.b, a.omega, a.lift, t, sTmp);
      const r = showBead ? (a.isCall ? 0.0125 : 0.009) * Math.min(1, t / 0.06, (1 - t) / 0.06) : 0;
      beads.setMatrixAt(i, m4.makeScale(Math.max(r, 1e-5), Math.max(r, 1e-5), Math.max(r, 1e-5)).setPosition(sTmp));
    });
    beads.instanceMatrix.needsUpdate = true;
    beads.visible = !reducedMotion && reveal > 0.98;
  }

  // ---- overlays ------------------------------------------------------------------------------
  const v = new T.Vector3();
  const pv = new T.Vector3();
  const f1 = (n: number) => n.toFixed(1);
  const setOpacity = (el: HTMLElement | SVGElement, o: number) => {
    el.style.opacity = o > 0.01 ? o.toFixed(3) : "0";
  };
  type R = { l: number; t: number; r: number; b: number };
  const placed: R[] = [];
  const clash = (a: R) => placed.some((q) => a.l < q.r + 6 && a.r > q.l - 6 && a.t < q.b + 3 && a.b > q.t - 3);
  const ray = new T.Vector3();
  /** Projects a world point to stage pixels. Returns false when the globe hides it. */
  const toScreen = (w: THREE.Vector3, out: { x: number; y: number }) => {
    pv.copy(w).project(camera);
    out.x = ((pv.x + 1) / 2) * width;
    out.y = ((1 - pv.y) / 2) * height;
    // Hidden if the line of sight meets the globe before it reaches the point.
    const C = camera.position;
    ray.subVectors(w, C);
    const D = ray.length();
    ray.divideScalar(D || 1);
    const b = ray.dot(C);
    const disc2 = b * b - (C.lengthSq() - 1);
    if (disc2 < 0) return true;
    return -b - Math.sqrt(disc2) > D - 0.006;
  };
  const sp = { x: 0, y: 0 };

  /**
   * A label with a thin leader from a stage point, pushed along dir until it is clear.
   * Returns the label's box, or null when it is hidden.
   */
  function pin(c: Pin, x: number, y: number, dir: Dir, len: number, o: number, down = false): R | null {
    setOpacity(c.el, o);
    setOpacity(c.line, o);
    setOpacity(c.dot, o);
    if (o <= 0.01) return null;
    const { w, h } = measure(c.el);
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    const ux = dir[0] / dl;
    const uy = dir[1] / dl;
    const side = Math.abs(ux) > Math.abs(uy) * 1.2;
    let L = len;
    let shift = 0;
    let box: R = { l: 0, t: 0, r: 0, b: 0 };
    for (let tries = 0; tries < 10; tries++) {
      const ex = x + ux * L;
      const ey = y + uy * L;
      let left: number;
      let top: number;
      if (!side) {
        left = ex - w / 2 + ux * w * 0.4;
        top = uy < 0 ? ey - h : ey;
      } else {
        left = ux < 0 ? ex - w : ex;
        top = ey - h / 2 + shift;
      }
      left = Math.min(Math.max(left, 4), width - w - 4);
      top = Math.min(Math.max(top, 4), height - h - 4);
      box = { l: left, t: top, r: left + w, b: top + h };
      if (!clash(box)) break;
      if (side) shift += (down || uy >= 0 ? 1 : -1) * (h + 4);
      else L += h + 5;
    }
    placed.push(box);
    c.el.style.transform = `translate3d(${f1(box.l)}px, ${f1(box.t)}px, 0)`;
    const lx = Math.min(Math.max(x, box.l), box.r);
    const ly = Math.min(Math.max(y, box.t), box.b);
    c.line.setAttribute("x1", f1(x));
    c.line.setAttribute("y1", f1(y));
    c.line.setAttribute("x2", f1(lx));
    c.line.setAttribute("y2", f1(ly));
    c.dot.setAttribute("cx", f1(x));
    c.dot.setAttribute("cy", f1(y));
    return box;
  }

  type Radial = { c: Pin; x: number; y: number; ux: number; uy: number; len: number; o: number };
  const radials: Radial[] = [];
  /**
   * Queues a label for a point on the globe, to go just outside the rim along the line from
   * the centre. placeRadials() then sets them in order down each side, so leaders don't cross.
   */
  function radial(c: Pin, world: THREE.Vector3, o: number, gap = 18) {
    const seen = toScreen(world, sp);
    const dx = sp.x - disc.x;
    const dy = sp.y - disc.y;
    const dist = Math.hypot(dx, dy) || 1;
    radials.push({ c, x: sp.x, y: sp.y, ux: dx / dist, uy: dy / dist, len: Math.max(14, disc.r - dist + gap), o: seen ? o : 0 });
  }
  function placeRadials() {
    // Top and bottom labels first, left to right; then each side from the top down.
    const rank = (r: Radial) => (Math.abs(r.ux) > Math.abs(r.uy) * 1.2 ? 1 : 0);
    radials.sort((a, b) => rank(a) - rank(b) || (rank(a) ? a.y - b.y : a.x - b.x));
    for (const r of radials) pin(r.c, r.x, r.y, [r.ux, r.uy], r.len, r.o, true);
    radials.length = 0;
  }

  const bp = { x: 0, y: 0 };
  /** A label above a part standing on the globe, along the screen direction it stands in. */
  function above(c: Pin, base: THREE.Vector3, top: THREE.Vector3, o: number, len: number) {
    toScreen(base, bp);
    const seen = toScreen(top, sp);
    let ux = sp.x - bp.x;
    let uy = sp.y - bp.y;
    const l = Math.hypot(ux, uy) || 1;
    ux /= l;
    uy /= l;
    // Lean toward straight up, so labels in a row line up.
    return pin(c, sp.x, sp.y, [ux * 0.35, Math.min(uy, -0.6)], len, seen ? o : 0);
  }

  const markerTop = (k: PlaceKey, out: THREE.Vector3) => {
    const m = markers[k];
    return surface(PLACES[k][0], PLACES[k][1], 1 + m.mesh.scale.y * m.g.scale.y + 0.004, out);
  };
  const baseV = new T.Vector3();

  function overlays(p: number) {
    placed.length = 0;
    const s = Math.min(1, Math.max(0.7, width / 640));

    // The rim, behind the canvas.
    dom.rim.setAttribute("cx", f1(disc.x));
    dom.rim.setAttribute("cy", f1(disc.y));
    dom.rim.setAttribute("r", f1(disc.r));

    // Step 0: company names over the bars, and a note on what they measure.
    const w0 = near(p, 0) * ramp(grow, 0.5, 1);
    let topMost = Infinity;
    bars.forEach((b, i) => {
      surface(ROW_LAT, BAR_LNG[i], 1, baseV);
      surface(ROW_LAT, BAR_LNG[i], 1 + b.mesh.scale.y, v);
      const box = above(dom.tags[b.key], baseV, v, w0, 14 * s);
      if (box) topMost = Math.min(topMost, box.t);
    });
    {
      const el = dom.notes.capex;
      setOpacity(el, w0);
      if (w0 > 0.01 && Number.isFinite(topMost)) {
        const { w, h } = measure(el);
        surface(ROW_LAT, (BAR_LNG[0] + BAR_LNG[BAR_LNG.length - 1]) / 2, 1, v);
        toScreen(v, sp);
        const left = Math.min(Math.max(sp.x - w / 2, 4), width - w - 4);
        const top = Math.max(4, topMost - h - 10);
        el.style.transform = `translate3d(${f1(left)}px, ${f1(top)}px, 0)`;
      }
    }

    // Step 1: what each stack stands for.
    const w1 = near(p, 1) * ramp(p, 0.75, 0.95);
    stacks.forEach((st, i) => {
      surface(ROW_LAT, STACK_LNG[i], 1, baseV);
      surface(ROW_LAT, STACK_LNG[i], 1 + st.top, v);
      above(dom.tags[st.key], baseV, v, w1, 14 * s);
    });

    // Step 2: what is read at each place. On phones, one label covers the turbine makers.
    const w2 = near(p, 2);
    for (const o of ORIGINS) {
      const hidden = wide && (o.tag === "berlin" || o.tag === "greenville");
      radial(dom.tags[o.tag], markerTop(o.place, v), hidden ? 0 : w2);
    }

    // Step 3: the two markets, and the tightest input.
    const w3 = near(p, 3);
    radial(dom.tags.tightest, markerTop("korea", v), w3);
    radial(dom.tags.texas, markerTop("texas", v), w3);
    radial(dom.tags.virginia, markerTop("virginia", v), w3);
    placeRadials();

    // Step 4: the call, next month's figure, and the line that would prove the call wrong.
    const w4 = near(p, 4) * ramp(p, 3.6, 3.9);
    const [klat, klng] = PLACES.korea;
    surface(klat, klng, 1, baseV);
    surface(klat, klng, 1 + markers.korea.mesh.scale.y, v);
    above(dom.tags.call, baseV, v, w4, 16 * s);
    surface(GHOST[0], GHOST[1], 1, baseV);
    surface(GHOST[0], GHOST[1], 1 + GHOST_H, v);
    above(dom.tags.next, baseV, v, w4, 16 * s);
    // The threshold: a dashed line across both bars at the same height.
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    toScreen(surface(klat, klng, 1 + LINE_H, v), a);
    toScreen(surface(GHOST[0], GHOST[1], 1 + LINE_H, v), b);
    const lx = b.x - a.x;
    const ly = b.y - a.y;
    const ll = Math.hypot(lx, ly) || 1;
    const ext = 30 * s;
    const x0 = a.x - (lx / ll) * ext;
    const y0 = a.y - (ly / ll) * ext;
    const x1 = b.x + (lx / ll) * ext;
    const y1 = b.y + (ly / ll) * ext;
    dom.threshold.setAttribute("d", `M ${f1(x0)} ${f1(y0)} L ${f1(x1)} ${f1(y1)}`);
    setOpacity(dom.threshold, w4);
    // The label goes on the ghost's side, away from the arcs leaving Korea.
    const [lxEnd, lyEnd] = x1 < x0 ? [x1, y1] : [x0, y0];
    pin(dom.tags.line, lxEnd, lyEnd, [-1, 0.1], 10 * s, w4);
  }

  // ---- frame --------------------------------------------------------------------------------
  let time = 0;
  let lastP = -1;
  function frame(dt: number) {
    time += dt;
    if (dt > 0 && grow < 1) {
      const now = performance.now();
      if (!riseStart) riseStart = now;
      grow = Math.min(1, (now - riseStart) / 1400);
    }
    const p = Math.min(4, Math.max(0, position.current ?? 0));

    // Scrolling eases a drag back to the story's view.
    if (lastP >= 0 && !dragging) {
      const dp = Math.abs(p - lastP);
      if (dp > 0) dragLng *= Math.max(0, 1 - dp * 2.5);
    }
    lastP = p;
    if (!dragging && Math.abs(vel) > 1e-2) {
      dragLng = Math.max(-150, Math.min(150, dragLng + vel * dt));
      vel *= Math.exp(-dt * 3.2);
    }

    if (!views.length) return;
    apply(p, time, 1 - Math.pow(1 - grow, 3));
    const sway = reducedMotion ? 0 : 1.2 * Math.sin(time * 0.19);
    placeCamera(dt, p, sway);
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
    overlays(p);
  }

  resize();
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      sizes.clear();
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
      for (const geo of edgeGeos) geo.dispose();
      for (const geo of stackGeos) geo.dispose();
      for (const m of lineMats) m.dispose();
      beads.dispose();
      dots.dispose();
      disposeRenderer(renderer, scene);
    },
  };
}
