import type * as THREE from "three";
import {
  NARROW_QUERY,
  createProjector,
  createRenderer,
  disposeRenderer,
  inkEdges,
  lerp,
  near,
  paperLights,
  paperMaterial,
  ramp,
  readPalette,
  sizeRenderer,
  track,
  type ScreenPoint,
} from "@/components/breakdown/kit";
import type { BreakdownScene, SceneContext } from "@/components/breakdown/ScrollBreakdown";

/*
  Disco's growth breakdown: the sales funnel drawn as a production line, the way Josh first
  learned to look for a bottleneck on a bottling line. Leads ride the line as small blocks.
  Scroll position (0 to 5, one per step) drives it:

  0  the audit: six business tools wired into one AI research block, and a bar chart of the
     business it reports on. The lowest bar, finding new customers, is the bottleneck.
  1  the blue bar sinks and the line runs out of it: six lead sources feed a belt that
     narrows through the funnel's stages to revenue, and many leads fall off on the way.
     A lens sweeps the belt, and under it enterprise leads stand tall and blue (worth about
     10 times more) while smaller companies lie flat and grey. AI chat lights up.
  2  four content cards drop into the AI chat source, its feed widens, and more of the
     leads coming in are enterprise ones
  3  an AI research arch reads each lead, and after it the belt splits into three lanes,
     one for each kind of buyer, with a first message over each lane
  4  a fit check before the sales call: enterprise leads go on, smaller companies turn off
     to the self-serve demo, and poor fits drop out
  5  the whole line runs, and the revenue stack grows to three times its height

  Blue marks what each step is about. With reduced motion the position is whole, time
  stands still and every step shows its end state.
*/

type Three = typeof THREE;
type V3 = [number, number, number];
/** Where the model sits on the stage, as fractions: left, top, right, bottom. */
type Frame = [number, number, number, number];

export type NoteKey =
  | `tool${0 | 1 | 2 | 3 | 4 | 5}`
  | "ai"
  | `bar${0 | 1 | 2 | 3 | 4}`
  | "bottleneck"
  | `src${0 | 1 | 2 | 3 | 4 | 5}`
  | `stage${0 | 1 | 2 | 3 | 4}`
  | "revenue"
  | "lost"
  | "cards"
  | "research"
  | `lane${0 | 1 | 2}`
  | "message"
  | "fit"
  | "call"
  | "demo"
  | "poor";
export type PanelKey = "key" | "share" | "results";

export type GrowthDom = {
  notes: Record<NoteKey, HTMLElement>;
  /** Readouts under the model. The scene sets their opacity and a --t from 0 to 1. */
  panels: Record<PanelKey, HTMLElement>;
};

const DEG = Math.PI / 180;
const LAST = 5;

/* ---------- the audit (step 0) ---------- */
const COL_Z = [-1.75, -1.05, -0.35, 0.35, 1.05, 1.75];
const TOOL_X = -3.95;
const AI_POS: V3 = [-2.5, 0, 0];
const AI_SIZE: V3 = [0.72, 0.5, 0.72];
const PLATE = { x0: -0.25, x1: 4.95, d: 1.1, t: 0.05 };
const BAR_X = [0.35, 1.4, 2.45, 3.5, 4.55];
const BAR_H = [0.6, 1.42, 1.2, 1.02, 1.34];
const BAR_W = 0.6;

/* ---------- the line (steps 1 to 5) ---------- */
const SRC_X = -1.95;
const X1 = 6.6;
const HD0 = 1.15;
const HD1 = 0.64;
/** Half the belt's depth at x: the funnel narrows toward revenue. */
const hd = (x: number) => lerp(HD0, HD1, Math.min(1, Math.max(0, x / X1)));
const STAGES = [0, 1.32, 2.64, 3.96, 5.28, 6.6];
const RESEARCH_X = 2.64;
const CONTACT_X = 4.35;
const FIT_X = 5.28;
const LANE_Z = [-0.36, 0, 0.36];
const ENTRY_Z = COL_Z.map((z) => z * 0.56);
const DEMO: V3 = [5.95, 0, 1.6];
const REV: V3 = [7.45, 0, 0];
const COIN_H = 0.055;

/* ---------- leads ---------- */
const LEADS = 60;
/** Seconds for one lead to run from its source to revenue. */
const LAP = 9;
/** The share of a lap spent on the feed, and where the belt ends. */
const S_FEED = 0.19;
const S_END = 0.93;
const LEAD = 0.15;
const TALL = 0.42;
const FLAT = 0.07;

/* ---------- camera: one shot per step, fitted to the points that matter ---------- */
const boxPts = (min: V3, max: V3): V3[] =>
  Array.from({ length: 8 }, (_, k): V3 => [k & 1 ? max[0] : min[0], k & 2 ? max[1] : min[1], k & 4 ? max[2] : min[2]]);
type Shot = { az: number; el: number; pts: V3[]; frame: Frame; narrow?: Frame };
/** Corners of the parts themselves, so a shot fits the shapes and the empty corners of their box don't count. */
const AUDIT_PTS: V3[] = [
  ...boxPts([TOOL_X - 0.25, 0, -1.95], [TOOL_X + 0.25, 0.24, 1.95]),
  ...boxPts([-0.25, 0, -0.55], [4.95, 0.05, 0.55]),
  ...boxPts([1.1, 0, -0.3], [4.85, 1.45, 0.3]),
];
const LINE_PTS: V3[] = [
  ...boxPts([-2.2, 0, -1.95], [-1.7, 0.45, 1.95]),
  ...boxPts([0, 0, -1.15], [0.01, 0.45, 1.15]),
  ...boxPts([6.6, 0, -0.64], [6.61, 0.45, 0.64]),
  ...boxPts([7.05, 0, -0.4], [7.85, 0.45, 0.4]),
];
const SHOTS: Shot[] = [
  { az: 46, el: 48, pts: AUDIT_PTS, frame: [0.12, 0.08, 0.96, 0.9], narrow: [0.16, 0.06, 0.98, 0.92] },
  { az: 50, el: 50, pts: LINE_PTS, frame: [0.1, 0.05, 0.96, 0.78], narrow: [0.14, 0.04, 0.98, 0.74] },
  { az: 40, el: 40, pts: [...boxPts([-3.7, 0, -2.4], [-1.7, 1.6, 2.0]), ...boxPts([0, 0, -1.15], [1.4, 0.45, 1.15])], frame: [0.16, 0.05, 0.94, 0.78], narrow: [0.2, 0.04, 0.98, 0.76] },
  { az: 36, el: 52, pts: [...boxPts([1.9, 0, -0.95], [2.0, 0.8, 0.95]), ...boxPts([6.6, 0, -0.64], [6.7, 0.5, 0.64])], frame: [0.04, 0.08, 0.74, 0.94], narrow: [0.02, 0.06, 0.7, 0.96] },
  { az: 40, el: 48, pts: [...boxPts([3.9, 0, -0.85], [4.0, 0.75, 0.85]), ...boxPts([5.5, 0, 1.3], [6.4, 0.1, 1.9]), ...boxPts([7.05, 0, -0.4], [7.85, 0.45, 0.4])], frame: [0.06, 0.06, 0.94, 0.9], narrow: [0.04, 0.06, 0.96, 0.92] },
  { az: 50, el: 50, pts: [...LINE_PTS, ...boxPts([5.5, 0, 1.3], [6.4, 0.1, 1.9])], frame: [0.1, 0.03, 0.96, 0.7], narrow: [0.14, 0.02, 0.98, 0.66] },
];
type Fit = { az: number; el: number; tx: number; ty: number; tz: number; d: number; rx: number; ry: number };
const FIT_KEYS = ["az", "el", "tx", "ty", "tz", "d", "rx", "ry"] as const;

type Align = "above" | "below" | "left" | "right";

/** A small repeatable hash, 0 to 1. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function createGrowthScene(T: Three, ctx: SceneContext, dom: GrowthDom): BreakdownScene {
  const { canvas, host, position, reducedMotion, invalidate } = ctx;
  const palette = readPalette(host);
  const renderer = createRenderer(T, canvas);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(22, 1, 0.1, 200);
  paperLights(T, scene);

  const ink = new T.Color(palette.ink);
  const blue = new T.Color(palette.agent);
  const [F0, F1, F2] = palette.fills;
  const world = new T.Group();
  scene.add(world);
  const v3 = (p: V3) => new T.Vector3(p[0], p[1], p[2]);

  // ---- Pieces: one mesh with its own material and ink edges, faded and tinted on its own.
  type Piece = {
    mesh: THREE.Mesh;
    mat: THREE.MeshLambertMaterial;
    edge: THREE.LineBasicMaterial;
    edgeOpacity: number;
    base: THREE.Color;
    /** Flat details that fade with the piece. */
    extras: THREE.Material[];
  };
  function piece(geo: THREE.BufferGeometry, fill: THREE.ColorRepresentation, edgeOpacity = 0.85, threshold = 20): Piece {
    geo.computeBoundingBox();
    const mat = paperMaterial(T, fill);
    mat.transparent = true;
    const mesh = new T.Mesh(geo, mat);
    const edge = inkEdges(T, mesh, { color: palette.ink, opacity: edgeOpacity, threshold }).material as THREE.LineBasicMaterial;
    return { mesh, mat, edge, edgeOpacity, base: new T.Color(fill), extras: [] };
  }
  /** Opacity f, and how far toward the site blue (tint 0 to 1, fill strength k). */
  function shade(pc: Piece, f: number, tint = 0, k = 0.3) {
    const on = f > 0.01;
    pc.mesh.visible = on;
    if (!on) return;
    pc.mat.opacity = f;
    pc.edge.opacity = pc.edgeOpacity * f;
    pc.mat.color.copy(pc.base).lerp(blue, tint * k);
    pc.edge.color.copy(ink).lerp(blue, tint);
    for (const m of pc.extras) m.opacity = f * (m.userData.base as number);
  }
  function detail(owner: Piece, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, opacity: number) {
    const mat = new T.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: T.DoubleSide });
    mat.userData.base = opacity;
    owner.extras.push(mat);
    const m = new T.Mesh(geo, mat);
    owner.mesh.add(m);
    return m;
  }
  function line(pts: THREE.Vector3[], color: THREE.ColorRepresentation, opacity: number, dashed = false) {
    const geo = new T.BufferGeometry().setFromPoints(pts);
    const mat = dashed
      ? new T.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.07, gapSize: 0.06, depthWrite: false })
      : new T.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    mat.userData.base = opacity;
    const l = new T.Line(geo, mat);
    if (dashed) l.computeLineDistances();
    world.add(l);
    return l;
  }
  const fadeLine = (l: THREE.Line, f: number) => {
    const mat = l.material as THREE.LineBasicMaterial;
    l.visible = f > 0.01;
    mat.opacity = (mat.userData.base as number) * f;
  };

  /** A cubic curve in the floor plane, sampled. */
  const cubic = (a: V3, b: V3, c: V3, d: V3, n = 28): THREE.Vector3[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      return new T.Vector3(
        a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3,
        a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3,
        a[2] * w0 + b[2] * w1 + c[2] * w2 + d[2] * w3,
      );
    });
  /** The point a fraction t of the way along a sampled curve. */
  const along = (pts: THREE.Vector3[], t: number, out: THREE.Vector3) => {
    const f = Math.min(0.9999, Math.max(0, t)) * (pts.length - 1);
    const i = Math.floor(f);
    return out.lerpVectors(pts[i], pts[i + 1], f - i);
  };
  /** A flat band of width w along a curve in the floor plane. */
  function ribbon(pts: THREE.Vector3[], w: number) {
    const pos: number[] = [];
    const L: THREE.Vector3[] = [];
    const R: THREE.Vector3[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = (-(b.z - a.z) / len) * (w / 2);
      const nz = ((b.x - a.x) / len) * (w / 2);
      L.push(new T.Vector3(pts[i].x + nx, pts[i].y, pts[i].z + nz));
      R.push(new T.Vector3(pts[i].x - nx, pts[i].y, pts[i].z - nz));
    }
    for (let i = 0; i < n - 1; i++) {
      for (const v of [L[i], R[i], L[i + 1], L[i + 1], R[i], R[i + 1]]) pos.push(v.x, v.y, v.z);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // ---- The audit -------------------------------------------------------------------------
  const tools = COL_Z.map((z) => {
    const pc = piece(new T.BoxGeometry(0.5, 0.24, 0.42), F1);
    pc.mesh.position.set(TOOL_X, 0.12, z);
    world.add(pc.mesh);
    return pc;
  });
  const cablePts = COL_Z.map((z) =>
    cubic([TOOL_X + 0.25, 0.004, z], [-3.35, 0.004, z], [-3.3, 0.004, z * 0.14], [AI_POS[0] - AI_SIZE[0] / 2, 0.004, z * 0.14]),
  );
  const cables = cablePts.map((pts) => line(pts, palette.ink, 0.55));
  const pulseGeo = new T.IcosahedronGeometry(0.045, 1);
  const pulses = cablePts.map(() => {
    const m = new T.Mesh(pulseGeo, new T.MeshBasicMaterial({ color: palette.agent, transparent: true }));
    world.add(m);
    return m;
  });
  const aiBlock = piece(new T.BoxGeometry(...AI_SIZE), F0);
  aiBlock.mesh.position.set(AI_POS[0], AI_SIZE[1] / 2, AI_POS[2]);
  world.add(aiBlock.mesh);
  // A four-point star on top: the AI tool.
  {
    const s = new T.Shape();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const r = k % 2 ? 0.05 : 0.17;
      if (k === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const star = detail(aiBlock, new T.ShapeGeometry(s).rotateX(-Math.PI / 2), palette.agent, 1);
    star.position.y = AI_SIZE[1] / 2 + 0.002;
  }
  const reportLine = line([new T.Vector3(AI_POS[0] + AI_SIZE[0] / 2, 0.004, 0), new T.Vector3(PLATE.x0, 0.004, 0)], palette.ink, 0.55);
  const plate = piece(new T.BoxGeometry(PLATE.x1 - PLATE.x0, PLATE.t, PLATE.d), F0);
  plate.mesh.position.set((PLATE.x0 + PLATE.x1) / 2, PLATE.t / 2, 0);
  world.add(plate.mesh);
  const bars = BAR_X.map((x, i) => {
    const pc = piece(new T.BoxGeometry(BAR_W, 1, BAR_W).translate(0, 0.5, 0), i === 0 ? F0 : i % 2 ? F1 : F2);
    pc.mesh.position.set(x, PLATE.t, 0);
    pc.mesh.scale.y = BAR_H[i];
    world.add(pc.mesh);
    return pc;
  });
  const limit = line(
    [new T.Vector3(PLATE.x0 + 0.05, PLATE.t + BAR_H[0], BAR_W / 2 + 0.02), new T.Vector3(PLATE.x1 - 0.05, PLATE.t + BAR_H[0], BAR_W / 2 + 0.02)],
    palette.agent,
    0.9,
    true,
  );

  // ---- The line ------------------------------------------------------------------------------
  const beltGeo = new T.BoxGeometry(X1, 0.12, 2).translate(X1 / 2, -0.06, 0);
  {
    const a = beltGeo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < a.count; k++) a.setZ(k, a.getZ(k) * hd(a.getX(k)));
    a.needsUpdate = true;
    beltGeo.computeVertexNormals();
  }
  const belt = piece(beltGeo, F0);
  world.add(belt.mesh);
  const chute = piece(new T.BoxGeometry(0.62, 0.12, 0.5).translate(0.31, -0.06, 0), F0);
  chute.mesh.position.set(X1, 0, 0);
  world.add(chute.mesh);
  const dividers = STAGES.slice(1, -1).map((x) =>
    line([new T.Vector3(x, 0.003, -hd(x)), new T.Vector3(x, 0.003, hd(x))], palette.ink, 0.35, true),
  );
  const laneLines = [-0.18, 0.18].map((z) =>
    line([new T.Vector3(RESEARCH_X + 0.55, 0.003, z), new T.Vector3(X1, 0.003, z)], palette.ink, 0.3, true),
  );

  const sources = COL_Z.map((z) => {
    const pc = piece(new T.BoxGeometry(0.46, 0.26, 0.4).translate(0, 0.13, 0), F1);
    pc.mesh.position.set(SRC_X, 0, z);
    world.add(pc.mesh);
    return pc;
  });
  const feedPts = COL_Z.map((z, i) =>
    cubic([SRC_X + 0.23, 0.004, z], [-1.05, 0.004, z], [-0.75, 0.004, ENTRY_Z[i]], [0.02, 0.004, ENTRY_Z[i]]),
  );
  const feeds = feedPts.map((pts) => line(pts, palette.ink, 0.5));
  const band = new T.Mesh(
    ribbon(feedPts[0], 0.3),
    new T.MeshBasicMaterial({ color: palette.agent, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }),
  );
  band.position.y = -0.002;
  world.add(band);

  function arch(x: number, h: number) {
    const half = hd(x) + 0.09;
    const parts = [
      piece(new T.BoxGeometry(0.08, h, 0.08).translate(0, h / 2, 0), F1),
      piece(new T.BoxGeometry(0.08, h, 0.08).translate(0, h / 2, 0), F1),
      piece(new T.BoxGeometry(0.1, 0.08, half * 2 + 0.08), F1),
    ];
    parts[0].mesh.position.set(x, 0, -half);
    parts[1].mesh.position.set(x, 0, half);
    parts[2].mesh.position.set(x, h, 0);
    for (const pc of parts) world.add(pc.mesh);
    return parts;
  }
  const researchArch = arch(RESEARCH_X, 0.72);
  const scan = new T.Mesh(
    new T.PlaneGeometry(hd(RESEARCH_X) * 2, 0.68).rotateY(Math.PI / 2),
    new T.MeshBasicMaterial({ color: palette.agent, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }),
  );
  scan.position.set(RESEARCH_X, 0.34, 0);
  world.add(scan);
  const fitArch = arch(FIT_X, 0.66);

  // One envelope over each lane: the first message, written for that kind of buyer.
  const envelopes = LANE_Z.map((z) => {
    const pc = piece(new T.BoxGeometry(0.3, 0.2, 0.02), "#ffffff");
    const flap = new T.LineSegments(
      new T.BufferGeometry().setFromPoints([
        new T.Vector3(-0.15, 0.1, 0.011),
        new T.Vector3(0, -0.01, 0.011),
        new T.Vector3(0, -0.01, 0.011),
        new T.Vector3(0.15, 0.1, 0.011),
      ]),
      new T.LineBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    flap.material.userData.base = 0.85;
    pc.extras.push(flap.material);
    pc.mesh.add(flap);
    pc.mesh.position.set(CONTACT_X, 0.62, z);
    world.add(pc.mesh);
    return pc;
  });

  const spur = piece(
    ribbon(
      cubic([FIT_X + 0.05, -0.004, 0.3], [FIT_X + 0.3, -0.004, 0.75], [DEMO[0] - 0.2, -0.004, DEMO[2] - 0.55], [DEMO[0], -0.004, DEMO[2] - 0.2]),
      0.34,
    ),
    F0,
    0.6,
  );
  spur.mat.side = T.DoubleSide;
  world.add(spur.mesh);
  const demoPad = piece(new T.BoxGeometry(0.85, 0.06, 0.55).translate(0, -0.03, 0), F1);
  demoPad.mesh.position.set(DEMO[0], 0, DEMO[2]);
  world.add(demoPad.mesh);

  const revPad = piece(new T.CylinderGeometry(0.4, 0.4, 0.05, 28).translate(0, -0.025, 0), F1, 0.85, 30);
  revPad.mesh.position.set(REV[0], 0, REV[2]);
  world.add(revPad.mesh);
  const coins = Array.from({ length: 6 }, (_, k) => {
    const pc = piece(new T.CylinderGeometry(0.28, 0.28, COIN_H, 24).translate(0, COIN_H / 2, 0), k % 2 ? F1 : F0, 0.85, 30);
    pc.mesh.position.set(REV[0], k * COIN_H, REV[2]);
    world.add(pc.mesh);
    return pc;
  });

  // The lens of step 1.
  const lens = new T.Group();
  const ringMat = new T.MeshLambertMaterial({ color: palette.agent, transparent: true, flatShading: true });
  const ring = new T.Mesh(new T.TorusGeometry(0.5, 0.04, 6, 44), ringMat);
  ring.rotation.x = -Math.PI / 2;
  const glassMat = new T.MeshBasicMaterial({ color: palette.agent, transparent: true, opacity: 0.08, depthWrite: false, side: T.DoubleSide });
  const glass = new T.Mesh(new T.CircleGeometry(0.47, 44).rotateX(-Math.PI / 2), glassMat);
  const handle = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.6, 8).rotateZ(Math.PI / 2).translate(0.82, 0, 0), ringMat);
  handle.rotation.y = -0.7;
  lens.add(ring, glass, handle);
  world.add(lens);

  // Content cards of step 2: two articles and two videos.
  const cards = Array.from({ length: 4 }, (_, k) => {
    const pc = piece(new T.BoxGeometry(0.44, 0.3, 0.016), "#ffffff");
    if (k % 2 === 0) {
      [0.07, 0.0, -0.07].forEach((y, j) => {
        const bar = detail(pc, new T.PlaneGeometry(j === 2 ? 0.2 : 0.3, 0.025), palette.ink, 0.45);
        bar.position.set(j === 2 ? -0.05 : 0, y, 0.009);
      });
    } else {
      const tri = new T.Shape();
      tri.moveTo(-0.045, -0.06);
      tri.lineTo(0.07, 0);
      tri.lineTo(-0.045, 0.06);
      tri.lineTo(-0.045, -0.06);
      const m = detail(pc, new T.ShapeGeometry(tri), palette.agent, 0.9);
      m.position.z = 0.009;
    }
    world.add(pc.mesh);
    return pc;
  });
  const cardFrom = new T.Vector3(-3.55, 1.55, -2.45);
  const cardTo = new T.Vector3(SRC_X, 0.32, COL_Z[0]);

  // ---- Leads -----------------------------------------------------------------------------------
  const leadGeo = new T.BoxGeometry(LEAD, LEAD, LEAD).translate(0, LEAD / 2, 0);
  const leadEdges = new T.EdgesGeometry(leadGeo);
  const smallFill = new T.Color(F2).lerp(ink, 0.12);
  const bigFill = new T.Color(F0).lerp(blue, 0.8);
  const neutral = new T.Color(F1);
  type Lead = {
    mesh: THREE.Mesh;
    mat: THREE.MeshLambertMaterial;
    edge: THREE.LineBasicMaterial;
    phase: number;
    cycle: number;
    big: boolean;
    src: number;
    lane: number;
    poor: boolean;
    zr: number;
    drop: number;
    dropX: number;
  };
  const leads: Lead[] = Array.from({ length: LEADS }, (_, i) => {
    const mat = paperMaterial(T, F1);
    mat.transparent = true;
    const mesh = new T.Mesh(leadGeo, mat);
    const edge = new T.LineBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.85, depthWrite: false });
    const e = new T.LineSegments(leadEdges, edge);
    e.raycast = () => {};
    mesh.add(e);
    world.add(mesh);
    return { mesh, mat, edge, phase: i / LEADS + hash(i * 3.1) * 0.4 / LEADS, cycle: -1e9, big: false, src: 0, lane: 2, poor: false, zr: 0, drop: 1, dropX: 3 };
  });

  /** Picks a lead's kind, source and fate for its next lap, from the story at position p. */
  function roll(L: Lead, i: number, c: number, p: number) {
    const h = (k: number) => hash(i * 131.7 + c * 977.3 + k * 7.31);
    const boosted = ramp(p, 1.5, 2.2);
    L.big = h(1) < lerp(0.18, 0.5, boosted);
    const ai = L.big ? lerp(0.55, 0.8, boosted) : lerp(0.25, 0.42, boosted);
    L.src = h(2) < ai ? 0 : 1 + Math.min(4, Math.floor(h(3) * 5));
    L.lane = L.big ? (h(4) < 0.5 ? 0 : 1) : 2;
    L.poor = !L.big && h(5) < 0.38;
    L.zr = h(6) * 2 - 1;
    L.drop = h(7);
    L.dropX = lerp(0.8, 6.0, h(8));
    L.cycle = c;
  }

  // ---- Drag to turn, with a little inertia ------------------------------------------------
  let dragAz = 0;
  let dragEl = 0;
  let velAz = 0;
  let dragging: { id: number; x: number; y: number; t: number } | null = null;
  const SENS = 0.0065;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    velAz = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.dataset.dragging = "";
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const dx = (e.clientX - dragging.x) * SENS;
    const dy = e.pointerType === "touch" ? 0 : (e.clientY - dragging.y) * SENS;
    const dt = Math.max((e.timeStamp - dragging.t) / 1000, 1 / 240);
    dragAz -= dx;
    dragEl = Math.min(0.5, Math.max(-0.35, dragEl + dy));
    velAz = velAz * 0.5 - (dx / dt) * 0.5;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    dragging.t = e.timeStamp;
    invalidate();
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    if ((e.timeStamp - dragging.t) / 1000 > 0.1 || reducedMotion) velAz = 0;
    velAz = Math.max(-5, Math.min(5, velAz));
    dragging = null;
    delete canvas.dataset.dragging;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  // ---- Layout and camera fits -----------------------------------------------------------
  let width = 1;
  let height = 1;
  let narrow = false;
  const fits: Fit[] = SHOTS.map(() => ({ az: 0, el: 0, tx: 0, ty: 0, tz: 0, d: 1, rx: 0, ry: 0 }));
  const vR = new T.Vector3();
  const vU = new T.Vector3();
  const vD = new T.Vector3();
  const vQ = new T.Vector3();
  const UP = new T.Vector3(0, 1, 0);
  function basis(az: number, el: number) {
    vD.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    vR.crossVectors(UP, vD).normalize();
    vU.crossVectors(vD, vR);
  }
  /** Camera target and distance that fit a shot's box inside its frame on the stage. */
  function solve(s: Shot, out: Fit) {
    out.az = s.az * DEG;
    out.el = s.el * DEG;
    basis(out.az, out.el);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const q of s.pts) {
      cx += q[0] / s.pts.length;
      cy += q[1] / s.pts.length;
      cz += q[2] / s.pts.length;
    }
    const pts: { x: number; y: number; z: number }[] = [];
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const sp of s.pts) {
      vQ.set(sp[0] - cx, sp[1] - cy, sp[2] - cz);
      const q = { x: vQ.dot(vR), y: vQ.dot(vU), z: vQ.dot(vD) };
      pts.push(q);
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
    }
    const xm = (x0 + x1) / 2;
    const ym = (y0 + y1) / 2;
    out.tx = cx + vR.x * xm + vU.x * ym;
    out.ty = cy + vR.y * xm + vU.y * ym;
    out.tz = cz + vR.z * xm + vU.z * ym;
    const f = narrow && s.narrow ? s.narrow : s.frame;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = (tan * (f[2] - f[0]) * width) / height;
    const tanV = tan * (f[3] - f[1]);
    let d = 1;
    for (const q of pts) d = Math.max(d, q.z + Math.abs(q.x - xm) / tanH, q.z + Math.abs(q.y - ym) / tanV);
    out.d = d;
    out.rx = ((f[0] + f[2]) / 2) * width;
    out.ry = ((f[1] + f[3]) / 2) * height;
  }

  const noteSizes = new Map<HTMLElement, { w: number; h: number }>();
  function resize() {
    const size = sizeRenderer(renderer, camera);
    if (!size) return;
    width = size.width;
    height = size.height;
    narrow = window.matchMedia(NARROW_QUERY).matches;
    SHOTS.forEach((s, i) => solve(s, fits[i]));
    noteSizes.clear();
  }
  let fontsDone = false;
  document.fonts?.ready.then(() => {
    fontsDone = true;
    noteSizes.clear();
    invalidate();
  });

  let time = 0;
  const cam: Fit & { set: boolean } = { az: 0, el: 0, tx: 0, ty: 0, tz: 0, d: 1, rx: 0, ry: 0, set: false };
  const target = new T.Vector3();
  function placeCamera(p: number, dt: number) {
    const e = !cam.set || reducedMotion || dt === 0 ? 1 : 1 - Math.exp(-dt * 6);
    for (const k of FIT_KEYS) cam[k] = lerp(cam[k], track(fits.map((f) => f[k]), p), e);
    cam.set = true;
    const sway = reducedMotion ? 0 : 0.025 * Math.sin(time * 0.27);
    basis(cam.az + dragAz + sway, Math.min(1.4, Math.max(0.1, cam.el + dragEl)));
    target.set(cam.tx, cam.ty, cam.tz);
    camera.position.copy(target).addScaledVector(vD, cam.d);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.setViewOffset(width, height, width / 2 - cam.rx, height / 2 - cam.ry, width, height);
    camera.updateMatrixWorld(true);
  }

  // ---- Notes -----------------------------------------------------------------------------------
  const project = createProjector(T);
  const sp: ScreenPoint = { x: 0, y: 0, behind: false };
  const f1 = (n: number) => n.toFixed(1);
  const setOpacity = (el: HTMLElement, o: number) => {
    el.style.opacity = o > 0.01 ? o.toFixed(3) : "0";
  };
  function place(el: HTMLElement, at: THREE.Vector3, align: Align, o: number) {
    if (o > 0.01) {
      project(at, camera, width, height, sp);
      if (sp.behind) o = 0;
    }
    setOpacity(el, o);
    if (o <= 0.01) return;
    let s = noteSizes.get(el);
    if (!s || !s.w) {
      s = { w: el.offsetWidth, h: el.offsetHeight };
      if (fontsDone) noteSizes.set(el, s);
    }
    const gap = 6;
    let left = sp.x - s.w / 2;
    let top = sp.y - s.h / 2;
    if (align === "above") top = sp.y - s.h - gap;
    else if (align === "below") top = sp.y + gap;
    else if (align === "left") left = sp.x - s.w - gap - 2;
    else left = sp.x + gap + 2;
    left = Math.min(Math.max(left, 4), width - s.w - 4);
    top = Math.min(Math.max(top, 4), height - s.h - 4);
    el.style.transform = `translate3d(${f1(left)}px, ${f1(top)}px, 0)`;
  }

  type NoteSpec = { key: NoteKey; at: THREE.Vector3; align: Align; w: (p: number) => number; wide?: boolean };
  const stageMid = (k: number) => (STAGES[k] + STAGES[k + 1]) / 2;
  const NOTES: NoteSpec[] = [
    ...COL_Z.map((z, i): NoteSpec => ({ key: `tool${i}` as NoteKey, at: new T.Vector3(TOOL_X - 0.25, 0.12, z), align: "left", w: (p) => near(p, 0, 0.2, 0.45) })),
    { key: "ai", at: new T.Vector3(AI_POS[0], AI_SIZE[1] + 0.06, AI_POS[2]), align: "above", w: (p) => near(p, 0, 0.2, 0.45) },
    ...BAR_X.map((x, i): NoteSpec => ({
      key: `bar${i}` as NoteKey,
      // The first bar's name goes to its left, clear of the next bar.
      at: i === 0 ? new T.Vector3(PLATE.x0, 0.02, PLATE.d / 2) : new T.Vector3(x, 0, PLATE.d / 2),
      align: i === 0 ? "left" : "below",
      w: (p) => near(p, 0, 0.2, 0.45),
      wide: i > 0,
    })),
    { key: "bottleneck", at: new T.Vector3(BAR_X[0], PLATE.t + BAR_H[0] + 0.04, 0), align: "above", w: (p) => near(p, 0, 0.15, 0.35) },
    ...COL_Z.map((z, i): NoteSpec => ({
      key: `src${i}` as NoteKey,
      at: new T.Vector3(SRC_X - 0.24, 0.13, z),
      align: "left",
      w: (p) => Math.max(near(p, 1), near(p, 2), near(p, 5)) * ramp(p, 0.6, 0.85),
    })),
    ...[0, 1, 2, 3, 4].map((k): NoteSpec => ({
      key: `stage${k}` as NoteKey,
      at: new T.Vector3(stageMid(k), 0.02, -hd(stageMid(k)) - 0.04),
      align: "above",
      w: (p) => Math.max(near(p, 1), near(p, 5)) * ramp(p, 0.7, 0.9),
    })),
    { key: "revenue", at: new T.Vector3(REV[0], -0.05, REV[2] + 0.42), align: "below", w: (p) => Math.max(near(p, 1), near(p, 4), near(p, 5)) * ramp(p, 0.7, 0.9) },
    { key: "lost", at: new T.Vector3(3.4, -0.4, hd(3.4) + 0.32), align: "below", w: (p) => near(p, 1) * ramp(p, 0.75, 0.95) },
    { key: "cards", at: new T.Vector3(-3.2, 1.7, -2.3), align: "above", w: (p) => near(p, 2) },
    { key: "research", at: new T.Vector3(RESEARCH_X, 0.8, -hd(RESEARCH_X) * 0.4), align: "above", w: (p) => near(p, 3) },
    ...LANE_Z.map((z, i): NoteSpec => ({ key: `lane${i}` as NoteKey, at: new T.Vector3(X1 + 0.05, 0.02, z), align: "right", w: (p) => near(p, 3) })),
    { key: "message", at: new T.Vector3(CONTACT_X, 0.78, LANE_Z[0] - 0.05), align: "above", w: (p) => near(p, 3) },
    { key: "fit", at: new T.Vector3(FIT_X, 0.74, -hd(FIT_X) * 0.4), align: "above", w: (p) => near(p, 4) },
    { key: "call", at: new T.Vector3((FIT_X + X1) / 2 + 0.1, 0.48, -0.2), align: "above", w: (p) => near(p, 4) },
    { key: "demo", at: new T.Vector3(DEMO[0] - 0.42, -0.03, DEMO[2]), align: "left", w: (p) => Math.max(near(p, 4), near(p, 5)) * ramp(p, 3.5, 3.8) },
    { key: "poor", at: new T.Vector3(FIT_X + 0.3, 0, -hd(FIT_X) - 0.25), align: "above", w: (p) => near(p, 4) },
  ];

  // ---- The frame ---------------------------------------------------------------------------
  const pos = new T.Vector3();
  const tmpA = new T.Vector3();
  const tmpB = new T.Vector3();
  const demoAt = new T.Vector3();
  let lastP = -1;

  function frame(dt: number) {
    time += dt;
    const p = Math.min(LAST, Math.max(0, position.current ?? 0));

    // Scrolling eases a drag back to the story's view.
    if (lastP >= 0 && !dragging) {
      const dp = Math.abs(p - lastP);
      if (dp > 0) {
        const k = Math.min(1, dp * 2.5);
        dragAz *= 1 - k;
        dragEl *= 1 - k;
      }
    }
    const jumped = lastP < 0 || Math.abs(p - lastP) > 0.6;
    lastP = p;
    if (!dragging && Math.abs(velAz) > 1e-3) {
      dragAz += velAz * dt;
      velAz *= Math.exp(-dt * 3.2);
    }
    placeCamera(p, dt);

    // ---- the audit
    const audit = 1 - ramp(p, 0.22, 0.62);
    const sink = (1 - audit) * 0.35;
    tools.forEach((pc, i) => {
      shade(pc, audit);
      pc.mesh.position.y = 0.12 - sink;
      fadeLine(cables[i], audit);
      const t = reducedMotion ? 0.55 : (time * 0.45 + i * 0.37) % 1;
      along(cablePts[i], t, pulses[i].position);
      const pm = pulses[i].material as THREE.MeshBasicMaterial;
      pulses[i].visible = audit > 0.01;
      pm.opacity = audit * (reducedMotion ? 1 : ramp(t, 0, 0.1) * (1 - ramp(t, 0.9, 1)));
    });
    shade(aiBlock, audit, 1, 0.12);
    aiBlock.mesh.position.y = AI_SIZE[1] / 2 - sink;
    fadeLine(reportLine, audit);
    shade(plate, audit);
    plate.mesh.position.y = PLATE.t / 2 - sink;
    bars.forEach((pc, i) => {
      if (i === 0) {
        // The bottleneck sinks into the floor and the line runs out of it.
        const h = BAR_H[0] * (1 - ramp(p, 0.18, 0.5));
        pc.mesh.scale.y = Math.max(0.001, h);
        shade(pc, 1 - ramp(p, 0.42, 0.56), 1, 0.55);
      } else {
        pc.mesh.position.y = PLATE.t - sink;
        shade(pc, audit);
      }
    });
    fadeLine(limit, near(p, 0, 0.15, 0.35));

    // ---- the line
    const lineOn = ramp(p, 0.3, 0.75);
    belt.mesh.scale.x = lerp(0.04, 1, ramp(p, 0.3, 0.72));
    shade(belt, Math.max(lineOn, 1 - ramp(p, 0.42, 0.56)) * (p < 0.3 ? 0 : 1), ramp(p, 0.25, 0.4) * (1 - ramp(p, 0.7, 1)), 0.4);
    shade(chute, ramp(p, 0.62, 0.8));
    const stagesOn = ramp(p, 0.65, 0.85);
    dividers.forEach((l) => fadeLine(l, stagesOn));
    const lanesOn = ramp(p, 2.45, 2.9);
    laneLines.forEach((l) => fadeLine(l, lanesOn));

    const srcOn = ramp(p, 0.45, 0.85);
    const aiTint = Math.max(near(p, 1), near(p, 2), near(p, 5) * 0.6);
    const boost = near(p, 2, 0.3, 0.55);
    sources.forEach((pc, i) => {
      pc.mesh.position.y = (srcOn - 1) * 0.35;
      shade(pc, srcOn, i === 0 ? aiTint : 0, 0.5);
      if (i === 0) pc.mesh.scale.y = 1 + 0.7 * boost;
      fadeLine(feeds[i], srcOn);
    });
    (band.material as THREE.MeshBasicMaterial).opacity = srcOn * Math.max(boost * 0.45, near(p, 5) * 0.25);
    band.visible = (band.material as THREE.MeshBasicMaterial).opacity > 0.01;

    const researchOn = ramp(p, 2.3, 2.75);
    const researchTint = near(p, 3);
    for (const pc of researchArch) shade(pc, researchOn, researchTint, 0.4);
    (scan.material as THREE.MeshBasicMaterial).opacity = researchTint * (reducedMotion ? 0.12 : 0.08 + 0.05 * Math.sin(time * 3));
    scan.visible = researchTint > 0.01;
    const fitOn = ramp(p, 3.4, 3.85);
    const fitTint = near(p, 4);
    for (const pc of fitArch) shade(pc, fitOn, fitTint, 0.4);
    shade(spur, fitOn);
    shade(demoPad, fitOn, 0, 0.3);
    const envOn = near(p, 3, 0.3, 0.55) * lanesOn;
    envelopes.forEach((pc, i) => {
      shade(pc, envOn, i < 2 ? 1 : 0, 0.15);
      pc.mesh.position.y = 0.62 + (reducedMotion ? 0 : 0.025 * Math.sin(time * 2.2 + i * 1.3));
      pc.mesh.rotation.y = cam.az + dragAz;
    });

    // Revenue: the stack of coins grows to three times its height in the last step.
    const revOn = ramp(p, 0.62, 0.85) * (1 - 0.9 * near(p, 3, 0.25, 0.55));
    shade(revPad, revOn);
    const stack = 2 + 4 * ramp(p, 4.35, 4.95);
    coins.forEach((pc, k) => {
      const c = Math.min(1, Math.max(0, stack - k));
      shade(pc, revOn * c, near(p, 5, 0.3, 0.6) * c, 0.45);
      pc.mesh.position.y = k * COIN_H + (1 - c) * 0.25;
    });

    // The lens sweeps right to left and holds over the start of the belt.
    const lensOn = ramp(p, 0.5, 0.72) * (1 - ramp(p, 1.25, 1.55));
    lens.visible = lensOn > 0.01;
    const lensX = lerp(5.4, 1.05, ramp(p, 0.55, 0.95));
    lens.position.set(lensX, 0.78 + ramp(p, 1.25, 1.55) * 0.4, 0.1);
    ringMat.opacity = lensOn;
    glassMat.opacity = lensOn * 0.1;
    const lensReveal = ramp(p, 0.55, 0.75);
    const allReveal = ramp(p, 1.25, 1.7);

    // Cards drop into the AI chat source.
    const cardsOn = near(p, 2, 0.3, 0.55) * srcOn;
    cards.forEach((pc, k) => {
      const t = reducedMotion ? 0.12 + k * 0.19 : (time / 3.2 + k / 4) % 1;
      tmpA.copy(cardFrom).add(tmpB.set(k * 0.08, -k * 0.05, k * 0.12));
      pc.mesh.position.lerpVectors(tmpA, cardTo, t * t);
      pc.mesh.position.y += 0.25 * 4 * t * (1 - t);
      pc.mesh.rotation.set(0, cam.az + dragAz, 0);
      shade(pc, cardsOn * (reducedMotion ? 1 : ramp(t, 0, 0.12) * (1 - ramp(t, 0.8, 0.97))));
    });

    // ---- leads
    const lossy = 1 - ramp(p, 2.45, 2.9);
    leads.forEach((L, i) => {
      const u = (reducedMotion ? 0 : time) / LAP + L.phase;
      const c = Math.floor(u);
      const s = u - c;
      if (c !== L.cycle || reducedMotion || jumped) roll(L, i, c, p);
      const d = (X1 * (s - S_FEED)) / (S_END - S_FEED); // distance along the belt; runs past X1 into revenue
      let op = 1;
      let shrink = 1;
      let x = d;
      if (s < S_FEED) {
        along(feedPts[L.src], s / S_FEED, pos);
        pos.y = 0;
        x = pos.x;
      } else {
        // Free across the belt at first, then into its lane after the research arch.
        const xc = Math.min(d, X1);
        const free = lerp(ENTRY_Z[L.src], L.zr * (hd(xc) - 0.12), ramp(xc, 0, 1.1));
        const z = lerp(free, LANE_Z[L.lane], lanesOn * ramp(xc, RESEARCH_X + 0.05, RESEARCH_X + 0.6));
        pos.set(xc, 0, z);
        if (d > X1) {
          const q = ramp(d, X1, X1 + (X1 * (1 - S_END)) / (S_END - S_FEED));
          tmpA.set(REV[0], (2 + 4 * ramp(p, 4.35, 4.95)) * COIN_H, REV[2]);
          pos.lerp(tmpA, q);
          pos.y += 0.25 * 4 * q * (1 - q);
          shrink = lerp(1, 0.3, ramp(q, 0.3, 1));
          op = 1 - ramp(q, 0.8, 1);
        }
        // Lost along the way, before the actions.
        if (L.drop < 0.55 * lossy && d > L.dropX) {
          const slide = ramp(d, L.dropX, L.dropX + 0.35);
          pos.z = lerp(pos.z, hd(L.dropX) + 0.25, slide);
          pos.y -= 0.8 * ramp(d, L.dropX + 0.25, L.dropX + 0.8) ** 2;
          op = Math.min(op, 1 - ramp(d, L.dropX + 0.35, L.dropX + 0.8));
        }
        // The fit check: smaller companies turn off to the demo, poor fits drop out.
        if (!L.big && fitOn > 0 && d > FIT_X) {
          let dOp: number;
          if (L.poor) {
            tmpA.set(Math.min(d, FIT_X + 0.4), 0, lerp(LANE_Z[2], -hd(FIT_X) - 0.3, ramp(d, FIT_X, FIT_X + 0.4)));
            tmpA.y -= 0.8 * ramp(d, FIT_X + 0.3, FIT_X + 0.8) ** 2;
            dOp = 1 - ramp(d, FIT_X + 0.45, FIT_X + 0.85);
          } else {
            const q = ramp(d, FIT_X, FIT_X + 0.8);
            demoAt.set(DEMO[0] + (hash(i * 9.7) - 0.5) * 0.5, 0, DEMO[2] + (hash(i * 4.3) - 0.5) * 0.3);
            tmpA.set(FIT_X, 0, LANE_Z[2]).lerp(demoAt, q);
            tmpA.y += 0.12 * 4 * q * (1 - q);
            dOp = 1 - ramp(d, FIT_X + 1.1, FIT_X + 1.5);
          }
          pos.lerp(tmpA, fitOn);
          op = lerp(op, dOp, fitOn);
        }
      }
      // Under the glass each lead shows its value: tall and blue, or flat and grey.
      const rv = Math.max(allReveal, lensReveal * ramp(x, lensX - 0.5, lensX - 0.35));
      const h = L.big ? lerp(LEAD, TALL, rv) : lerp(LEAD, FLAT, rv);
      L.mesh.position.copy(pos);
      L.mesh.scale.set(shrink, (h / LEAD) * shrink, shrink);
      const f = op * lineOn;
      L.mesh.visible = f > 0.01;
      if (!L.mesh.visible) return;
      L.mat.opacity = f;
      L.mat.color.copy(neutral).lerp(L.big ? bigFill : smallFill, rv);
      L.edge.color.copy(ink).lerp(blue, L.big ? rv : 0);
      L.edge.opacity = f * (L.big ? 0.85 : lerp(0.85, 0.5, rv));
    });

    renderer.render(scene, camera);

    // ---- overlays
    for (const n of NOTES) {
      const o = narrow && n.wide ? 0 : n.w(p);
      place(dom.notes[n.key], n.at, n.align, o);
    }
    const panel = (k: PanelKey, o: number, t: number) => {
      const el = dom.panels[k];
      setOpacity(el, o);
      el.style.setProperty("--t", t.toFixed(3));
    };
    panel("key", near(p, 1, 0.3, 0.5) * ramp(p, 0.75, 0.95), 1);
    panel("share", near(p, 2, 0.3, 0.5), ramp(p, 1.55, 2));
    panel("results", ramp(p, 4.5, 4.85), ramp(p, 4.5, 5));
  }

  resize();
  return {
    frame,
    resize,
    dispose() {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      disposeRenderer(renderer, scene);
    },
  };
}
