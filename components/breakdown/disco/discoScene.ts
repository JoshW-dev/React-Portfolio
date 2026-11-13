import type * as THREE from "three";
import {
  clamp01,
  createProjector,
  createRenderer,
  createScreenBox,
  disposeRenderer,
  disposeTree,
  inkEdges,
  lerp,
  near,
  paperLights,
  paperMaterial,
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
  The Disco breakdown. Software has no hardware to take apart, so the model is made of the
  things the story is about. Scroll position (0 to 4, one per step) drives everything:

  0  a course description being typed on a card above an empty canvas
  1  agents draft the modules and lessons onto the canvas row by row, a cursor (the person)
     approves each row and lifts one lesson out to rewrite it
  2  the agents stand on four pads, the chat agent's steps: first in a line, where a token
     visits them one after another, then side by side, where four tokens run at once
  3  the agents merge into a hub ringed by systems (the CRM and others); a question drops in
     and blue lines reach every system and come back
  4  the cursor leaves and the ring keeps going: contacts circle the hub, a pulse runs round
     the ring, and recovered payments drop onto a stack of coins

  Blue marks the live part of each step. The cursor is drawn in a second pass so it is
  always on top. Leader lines, ticks and the blue research lines are SVG over the canvas,
  placed from projected 3D points every frame.
*/

type Three = typeof THREE;
type V3 = [number, number, number];
/** Where the model sits on the stage, as fractions: left, top, right, bottom. */
type Frame = [number, number, number, number];

export type CalloutKey =
  | "card"
  | "canvas"
  | "agents"
  | "approve"
  | "edit"
  | "serial"
  | "parallel"
  | "question"
  | "contacts"
  | "coins";
export type NoteKey = "hub" | "crm";

export type DiscoDom = {
  callouts: Record<CalloutKey, Callout>;
  notes: Record<NoteKey, HTMLElement>;
  /** One tick per approved row of the canvas. */
  ticks: SVGPathElement[];
  /** Blue lines from the hub to each system, with a dot at the moving end. */
  spokes: SVGPathElement[];
  heads: SVGCircleElement[];
  /** The question's line down into the hub. */
  ask: SVGPathElement;
  /** The pulse that runs round the ring in the last step. */
  orbit: SVGPathElement;
  stats: HTMLElement;
  timeFill: HTMLElement;
  costFill: HTMLElement;
  timeNote: HTMLElement;
  costNote: HTMLElement;
};

const DEG = Math.PI / 180;
const ease = (t: number) => t * t * (3 - 2 * t);

/* ---- the course canvas (steps 0 and 1) ---- */
const COLS = [-1.32, 0, 1.32];
const ROWS = [-0.85, -0.2, 0.35, 0.9];
const BLOCK_W = 1.12;
/** Block k (row by row, the module row first) is drafted between at(k) and at(k) + PRINT. */
const at = (k: number) => 0.3 + k * 0.05;
const PRINT = 0.08;
const TRAVEL = 0.12;
/** The lesson the person lifts out and rewrites. */
const EDIT = 7;
/** When the cursor reaches each row's tick. */
const APPROVE_AT = [0.5, 0.65, 0.8, 0.95];
const TICK_X = 2.27;
/** The canvas runs wider on the right to hold the column of ticks. */
const BOARD_X = 0.22;
const BOARD_W = 4.75;

const CARD: V3 = [0, 0.95, -1.95];
const CARD_W = 2.9;
const CARD_H = 1.25;
const BAR_LEN = [2.25, 1.95, 2.35, 1.25];
const BAR_Y = [0.36, 0.17, -0.02, -0.21];
const BUTTON: V3 = [1.02, -0.42, 0.045];
const TYPE_TIME = 3;

/* ---- the chat agent's steps (step 2) ---- */
const PAD_SERIAL: V3[] = [-1.62, -0.54, 0.54, 1.62].map((x): V3 => [x, 0, 0]);
const PAD_LANES: V3[] = [-1.5, -0.5, 0.5, 1.5].map((z): V3 => [0, 0, z]);
const IN_SERIAL: V3 = [-2.72, 0, 0];
const OUT_SERIAL: V3 = [2.72, 0, 0];
const IN_LANES: V3 = [-2.0, 0, 0];
const OUT_LANES: V3 = [2.0, 0, 0];
const AGENT_Y = 0.44;
// Each step works for WORK seconds. Moving between steps takes HOP, in and out takes MOVE.
// HOP = 2 * MOVE makes the side-by-side run exactly a quarter of the one-after-another run.
const MOVE = 0.22;
const HOP = 0.44;
const WORK = 0.55;
const PAUSE = 1.1;
const SERIAL_TIME = 2 * MOVE + 3 * HOP + 4 * WORK;
const LANES_TIME = 2 * MOVE + WORK;

/* ---- the hub and its ring of systems (steps 3 and 4) ---- */
const HUB: V3 = [0, 0.7, 0];
const RING_R = 2.35;
const CHIP_R = 1.42;
const CHIPS = 16;
type Kind = "crm" | "box" | "hex" | "pyramid" | "slab" | "disc";
const SYSTEMS: { kind: Kind; angle: number }[] = [
  { kind: "crm", angle: 90 },
  { kind: "box", angle: 30 },
  { kind: "hex", angle: 330 },
  { kind: "pyramid", angle: 270 },
  { kind: "slab", angle: 210 },
  { kind: "disc", angle: 150 },
];
/** The system recovered payments come back through, and the stack they land on. */
const PAYER = 1;
const COINS: V3 = [1.62, 0, 2.72];
const COIN_H = 0.07;
const COIN_MAX = 13;
const COIN_PERIOD = 1.5;
const QUESTION: V3 = [0, 2.2, 0.1];

/* ---- camera: one shot per step, fitted to the points that matter ---- */
const boxPts = (min: V3, max: V3): V3[] =>
  Array.from({ length: 8 }, (_, k): V3 => [k & 1 ? max[0] : min[0], k & 2 ? max[1] : min[1], k & 4 ? max[2] : min[2]]);
const ringPts = (r: number, y0: number, y1: number, n = 24): V3[] =>
  Array.from({ length: n * 2 }, (_, i): V3 => {
    const a = ((i >> 1) / n) * Math.PI * 2;
    return [Math.cos(a) * r, i & 1 ? y1 : y0, Math.sin(a) * r];
  });
type Shot = { az: number; el: number; pts: V3[]; frame: Frame; /** Frame on a narrow stage (phones). */ narrow?: Frame };
const SHOTS: Shot[] = [
  {
    az: -22,
    el: 34,
    pts: [...boxPts([BOARD_X - BOARD_W / 2, -0.1, -1.55], [BOARD_X + BOARD_W / 2, 0, 1.55]), ...boxPts([-1.45, 0.32, -1.99], [1.45, 1.58, -1.91])],
    frame: [0.06, 0.13, 0.94, 0.84],
  },
  {
    az: -16,
    el: 50,
    pts: [...boxPts([-2.8, -0.1, -1.55], [BOARD_X + BOARD_W / 2, 0.7, 1.55]), ...boxPts([-1.45, 0.32, -1.99], [1.45, 1.58, -1.91])],
    frame: [0.17, 0.08, 0.8, 0.86],
    narrow: [0.2, 0.06, 0.95, 0.76],
  },
  { az: -10, el: 58, pts: boxPts([-2.2, 0, -1.8], [2.2, 0.5, 1.8]), frame: [0.06, 0.12, 0.94, 0.74] },
  { az: -26, el: 38, pts: [...ringPts(2.65, 0, 0.6), [0, 2.5, 0]], frame: [0.04, 0.12, 0.96, 0.88] },
  { az: -34, el: 36, pts: [...ringPts(2.65, 0, 0.6), ...boxPts([1.3, 0, 2.4], [2.0, 0.9, 3.1])], frame: [0.05, 0.1, 0.95, 0.8] },
];

type Fit = { az: number; el: number; tx: number; ty: number; tz: number; d: number; rx: number; ry: number };
const FIT_KEYS = ["az", "el", "tx", "ty", "tz", "d", "rx", "ry"] as const;

type CalloutSpec = { key: CalloutKey; side: Side; narrow?: Side; weight: (p: number) => number };

export function createDiscoScene(T: Three, ctx: SceneContext, dom: DiscoDom): BreakdownScene {
  const { canvas, host, position, reducedMotion, invalidate } = ctx;
  const palette = readPalette(host);
  const renderer = createRenderer(T, canvas);
  renderer.autoClear = false;

  const scene = new T.Scene();
  /** The cursor, drawn after everything else so nothing hides it. */
  const front = new T.Scene();
  const camera = new T.PerspectiveCamera(22, 1, 0.1, 200);
  paperLights(T, scene);
  paperLights(T, front);

  const ink = new T.Color(palette.ink);
  const blue = new T.Color(palette.agent);
  const [F0, F1, F2] = palette.fills;
  const world = new T.Group();
  scene.add(world);

  // ---- Pieces: one mesh, its own material and its own ink edges, so each can be faded
  // and tinted on its own.
  type Piece = {
    mesh: THREE.Mesh;
    mat: THREE.MeshLambertMaterial;
    edge: THREE.LineBasicMaterial;
    edgeOpacity: number;
    base: THREE.Color;
    /** Flat details (text lines) that fade with the piece. */
    extras: THREE.MeshBasicMaterial[];
  };
  const v3 = (p: V3) => new T.Vector3(p[0], p[1], p[2]);

  function piece(geo: THREE.BufferGeometry, fill: THREE.ColorRepresentation, edgeOpacity = 0.85): Piece {
    geo.computeBoundingBox();
    const mat = paperMaterial(T, fill);
    mat.transparent = true;
    const mesh = new T.Mesh(geo, mat);
    const edge = inkEdges(T, mesh, { color: palette.ink, opacity: edgeOpacity }).material as THREE.LineBasicMaterial;
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

  /** A flat grey bar, left end at the origin, lying in the XZ plane (or XY when upright). */
  const barGeo = new T.PlaneGeometry(1, 1).translate(0.5, 0, 0);
  const barFlatGeo = barGeo.clone().rotateX(-Math.PI / 2);
  function bar(owner: Piece, upright: boolean, width: number, color = "#c4c9d1", opacity = 1) {
    const mat = new T.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    mat.userData.base = opacity;
    const m = new T.Mesh(upright ? barGeo : barFlatGeo, mat);
    m.scale.set(1, upright ? width : 1, upright ? 1 : width);
    owner.extras.push(mat);
    owner.mesh.add(m);
    return m;
  }

  // ---- The canvas and its blocks ------------------------------------------------------
  const board = piece(new T.BoxGeometry(BOARD_W, 0.1, 3.1), F0);
  board.mesh.position.set(BOARD_X, -0.05, 0);
  world.add(board.mesh);

  // Dashed outlines of the empty slots.
  const slotPts: number[] = [];
  ROWS.forEach((z, r) => {
    const d = r === 0 ? 0.5 : 0.42;
    for (const x of COLS) {
      const x0 = x - BLOCK_W / 2;
      const x1 = x + BLOCK_W / 2;
      const z0 = z - d / 2;
      const z1 = z + d / 2;
      slotPts.push(x0, 0, z0, x1, 0, z0, x1, 0, z0, x1, 0, z1, x1, 0, z1, x0, 0, z1, x0, 0, z1, x0, 0, z0);
    }
  });
  const slotGeo = new T.BufferGeometry();
  slotGeo.setAttribute("position", new T.Float32BufferAttribute(slotPts, 3));
  const slotMat = new T.LineDashedMaterial({ color: palette.ink, dashSize: 0.07, gapSize: 0.06, transparent: true, opacity: 0.35, depthWrite: false });
  const slots = new T.LineSegments(slotGeo, slotMat);
  slots.computeLineDistances();
  slots.position.set(-BOARD_X, 0.051, 0);
  board.mesh.add(slots);

  type Block = { pc: Piece; r: number; c: number; h: number; rest: THREE.Vector3; bars: THREE.Mesh[]; lenA: number[]; lenB: number[] };
  const headGeo = new T.BoxGeometry(BLOCK_W, 0.14, 0.5);
  const lessonGeo = new T.BoxGeometry(BLOCK_W, 0.09, 0.42);
  const blocks: Block[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      const head = r === 0;
      const h = head ? 0.14 : 0.09;
      const pc = piece(head ? headGeo.clone() : lessonGeo.clone(), head ? F1 : F0);
      const lenA = head ? [0.62] : [0.74, 0.46];
      const lenB = head ? [0.62] : [0.5, 0.8];
      const bars = lenA.map((len, i) => {
        const b = bar(pc, false, head ? 0.085 : 0.05, head ? "#b9bec7" : "#c8ccd3");
        b.position.set(-0.44, h / 2 + 0.003, head ? 0 : i === 0 ? -0.075 : 0.075);
        b.scale.x = len;
        return b;
      });
      world.add(pc.mesh);
      blocks.push({ pc, r, c, h, rest: new T.Vector3(COLS[c], h / 2, ROWS[r]), bars, lenA, lenB });
    }
  }

  // ---- The description card -------------------------------------------------------------
  const card = piece(new T.BoxGeometry(CARD_W, CARD_H, 0.07), "#ffffff");
  card.mesh.position.set(...CARD);
  world.add(card.mesh);
  const cardBars = BAR_LEN.map((_, i) => {
    const b = bar(card, true, 0.075, "#b8bdc6");
    b.position.set(-1.25, BAR_Y[i], 0.037);
    return b;
  });
  const button = piece(new T.BoxGeometry(0.44, 0.17, 0.05), F1);
  button.mesh.position.set(...BUTTON);
  card.mesh.add(button.mesh);
  const caretMat = new T.MeshBasicMaterial({ color: palette.agent, transparent: true });
  const caret = new T.Mesh(new T.PlaneGeometry(0.03, 0.13), caretMat);
  card.mesh.add(caret);

  // ---- Agents ---------------------------------------------------------------------------
  const agentGeo = new T.OctahedronGeometry(0.16, 0);
  const agents = [0, 1, 2, 3].map(() => {
    const pc = piece(agentGeo.clone(), F0, 0.95);
    pc.mesh.scale.set(1, 1.4, 1);
    world.add(pc.mesh);
    return pc;
  });
  const spawn = [0, 1, 2, 3].map((a) => new T.Vector3(-0.9 + a * 0.6, 0.42, -1.78));
  const idle = [0, 1, 2, 3].map((a) => new T.Vector3(-2.62, 0.5, -1.0 + a * 0.6));

  // ---- The chat agent's steps -----------------------------------------------------------
  const padGeo = new T.CylinderGeometry(0.34, 0.34, 0.1, 6);
  const pads = [0, 1, 2, 3].map(() => {
    const pc = piece(padGeo.clone(), F1);
    world.add(pc.mesh);
    return pc;
  });
  const msgGeo = new T.BoxGeometry(0.5, 0.06, 0.34);
  const inMsg = piece(msgGeo.clone(), "#ffffff");
  const outMsg = piece(msgGeo.clone(), "#ffffff");
  for (const pc of [inMsg, outMsg]) {
    const b = bar(pc, false, 0.04, "#b8bdc6");
    b.position.set(-0.17, 0.034, -0.05);
    b.scale.x = 0.34;
    const b2 = bar(pc, false, 0.04, "#b8bdc6");
    b2.position.set(-0.17, 0.034, 0.05);
    b2.scale.x = 0.22;
    world.add(pc.mesh);
  }
  const tokenGeo = new T.IcosahedronGeometry(0.1, 0);
  const tokenMat = new T.MeshBasicMaterial({ color: palette.agent, transparent: true });
  const tokens = [0, 1, 2, 3].map(() => {
    const m = new T.Mesh(tokenGeo, tokenMat);
    world.add(m);
    return m;
  });
  // Connectors on the floor: one set for the line, one for the lanes.
  const wire = (segments: number) => {
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(new Float32Array(segments * 6), 3));
    const mat = new T.LineBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.4, depthWrite: false });
    const lines = new T.LineSegments(geo, mat);
    lines.frustumCulled = false;
    world.add(lines);
    return { geo, mat, lines, attr: geo.getAttribute("position") as THREE.BufferAttribute };
  };
  const serialWire = wire(5);
  const laneWire = wire(8);

  // ---- Hub and ring ----------------------------------------------------------------------
  const pedestal = piece(new T.CylinderGeometry(0.44, 0.52, 0.12, 6), F1);
  pedestal.mesh.position.y = 0.06;
  world.add(pedestal.mesh);
  const hub = piece(new T.IcosahedronGeometry(0.46, 0), F0);
  hub.mesh.position.set(...HUB);
  world.add(hub.mesh);

  const circle = (r: number, n: number) => {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      pts.push(Math.cos(a0) * r, 0.004, Math.sin(a0) * r, Math.cos(a1) * r, 0.004, Math.sin(a1) * r);
    }
    return pts;
  };
  const floorLines = (pts: number[], opacity: number, dashed = false) => {
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
    const mat = dashed
      ? new T.LineDashedMaterial({ color: palette.ink, dashSize: 0.06, gapSize: 0.07, transparent: true, opacity, depthWrite: false })
      : new T.LineBasicMaterial({ color: palette.ink, transparent: true, opacity, depthWrite: false });
    const lines = new T.LineSegments(geo, mat);
    if (dashed) lines.computeLineDistances();
    mat.userData.base = opacity;
    world.add(lines);
    return lines;
  };
  const ringLine = floorLines(circle(RING_R, 120), 0.45);
  const spokePts: number[] = [];
  for (const s of SYSTEMS) {
    const a = s.angle * DEG;
    spokePts.push(Math.cos(a) * 0.62, 0.004, Math.sin(a) * 0.62, Math.cos(a) * (RING_R - 0.48), 0.004, Math.sin(a) * (RING_R - 0.48));
  }
  const spokeLines = floorLines(spokePts, 0.25);
  const chipTrack = floorLines(circle(CHIP_R, 90), 0.3, true);
  const ringFloor = [ringLine, spokeLines, chipTrack];

  type System = { parts: Piece[]; at: THREE.Vector3; top: number };
  const systems: System[] = SYSTEMS.map((s) => {
    const a = s.angle * DEG;
    const x = Math.cos(a) * RING_R;
    const z = Math.sin(a) * RING_R;
    const parts: Piece[] = [];
    let top = 0.5;
    const add = (geo: THREE.BufferGeometry, y: number, fill: string, rotY = 0) => {
      const pc = piece(geo, fill);
      pc.mesh.position.set(x, y, z);
      pc.mesh.rotation.y = rotY;
      pc.mesh.userData.y = y;
      world.add(pc.mesh);
      parts.push(pc);
    };
    const face = -a + Math.PI / 2;
    switch (s.kind) {
      case "crm":
        for (let i = 0; i < 3; i++) add(new T.CylinderGeometry(0.36, 0.36, 0.13, 10), 0.07 + i * 0.165, i === 1 ? F1 : F0);
        top = 0.48;
        break;
      case "box":
        add(new T.BoxGeometry(0.56, 0.5, 0.56), 0.25, F0, face);
        break;
      case "hex":
        add(new T.CylinderGeometry(0.34, 0.34, 0.52, 6), 0.26, F1);
        top = 0.52;
        break;
      case "pyramid":
        add(new T.CylinderGeometry(0, 0.44, 0.62, 4), 0.31, F0, face);
        top = 0.5;
        break;
      case "slab":
        add(new T.BoxGeometry(0.5, 0.68, 0.12), 0.34, F0, face);
        top = 0.6;
        break;
      case "disc":
        add(new T.CylinderGeometry(0.4, 0.4, 0.16, 8), 0.08, F1);
        add(new T.CylinderGeometry(0.22, 0.22, 0.16, 8), 0.24, F0);
        top = 0.32;
        break;
    }
    return { parts, at: new T.Vector3(x, 0, z), top };
  });

  const chipGeo = new T.BoxGeometry(0.21, 0.03, 0.14);
  const chips = Array.from({ length: CHIPS }, (_, i) => {
    const pc = piece(chipGeo.clone(), "#ffffff", 0.75);
    world.add(pc.mesh);
    return { pc, alert: i % 5 === 2 };
  });

  const coinGeo = new T.CylinderGeometry(0.3, 0.3, 0.06, 9);
  const coins = Array.from({ length: COIN_MAX + 1 }, () => {
    const pc = piece(coinGeo.clone(), F1);
    world.add(pc.mesh);
    return pc;
  });

  const question = piece(new T.BoxGeometry(0.74, 0.46, 0.05), "#ffffff");
  for (const [y, len] of [
    [0.08, 0.5],
    [-0.06, 0.34],
  ] as const) {
    const b = bar(question, true, 0.055, "#b8bdc6");
    b.position.set(-0.27, y, 0.027);
    b.scale.x = len;
  }
  world.add(question.mesh);

  // ---- The cursor: the person ----------------------------------------------------------
  const arrow = new T.Shape();
  arrow.moveTo(0, 0);
  arrow.lineTo(0, -1);
  arrow.lineTo(0.26, -0.77);
  arrow.lineTo(0.44, -1.16);
  arrow.lineTo(0.6, -1.09);
  arrow.lineTo(0.42, -0.71);
  arrow.lineTo(0.76, -0.71);
  arrow.lineTo(0, 0);
  const cursor = piece(new T.ExtrudeGeometry(arrow, { depth: 0.16, bevelEnabled: false }).translate(0, 0, -0.16), "#ffffff", 1);
  const cursorRig = new T.Group();
  cursorRig.add(cursor.mesh);
  front.add(cursorRig);

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
  const fits: Fit[] = SHOTS.map(() => ({ az: 0, el: 0, tx: 0, ty: 0, tz: 0, d: 1, rx: 0, ry: 0 }));
  const callouts = Object.values(dom.callouts);
  const noteSizes = new Map<HTMLElement, { w: number; h: number }>();

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
    const f = width < 520 && s.narrow ? s.narrow : s.frame;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = (tan * (f[2] - f[0]) * width) / height;
    const tanV = tan * (f[3] - f[1]);
    let d = 1;
    for (const q of pts) d = Math.max(d, q.z + Math.abs(q.x - xm) / tanH, q.z + Math.abs(q.y - ym) / tanV);
    out.d = d;
    out.rx = ((f[0] + f[2]) / 2) * width;
    out.ry = ((f[1] + f[3]) / 2) * height;
  }

  function resize() {
    const size = sizeRenderer(renderer, camera);
    if (!size) return;
    width = size.width;
    height = size.height;
    SHOTS.forEach((s, i) => solve(s, fits[i]));
    remeasureCallouts(callouts);
    noteSizes.clear();
  }

  const cam: Fit & { set: boolean } = { az: 0, el: 0, tx: 0, ty: 0, tz: 0, d: 1, rx: 0, ry: 0, set: false };
  const target = new T.Vector3();
  function placeCamera(p: number, dt: number) {
    const e = !cam.set || reducedMotion || dt === 0 ? 1 : 1 - Math.exp(-dt * 6);
    for (const k of FIT_KEYS) cam[k] = lerp(cam[k], track(fits.map((f) => f[k]), p), e);
    cam.set = true;
    const sway = reducedMotion ? 0 : 0.03 * Math.sin(time * 0.27) + (p > 3.3 ? 0.06 * Math.sin(time * 0.16) * ramp(p, 3.3, 3.8) : 0);
    basis(cam.az + dragAz + sway, Math.min(1.4, Math.max(0.1, cam.el + dragEl)));
    target.set(cam.tx, cam.ty, cam.tz);
    camera.position.copy(target).addScaledVector(vD, cam.d);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.setViewOffset(width, height, width / 2 - cam.rx, height / 2 - cam.ry, width, height);
    camera.updateMatrixWorld(true);
  }

  // ---- Motion helpers ------------------------------------------------------------------------
  const tmpA = new T.Vector3();
  const tmpB = new T.Vector3();
  const tmpC = new T.Vector3();
  /** Linear move from a to b with a hop of `lift` at the middle. */
  function arc(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number, lift: number) {
    out.lerpVectors(a, b, t);
    out.y += lift * 4 * t * (1 - t);
    return out;
  }
  const hoverOf = (k: number, out: THREE.Vector3) => out.set(blocks[k].rest.x, blocks[k].h + 0.42, blocks[k].rest.z);

  /** Where agent a is while the canvas fills: it drafts blocks a, a + 4 and a + 8. */
  function agentOnCanvas(a: number, p: number, out: THREE.Vector3) {
    const prev = tmpA.copy(spawn[a]);
    for (let j = 0; j < 3; j++) {
      const k = a + j * 4;
      const t0 = at(k) - TRAVEL;
      const t1 = at(k);
      hoverOf(k, tmpB);
      if (p < t0) return out.copy(prev);
      if (p < t1) return arc(out, prev, tmpB, ease(ramp(p, t0, t1)), 0.3);
      prev.copy(tmpB);
    }
    const tl = at(a + 8) + PRINT;
    return arc(out, prev, idle[a], ease(ramp(p, tl, tl + 0.1)), 0.2);
  }

  const padPos = PAD_SERIAL.map((s) => v3(s));
  const inPos = new T.Vector3();
  const outPos = new T.Vector3();
  const serialPts = [new T.Vector3(), ...padPos.map(() => new T.Vector3()), new T.Vector3()];
  const lanePts = padPos.map(() => new T.Vector3());

  /** The token in the one-after-another run, at run time tau. Returns the step it is in. */
  function serialToken(tau: number, out: THREE.Vector3) {
    let t = tau;
    const p = serialPts;
    if (t < MOVE) {
      out.lerpVectors(p[0], p[1], ease(t / MOVE));
      return -1;
    }
    t -= MOVE;
    for (let i = 0; i < 4; i++) {
      if (t < WORK) {
        out.copy(p[i + 1]);
        return i;
      }
      t -= WORK;
      const d = i < 3 ? HOP : MOVE;
      if (t < d) {
        arc(out, p[i + 1], p[i + 2], ease(t / d), 0.12);
        return -1;
      }
      t -= d;
    }
    out.copy(p[5]);
    return -1;
  }
  /** A token in one lane of the side-by-side run. Returns true while its step works. */
  function laneToken(i: number, tau: number, out: THREE.Vector3) {
    const a = serialPts[0];
    const b = lanePts[i];
    const c = serialPts[5];
    if (tau < MOVE) {
      out.lerpVectors(a, b, ease(tau / MOVE));
      return false;
    }
    if (tau < MOVE + WORK) {
      out.copy(b);
      return true;
    }
    if (tau < LANES_TIME) {
      out.lerpVectors(b, c, ease((tau - MOVE - WORK) / MOVE));
      return false;
    }
    out.copy(c);
    return false;
  }

  // ---- Overlays ------------------------------------------------------------------------------
  const project = createProjector(T);
  const screenBox = createScreenBox(T);
  const box: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const sp: ScreenPoint = { x: 0, y: 0, behind: false };
  const sp2: ScreenPoint = { x: 0, y: 0, behind: false };
  const f1 = (n: number) => n.toFixed(1);
  const setOpacity = (el: Element, o: number) => {
    (el as HTMLElement | SVGElement).style.opacity = o > 0.01 ? o.toFixed(3) : "0";
  };
  const toScreen = (v: THREE.Vector3, out: ScreenPoint = sp) => project(v, camera, width, height, out);

  /** Puts a plain note so (x, y) sits at its top centre. */
  function note(el: HTMLElement, x: number, y: number, o: number) {
    setOpacity(el, o);
    if (o <= 0.01) return;
    let s = noteSizes.get(el);
    if (!s || !s.w) {
      s = { w: el.offsetWidth, h: el.offsetHeight };
      noteSizes.set(el, s);
    }
    const left = Math.min(Math.max(x - s.w / 2, 4), width - s.w - 4);
    const top = Math.min(Math.max(y, 4), height - s.h - 4);
    el.style.transform = `translate3d(${f1(left)}px, ${f1(top)}px, 0)`;
  }

  const CALLOUTS: CalloutSpec[] = [
    { key: "card", side: "top", weight: (p) => near(p, 0, 0.25, 0.5) },
    { key: "canvas", side: "bottom", weight: (p) => near(p, 0, 0.2, 0.4) },
    { key: "agents", side: "left", weight: (p) => near(p, 1, 0.14, 0.3) },
    { key: "approve", side: "right", narrow: "top", weight: (p) => near(p, 1, 0.14, 0.3) },
    { key: "edit", side: "bottom", weight: (p) => near(p, 1, 0.14, 0.3) * ramp(p, 0.9, 0.97) },
    { key: "serial", side: "top", weight: (p) => near(p, 1.62, 0.12, 0.26) },
    { key: "parallel", side: "top", weight: (p) => near(p, 2, 0.12, 0.3) },
    { key: "question", side: "top", weight: (p) => near(p, 3, 0.2, 0.4) },
    { key: "contacts", side: "bottom", weight: (p) => near(p, 4, 0.25, 0.45) },
    { key: "coins", side: "bottom", weight: (p) => near(p, 4, 0.25, 0.45) },
  ];
  const placements: CalloutPlacement[] = CALLOUTS.map((c) => ({ callout: dom.callouts[c.key], x: 0, y: 0, side: c.side, opacity: 0 }));
  const anchors: Record<CalloutKey, THREE.Vector3> = {
    card: new T.Vector3(),
    canvas: new T.Vector3(),
    agents: new T.Vector3(),
    approve: new T.Vector3(),
    edit: new T.Vector3(),
    serial: new T.Vector3(),
    parallel: new T.Vector3(),
    question: new T.Vector3(),
    contacts: new T.Vector3(),
    coins: new T.Vector3(),
  };

  // ---- State that runs on time --------------------------------------------------------------
  let time = 0;
  let typeT = 0;
  let editT = 0;
  let runT = 0;
  let runMode = 0;
  let coinT = 0;
  let lastP = -1;
  let firstRun = true;

  const agentPos = agents.map(() => new T.Vector3());
  const cursorPos = new T.Vector3();
  const cursorKeys: [number, THREE.Vector3][] = [];
  const sendAt = new T.Vector3(CARD[0] + BUTTON[0] + 0.06, CARD[1] + BUTTON[1] - 0.04, CARD[2] + 0.12);
  cursorKeys.push([0, sendAt], [0.3, sendAt]);
  APPROVE_AT.forEach((t, r) => {
    const v = new T.Vector3(TICK_X + 0.05, 0.05, ROWS[r] + 0.05);
    if (r > 0) cursorKeys.push([t - 0.12, cursorKeys[cursorKeys.length - 1][1]]);
    cursorKeys.push([t, v]);
  });
  const restAt = cursorKeys[cursorKeys.length - 1][1];
  function cursorOnCanvas(p: number, out: THREE.Vector3) {
    if (p <= cursorKeys[0][0]) return out.copy(cursorKeys[0][1]);
    for (let i = 1; i < cursorKeys.length; i++) {
      const [t1, b] = cursorKeys[i];
      if (p < t1) {
        const [t0, a] = cursorKeys[i - 1];
        return arc(out, a, b, ease(ramp(p, t0, t1)), 0.25);
      }
    }
    return out.copy(restAt);
  }

  const qOff = new T.Vector3(-3.4, 3.4, 0.6);
  const qExit = new T.Vector3(-3.6, 3.2, 1.2);
  const qHold = v3(QUESTION);
  const grip = new T.Vector3(0.3, -0.16, 0.08);

  function frame(dt: number) {
    time += dt;
    const p = Math.min(4, Math.max(0, position.current ?? 0));

    // Scrolling eases a drag back to the story's view.
    if (lastP >= 0 && !dragging) {
      const dp = Math.abs(p - lastP);
      if (dp > 0) {
        const k = Math.min(1, dp * 2.5);
        dragAz *= 1 - k;
        dragEl *= 1 - k;
      }
    }
    lastP = p;
    if (!dragging && Math.abs(velAz) > 1e-3) {
      dragAz += velAz * dt;
      velAz *= Math.exp(-dt * 3.2);
    }

    placeCamera(p, dt);

    // ---- Step 0: the description is typed, then sent ----------------------------------------
    if (p < 0.25 && !reducedMotion) typeT += dt;
    else if (p > 0.6) typeT = 0;
    if (firstRun && p >= 0.25) typeT = TYPE_TIME + 1;
    const typed = reducedMotion || p >= 0.25 ? 1 : clamp01(typeT / TYPE_TIME);
    const sent = reducedMotion ? (p >= 0.25 ? 1 : 0) : p >= 0.25 ? 1 : ramp(typeT, TYPE_TIME + 0.35, TYPE_TIME + 0.5);
    const press = reducedMotion ? 0 : ramp(typeT, TYPE_TIME + 0.25, TYPE_TIME + 0.4) * (1 - ramp(typeT, TYPE_TIME + 0.5, TYPE_TIME + 0.7));

    const wCanvas = 1 - ramp(p, 1.12, 1.4);
    const sink = ramp(p, 1.12, 1.4);
    const wCard = 1 - ramp(p, 1.1, 1.35);
    card.mesh.position.set(CARD[0], CARD[1] + 0.35 * ramp(p, 1.1, 1.35), CARD[2]);
    shade(card, wCard, near(p, 0, 0.2, 0.45), 0.13);
    shade(button, wCard, sent * (1 - ramp(p, 0.4, 0.7)), 0.5);
    button.mesh.position.z = BUTTON[2] - press * 0.03;
    let filled = typed * BAR_LEN.reduce((s, v) => s + v, 0);
    let caretX = -1.25;
    let caretY = BAR_Y[0];
    cardBars.forEach((b, i) => {
      const len = Math.min(BAR_LEN[i], Math.max(0, filled));
      b.scale.x = Math.max(len, 1e-4);
      b.visible = len > 0.001;
      if (filled > 0 || i === 0) {
        caretX = -1.25 + len + 0.04;
        caretY = BAR_Y[i];
      }
      filled -= BAR_LEN[i];
    });
    caret.position.set(caretX, caretY, 0.037);
    const blink = typed < 1 || reducedMotion ? 1 : Math.sin(time * 7) > -0.2 ? 1 : 0;
    caretMat.opacity = wCard * blink * (1 - ramp(p, 0.15, 0.3));
    caret.visible = caretMat.opacity > 0.01;

    // ---- Step 1: blocks drafted onto the canvas, rows approved, one lesson rewritten ---------
    const wEdit = ramp(p, 0.93, 1.02) * (1 - ramp(p, 1.1, 1.25));
    if (wEdit > 0 && !reducedMotion) editT += dt;
    else if (wEdit === 0) editT = 0;
    const EP = 5.6;
    const e = reducedMotion ? 2.8 : editT % EP;
    const loop = Math.floor(editT / EP);
    const reach = ease(ramp(e, 0.2, 1.0)) * (1 - ease(ramp(e, 3.7, 4.7)));
    const lift = ease(ramp(e, 1.0, 1.45)) * (1 - ease(ramp(e, 2.95, 3.4))) * wEdit;
    const rewrite = e < 2.0 ? 1 - ramp(e, 1.55, 1.95) : ramp(e, 2.05, 2.6);
    const editTint = ramp(e, 0.95, 1.2) * (1 - ramp(e, 3.4, 3.9)) * wEdit;

    blocks.forEach((b, k) => {
      const s = at(k);
      const t = ramp(p, s, s + PRINT);
      const pc = b.pc;
      const shown = p >= s ? 1 : 0;
      if (t < 1) {
        hoverOf(k, tmpB);
        tmpB.y -= 0.18;
        pc.mesh.position.lerpVectors(tmpB, b.rest, 1 - (1 - t) * (1 - t));
        pc.mesh.scale.setScalar(lerp(0.3, 1, t));
      } else {
        pc.mesh.position.copy(b.rest);
        pc.mesh.scale.setScalar(1);
      }
      pc.mesh.position.y -= 0.5 * sink;
      pc.mesh.rotation.z = 0;
      let tint = t > 0 ? (t < 1 ? 1 : 1 - ramp(p, s + PRINT, s + PRINT + 0.07)) : 0;
      if (k === EDIT) {
        pc.mesh.position.y += 0.45 * lift;
        pc.mesh.rotation.z = -0.07 * lift;
        tint = Math.max(tint, editTint);
        const from = loop % 2 ? b.lenB : b.lenA;
        const to = loop % 2 ? b.lenA : b.lenB;
        b.bars.forEach((bar, i) => {
          const len = wEdit > 0 ? (e < 2.0 ? from[i] * rewrite : to[i] * rewrite) : b.lenA[i];
          bar.scale.x = Math.max(len, 1e-4);
        });
      }
      shade(pc, shown * wCanvas, tint, 0.3);
    });
    board.mesh.position.y = -0.05 - 0.5 * sink;
    shade(board, wCanvas);
    slotMat.opacity = 0.35 * wCanvas * (1 - 0.6 * ramp(p, 0.3, 0.9));
    slots.visible = slotMat.opacity > 0.01;

    // ---- Agents: draft, line up as steps, then merge into the hub --------------------------
    const m = ramp(p, 1.78, 1.98);
    const rise = ramp(p, 1.22, 1.48);
    const fall = ramp(p, 2.2, 2.45);
    const wPipe = rise * (1 - fall);
    const pipeY = -0.45 * (1 - rise) - 0.45 * fall;
    padPos.forEach((v, i) => {
      const mi = ease(ramp(p, 1.76 + i * 0.03, 1.92 + i * 0.03));
      v.set(lerp(PAD_SERIAL[i][0], PAD_LANES[i][0], mi), 0.05 + pipeY, lerp(PAD_SERIAL[i][2], PAD_LANES[i][2], mi));
    });
    inPos.set(lerp(IN_SERIAL[0], IN_LANES[0], ease(m)), 0.03 + pipeY, 0);
    outPos.set(lerp(OUT_SERIAL[0], OUT_LANES[0], ease(m)), 0.03 + pipeY, 0);
    serialPts[0].set(inPos.x, AGENT_Y + pipeY, 0);
    padPos.forEach((v, i) => {
      serialPts[i + 1].set(v.x, AGENT_Y + pipeY, v.z);
      lanePts[i].set(v.x, AGENT_Y + pipeY, v.z);
    });
    serialPts[5].set(outPos.x, AGENT_Y + pipeY, 0);

    // The run clock: one run, a pause with the reply showing, then the next run.
    const runLen = runMode ? LANES_TIME : SERIAL_TIME;
    if (reducedMotion) {
      runMode = m > 0.5 ? 1 : 0;
      runT = MOVE + WORK * 0.5;
    } else if (wPipe > 0.01) {
      runT += dt;
      // Start over when the run ends, or straight away when the steps re-form.
      const want = m > 0.5 ? 1 : 0;
      if (runT > runLen + PAUSE || want !== runMode) {
        runT = 0;
        runMode = want;
      }
    } else {
      runT = 0;
      runMode = m > 0.5 ? 1 : 0;
    }
    const len = runMode ? LANES_TIME : SERIAL_TIME;
    const running = runT < len;
    const working = [0, 0, 0, 0];
    if (runMode) {
      for (let i = 0; i < 4; i++) {
        if (laneToken(i, runT, tokens[i].position)) working[i] = 1;
        tokens[i].visible = running && wPipe > 0.01;
      }
    } else {
      const w = serialToken(runT, tokens[0].position);
      if (w >= 0) working[w] = 1;
      tokens[0].visible = running && wPipe > 0.01;
      for (let i = 1; i < 4; i++) tokens[i].visible = false;
    }
    tokenMat.opacity = wPipe;
    for (const tk of tokens) tk.rotation.set(time * 2, time * 3, 0);

    pads.forEach((pc, i) => {
      pc.mesh.position.copy(padPos[i]);
      shade(pc, wPipe, working[i] * 0.6, 0.25);
    });
    inMsg.mesh.position.copy(inPos);
    shade(inMsg, wPipe);
    // The reply: an empty card that fills in when the run finishes.
    const reply = running ? 0 : ramp(runT, len, len + 0.15);
    outMsg.mesh.position.copy(outPos);
    outMsg.mesh.position.y += 0.06 * reply * (1 - ramp(runT, len + 0.15, len + 0.5));
    for (const b of outMsg.mesh.children) if ((b as THREE.Mesh).isMesh) b.visible = reply > 0.01;
    shade(outMsg, wPipe, reply * (1 - ramp(runT, len + 0.4, len + 1.0)), 0.3);
    // Connectors, from the current pad positions.
    const setWire = (w: ReturnType<typeof wire>, pairs: THREE.Vector3[][], o: number) => {
      pairs.forEach(([a, b], i) => {
        w.attr.setXYZ(i * 2, a.x, 0.01 + pipeY, a.z);
        w.attr.setXYZ(i * 2 + 1, b.x, 0.01 + pipeY, b.z);
      });
      w.attr.needsUpdate = true;
      w.mat.opacity = 0.4 * o;
      w.lines.visible = o > 0.01;
    };
    setWire(serialWire, [0, 1, 2, 3, 4].map((i) => [i === 0 ? inPos : padPos[i - 1], i === 4 ? outPos : padPos[i]]), wPipe * (1 - m));
    setWire(laneWire, [0, 1, 2, 3].flatMap((i) => [[inPos, padPos[i]], [padPos[i], outPos]]), wPipe * m);

    const hubGrow = ease(ramp(p, 2.3, 2.6));
    agents.forEach((pc, a) => {
      const pos = agentPos[a];
      agentOnCanvas(a, p, pos);
      // To its step's pad.
      tmpC.copy(padPos[a]);
      tmpC.y = AGENT_Y + pipeY + 0.08 * working[a];
      arc(pos, pos, tmpC, ease(ramp(p, 1.14 + a * 0.03, 1.44 + a * 0.03)), 0.5);
      // Into the hub.
      const toHub = ease(ramp(p, 2.18 + a * 0.02, 2.46 + a * 0.02));
      if (toHub > 0) arc(pos, pos, tmpB.set(...HUB), toHub, 0.3);
      pc.mesh.position.copy(pos);
      if (!reducedMotion) pc.mesh.position.y += 0.03 * Math.sin(time * 2.2 + a * 1.7) * (1 - working[a]);
      const appear = ramp(p, at(a) - 0.17, at(a) - 0.12);
      const gone = ramp(p, 2.36, 2.5);
      const size = appear * (1 - gone) * (1 + 0.18 * working[a]);
      pc.mesh.scale.set(size, size * 1.4, size);
      if (!reducedMotion) pc.mesh.rotation.y += dt * (0.7 + 5 * working[a]);
      const live = 0.55 + 0.45 * working[a];
      shade(pc, size > 0.01 ? 1 : 0, live, 0.42);
    });

    // ---- Step 2 numbers -------------------------------------------------------------------------
    const wStats = near(p, 2, 0.3, 0.5) * rise;
    setOpacity(dom.stats, wStats);
    if (wStats > 0.01) {
      const elapsed = (reducedMotion ? len : Math.min(runT, len)) / SERIAL_TIME;
      dom.timeFill.style.transform = `scaleX(${elapsed.toFixed(4)})`;
      dom.costFill.style.transform = `scaleX(${lerp(1, 0.42, m).toFixed(4)})`;
      setOpacity(dom.timeNote, m);
      setOpacity(dom.costNote, m);
    }

    // ---- Step 3: hub, ring and the question --------------------------------------------------
    hub.mesh.scale.setScalar(Math.max(0.001, hubGrow));
    if (!reducedMotion) {
      hub.mesh.rotation.y += dt * 0.35;
      hub.mesh.rotation.x = 0.3 * Math.sin(time * 0.4);
    }
    const w3 = near(p, 3, 0.25, 0.5);
    const w4 = near(p, 4, 0.3, 0.55);
    // The research loop: lines go out to every system, hold, and come back to the hub.
    const RP = 3.6;
    const sig = reducedMotion ? 1.5 : time % RP;
    const out3 = ramp(sig, 0.25, 1.0);
    const back3 = ramp(sig, 1.9, 2.6);
    const reachLen = back3 > 0 ? 1 - back3 : out3;
    const flash = ramp(sig, 0.9, 1.05) * (1 - ramp(sig, 1.9, 2.4)) * w3;
    const hubFlash = reducedMotion ? 0 : ramp(sig, 2.5, 2.65) * (1 - ramp(sig, 3.0, 3.5)) * w3;
    shade(hub, hubGrow > 0.01 ? 1 : 0, Math.max(hubFlash, 0.15 * w3), 0.35);
    pedestal.mesh.position.y = 0.06 - 0.3 * (1 - hubGrow);
    shade(pedestal, hubGrow);

    const ringIn = ramp(p, 2.3, 2.6);
    for (const l of ringFloor) {
      const mat = l.material as THREE.LineBasicMaterial;
      mat.opacity = ringIn * (mat.userData.base as number) * (l === chipTrack ? ramp(p, 3.2, 3.6) : 1);
      l.visible = mat.opacity > 0.01;
    }

    // Recovered payments: one coin at a time from the paying system onto the stack.
    if (w4 > 0.5 && !reducedMotion) coinT += dt;
    else if (w4 < 0.05) coinT = 0;
    const coinBase = Math.round(lerp(0, 5, ramp(p, 3.35, 3.8)));
    const landed = Math.floor(coinT / COIN_PERIOD);
    const n = reducedMotion ? (p > 3.6 ? 10 : coinBase) : Math.min(COIN_MAX, coinBase + landed);
    const cf = (coinT % COIN_PERIOD) / COIN_PERIOD;
    const flying = !reducedMotion && coinT > 0 && n < COIN_MAX && w4 > 0.5;
    const coinGlow = flying ? (1 - ramp(cf, 0.12, 0.4)) * w4 : 0;

    // A pulse runs round the ring in step 4; each system lights as it passes.
    const pulseA = reducedMotion ? 100 * DEG : time * 0.9;
    systems.forEach((s, k) => {
      const r = ease(ramp(p, 2.32 + k * 0.045, 2.56 + k * 0.045));
      const a = SYSTEMS[k].angle * DEG;
      let behind = (((pulseA - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (reducedMotion) behind = 9;
      const lit4 = behind < 0.9 ? 1 - behind / 0.9 : 0;
      const tint = Math.max(flash, lit4 * w4, PAYER === k ? coinGlow : 0);
      for (const pc of s.parts) {
        pc.mesh.position.y = (pc.mesh.userData.y as number) - 0.5 * (1 - r);
        shade(pc, r, tint, 0.3);
      }
    });

    // Contacts circling the hub.
    const chipIn = ramp(p, 3.2, 3.6);
    chips.forEach((c, i) => {
      const a = (i / CHIPS) * Math.PI * 2 - (reducedMotion ? 0 : time * 0.22);
      c.pc.mesh.position.set(Math.cos(a) * CHIP_R, 0.02 + 0.2 * (1 - chipIn), Math.sin(a) * CHIP_R);
      c.pc.mesh.rotation.y = -a;
      shade(c.pc, chipIn * (i / CHIPS < chipIn * 1.2 ? 1 : 0), c.alert ? 1 : 0, 0.32);
    });

    // The question arrives with the cursor and stays over the hub.
    const qa = ease(ramp(p, 2.45, 2.85));
    const qx = ease(ramp(p, 3.12, 3.45));
    const wQ = ramp(p, 2.45, 2.62) * (1 - ramp(p, 3.18, 3.4));
    arc(tmpA, qOff, qHold, qa, 0);
    question.mesh.position.copy(tmpA);
    question.mesh.rotation.set(0, cam.az + dragAz, 0);
    shade(question, wQ, w3, 0.3);

    // ---- Step 4: recovered payments land on a stack --------------------------------------------
    coins.forEach((pc, j) => {
      if (j < COIN_MAX) {
        pc.mesh.position.set(COINS[0] + 0.012 * Math.sin(j * 2.3), COIN_H / 2 + j * COIN_H, COINS[2] + 0.012 * Math.cos(j * 1.7));
        pc.mesh.rotation.y = j * 0.4;
        const latest = j === n - 1 && landed > 0 && !reducedMotion ? 1 - ramp(cf, 0, 0.5) : 0;
        shade(pc, j < n ? ramp(p, 3.35, 3.6) : 0, latest, 0.35);
      } else {
        const sys = systems[PAYER];
        tmpB.set(sys.at.x, sys.top + 0.1, sys.at.z);
        tmpC.set(COINS[0], COIN_H / 2 + n * COIN_H, COINS[2]);
        arc(pc.mesh.position, tmpB, tmpC, ease(ramp(cf, 0, 0.75)), 0.9);
        pc.mesh.rotation.set(time * 3, n * 0.4, 0);
        if (cf > 0.75) pc.mesh.rotation.set(0, n * 0.4, 0);
        shade(pc, flying ? ramp(cf, 0, 0.08) : 0, 1, 0.35);
      }
    });

    // ---- The cursor -----------------------------------------------------------------------------
    let wCursor = 0;
    if (p < 1.6) {
      cursorOnCanvas(p, cursorPos);
      if (p < 0.3) cursorPos.z -= press * 0.1;
      // The edit: reach for the lesson, lift it with the block, put it back, come away.
      const eb = blocks[EDIT];
      tmpB.set(eb.rest.x + 0.42, eb.h + 0.03 + 0.45 * lift, eb.rest.z + 0.12);
      tmpB.y -= 0.5 * sink;
      cursorPos.lerp(tmpB, reach * wEdit);
      // Off and away after the canvas.
      const leave = ease(ramp(p, 1.1, 1.38));
      cursorPos.x += leave * 1.6;
      cursorPos.y += leave * 1.2;
      wCursor = 1 - ramp(p, 1.12, 1.36);
    } else {
      arc(cursorPos, qOff, qHold, qa, 0).add(grip);
      cursorPos.lerp(qExit, qx);
      wCursor = ramp(p, 2.45, 2.6) * (1 - ramp(p, 3.25, 3.45));
    }
    cursorRig.position.copy(cursorPos);
    cursorRig.quaternion.copy(camera.quaternion);
    cursorRig.rotateY(-0.5);
    cursorRig.rotateZ(0.12);
    // Constant size on screen: about 26 px tall.
    const dist = camera.position.distanceTo(cursorPos);
    const px = Math.min(30, Math.max(19, height * 0.034));
    cursorRig.scale.setScalar((px / height) * 2 * dist * Math.tan((camera.fov * Math.PI) / 360) / 1.16);
    shade(cursor, wCursor);

    scene.updateMatrixWorld(true);
    front.updateMatrixWorld(true);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(front, camera);

    overlays(p, { sink, wCanvas, w3, w4, reachLen, sig, pulseA, wQ, m });
    firstRun = false;
  }

  type Weights = { sink: number; wCanvas: number; w3: number; w4: number; reachLen: number; sig: number; pulseA: number; wQ: number; m: number };
  function overlays(p: number, w: Weights) {
    screenBox(world, camera, width, height, box, 0.5);

    // Ticks beside each row once it's approved.
    dom.ticks.forEach((tk, r) => {
      const on = ramp(p, APPROVE_AT[r] - 0.01, APPROVE_AT[r] + 0.025) * w.wCanvas * (1 - ramp(p, 1.05, 1.2));
      setOpacity(tk, on);
      if (on <= 0.01) return;
      toScreen(tmpA.set(TICK_X, -0.5 * w.sink, ROWS[r]));
      const s = 0.6 + 0.4 * on;
      tk.setAttribute("transform", `translate(${f1(sp.x)} ${f1(sp.y)}) scale(${s.toFixed(2)})`);
    });

    // Blue lines from the hub to each system and back.
    toScreen(tmpA.set(...HUB), sp2);
    systems.forEach((s, k) => {
      const path = dom.spokes[k];
      const head = dom.heads[k];
      const o = w.w3 * (w.reachLen > 0.01 ? 1 : 0);
      setOpacity(path, o);
      setOpacity(head, o);
      if (o <= 0.01) return;
      toScreen(tmpB.set(s.at.x, s.top * 0.6, s.at.z));
      const hx = lerp(sp2.x, sp.x, w.reachLen);
      const hy = lerp(sp2.y, sp.y, w.reachLen);
      path.setAttribute("d", `M ${f1(sp2.x)} ${f1(sp2.y)} L ${f1(hx)} ${f1(hy)}`);
      head.setAttribute("cx", f1(hx));
      head.setAttribute("cy", f1(hy));
    });

    // The question's line into the hub.
    const askO = w.wQ * ramp(p, 2.75, 2.9);
    setOpacity(dom.ask, askO);
    if (askO > 0.01) {
      toScreen(tmpA.copy(question.mesh.position).add(tmpB.set(0, -0.25, 0)));
      toScreen(tmpC.set(HUB[0], HUB[1] + 0.48, HUB[2]), sp2);
      dom.ask.setAttribute("d", `M ${f1(sp.x)} ${f1(sp.y)} L ${f1(sp2.x)} ${f1(sp2.y)}`);
      dom.ask.style.strokeDashoffset = reducedMotion ? "0" : f1(-time * 24);
    }

    // The pulse round the ring.
    setOpacity(dom.orbit, w.w4);
    if (w.w4 > 0.01) {
      let d = "";
      for (let i = 0; i <= 14; i++) {
        const a = w.pulseA - 0.85 + (0.85 * i) / 14;
        toScreen(tmpA.set(Math.cos(a) * RING_R, 0.01, Math.sin(a) * RING_R));
        d += `${i ? "L" : "M"} ${f1(sp.x)} ${f1(sp.y)} `;
      }
      dom.orbit.setAttribute("d", d);
    }

    // Notes on the hub and the CRM.
    const wNotes = ramp(p, 2.55, 2.85) * (1 - ramp(p, 3.3, 3.6));
    toScreen(tmpA.set(0, 0, 0.55));
    note(dom.notes.hub, sp.x, sp.y + 6, wNotes);
    const crm = systems[0].at;
    toScreen(tmpA.set(crm.x, 0, crm.z + 0.42));
    note(dom.notes.crm, sp.x, sp.y + 4, wNotes);

    // Labels with leaders.
    const eb = blocks[EDIT];
    anchors.card.set(CARD[0] - 0.6, CARD[1] + CARD_H / 2, CARD[2]);
    anchors.canvas.set(0.9, -0.5 * w.sink, 1.55);
    anchors.agents.copy(agents[1].mesh.position);
    // On a narrow stage the label sits above the canvas, so point at the first tick.
    anchors.approve.set(TICK_X, -0.5 * w.sink, width < 520 ? ROWS[0] : (ROWS[1] + ROWS[2]) / 2);
    anchors.edit.copy(eb.pc.mesh.position).add(tmpA.set(-0.42, -eb.h / 2, 0.21));
    anchors.serial.copy(agents[1].mesh.position).add(tmpA.set(0, 0.2, 0));
    anchors.parallel.copy(agents[0].mesh.position).add(tmpA.set(0, 0.2, 0));
    anchors.question.copy(question.mesh.position).add(tmpA.set(0, 0.23, 0));
    const ca = 140 * DEG;
    anchors.contacts.set(Math.cos(ca) * CHIP_R, 0.02, Math.sin(ca) * CHIP_R);
    anchors.coins.set(COINS[0], 0, COINS[2] + 0.24);
    CALLOUTS.forEach((spec, i) => {
      const pl = placements[i];
      const pt = toScreen(anchors[spec.key]);
      pl.x = pt.x;
      pl.y = pt.y;
      pl.side = width < 520 && spec.narrow ? spec.narrow : spec.side;
      pl.opacity = pt.behind ? 0 : spec.weight(p);
    });
    placeCallouts(placements, box, { width, height }, width < 520 ? 12 : 20);
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
      barGeo.dispose();
      barFlatGeo.dispose();
      headGeo.dispose();
      lessonGeo.dispose();
      agentGeo.dispose();
      padGeo.dispose();
      msgGeo.dispose();
      chipGeo.dispose();
      coinGeo.dispose();
      disposeTree(front);
      disposeRenderer(renderer, scene);
    },
  };
}
