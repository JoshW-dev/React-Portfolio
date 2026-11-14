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
  ramp,
  readPalette,
  sizeRenderer,
  track,
  type ScreenPoint,
} from "@/components/breakdown/kit";
import type { BreakdownScene, SceneContext } from "@/components/breakdown/ScrollBreakdown";

/*
  The AI Education Assistant breakdown: the whole platform laid out as low-poly blocks on
  the page, and the camera following one piece of course material through it. Scroll
  position (0 to 4, one per step) drives it:

  0  close on a page of course material
  1  key terms light up and lift off the page; the Python NLP engine and Watson NLU light up
  2  the terms drop into Content Generation, and three quiz cards rise out of it
  3  on the students' screen a question appears, Conversation Generation and Watson
     Assistant light up, and a tutor reply types itself out
  4  the camera pulls back over the whole architecture, every part labelled

  The world is laid out like the old architecture diagram, read from the back: the page and
  the engines at the back, the three microservices on their Kubernetes platform in the
  middle with MongoDB beside them, then the React views, then Nginx in front.

  Blue marks what each step is about. Parts the step isn't about fade toward the page, and
  the links between parts only show when they carry something. With reduced motion the
  position is whole, so each step shows its end state.
*/

type Three = typeof THREE;

/** The three.js line addons, loaded by the caller next to three.js, for edges wider than 1px. */
export type LineModules = {
  LineSegments2: typeof import("three/examples/jsm/lines/LineSegments2.js").LineSegments2;
  LineSegmentsGeometry: typeof import("three/examples/jsm/lines/LineSegmentsGeometry.js").LineSegmentsGeometry;
  LineMaterial: typeof import("three/examples/jsm/lines/LineMaterial.js").LineMaterial;
};

export type NoteKey =
  | "page"
  | "ideas"
  | "nlp"
  | "nlu"
  | "content"
  | "quiz"
  | "response"
  | "conversation"
  | "assistant"
  | "watson"
  | "tileNlu"
  | "tileDiscovery"
  | "tileAssistant"
  | "students"
  | "educators"
  | "react"
  | "nginx"
  | "kube"
  | "mongo";

export type EducationDom = { notes: Record<NoteKey, HTMLElement> };

/* ---------- the layout (world units; y up, +z toward the viewer) ---------- */

const DEG = Math.PI / 180;
const FOV = 24;
const LAST = 4;
/** Height of the links, just over the platform's top. */
const LINK_Y = 0.095;

const PAGE = { x: -1.6, z: -4.35, w: 1.3, d: 1.6, t: 0.03 };
const NLP = { x: -1.6, z: -2.3, r: 0.55, h: 0.42 };
const WATSON = { x: 1.6, z: -2.3, w: 2.6, d: 0.95, h: 0.06, tile: 0.74, tileH: 0.3 };
const TILES = [0.75, 1.6, 2.45];
const PLATFORM = { w: 4.9, d: 1.5, h: 0.08 };
const MS = { xs: [-1.6, 0, 1.6], w: 1.3, h: 0.42, d: 0.8, z: 0.2 };
const MONGO = { x: 3.35, z: 0.05, r: 0.42, disc: 0.2, gap: 0.04 };
const REACT = { z: 2.15, w: 3.0, d: 0.95, h: 0.06 };
/** The educators' screen on the left, the students' on the right. */
const PANEL = { xs: [-0.72, 0.72], w: 1.2, h: 0.78, d: 0.06, tilt: -0.2, lift: 0.14 };
const NGINX = { z: 3.3, w: 3.0, h: 0.2, d: 0.16 };

/** Lines of text on the page, as bar widths per row. Starred bars (true) are the key terms. */
const ROWS: [number, boolean?][][] = [
  [[0.3], [0.42], [0.18]],
  [[0.5], [0.45]],
  [[0.22], [0.3, true], [0.4]],
  [[0.62], [0.3]],
  [[0.4], [0.2], [0.32, true]],
  [[0.55], [0.4]],
  [[0.28, true], [0.5], [0.14]],
  [[0.35], [0.6]],
  [[0.48], [0.32, true], [0.12]],
  [[0.4]],
];

type Shot = { yaw: number; pitch: number; fill: number };
const SHOTS: Shot[] = [
  { yaw: 24 * DEG, pitch: 62 * DEG, fill: 0.58 },
  { yaw: 14 * DEG, pitch: 38 * DEG, fill: 0.78 },
  { yaw: -6 * DEG, pitch: 40 * DEG, fill: 0.74 },
  { yaw: -20 * DEG, pitch: 30 * DEG, fill: 0.82 },
  { yaw: -8 * DEG, pitch: 54 * DEG, fill: 0.86 },
];
/** Quiz cards at full size, against their 0.8 by 0.52 model. */
const CARD_SCALE = 0.78;
/** How far parts the step isn't about fade toward the page. */
const DIM = 0.72;
/** The camera holds still across a little more of each step than the default. */
const HOLD = 0.22;

/* ---------- the story, from scroll position ---------- */

/** The terms turn blue on the page, then lift off it, one after another. */
const termsHot = (p: number) => ramp(p, 0.35, 0.6) * (1 - ramp(p, 1.85, 2.1));
const lift = (p: number, i: number) => ramp(p, 0.5 + i * 0.05, 0.85 + i * 0.05);
const toEngine = (p: number, i: number) => ramp(p, 1.05 + i * 0.04, 1.3 + i * 0.04);
const toContent = (p: number, i: number) => ramp(p, 1.45 + i * 0.04, 1.72 + i * 0.04);
/** The quiz cards rise out of Content Generation, then leave once the chat starts. */
const cardRise = (p: number, i: number) => ramp(p, 1.62 + i * 0.06, 1.88 + i * 0.06);
const cardsGone = (p: number) => ramp(p, 2.25, 2.5);
/** The chat: the student's question, then the tutor's reply, typed out a line at a time. */
const askAt = (p: number) => ramp(p, 2.38, 2.6);
const replyAt = (p: number) => ramp(p, 2.68, 2.85);
const typeAt = (p: number, k: number) => ramp(p, 2.78 + k * 0.05, 2.88 + k * 0.05);

/* ---------- the scene ---------- */

export function createEducationBreakdown(T: Three, ctx: SceneContext, dom: EducationDom, fat: LineModules): BreakdownScene {
  const { canvas, host, position, reducedMotion, invalidate } = ctx;
  const palette = readPalette(host);
  const renderer = createRenderer(T, canvas);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(FOV, 1, 0.1, 200);
  const lights = paperLights(T, scene);
  lights.hemi.intensity = 2.0;
  lights.key.intensity = 1.15;

  const ink = new T.Color(palette.ink);
  const accent = new T.Color(palette.agent);
  const white = new T.Color("#ffffff");
  const fills = palette.fills.map((h) => new T.Color(h));
  /** A pale wash of the blue for large faces, and a stronger one for small parts. */
  const wash = white.clone().lerp(accent, 0.18);
  const washStrong = white.clone().lerp(accent, 0.5);
  const TEXT = new T.Color("#cdd2d8");
  const TEXT_DARK = new T.Color("#adb3bb");

  // ---- Lines in CSS pixels ------------------------------------------------------------
  const lineMats: LineMaterial[] = [];
  const lineMat = (width: number, opacity = 0.9, dashed = false) => {
    const m = new fat.LineMaterial({
      color: ink.getHex(),
      linewidth: width,
      transparent: true,
      opacity,
      depthWrite: false,
      dashed,
      dashSize: 0.07,
      gapSize: 0.06,
    });
    m.toneMapped = false;
    lineMats.push(m);
    return m;
  };
  const edgeGeos = new Map<THREE.BufferGeometry, LineSegmentsGeometry>();
  const extraGeos: THREE.BufferGeometry[] = [];
  const outline = (mesh: THREE.Mesh, mat: LineMaterial, threshold = 30) => {
    let g = edgeGeos.get(mesh.geometry);
    if (!g) {
      const eg = new T.EdgesGeometry(mesh.geometry, threshold);
      g = new fat.LineSegmentsGeometry().fromEdgesGeometry(eg);
      eg.dispose();
      edgeGeos.set(mesh.geometry, g);
    }
    const l = new fat.LineSegments2(g, mat);
    l.raycast = () => {};
    mesh.add(l);
    return l;
  };

  // ---- Parts: what lights up, dims and turns blue together -------------------------------
  type Fill = { mat: THREE.MeshLambertMaterial | THREE.MeshBasicMaterial; base: THREE.Color; hot: THREE.Color };
  type Part = {
    fills: Fill[];
    line: LineMaterial;
    width: number;
    opacity: number;
    /** Steps where the part is in focus. Every part is in focus at the last step. */
    focus: readonly number[];
    hot: (p: number) => number;
  };
  const parts: Part[] = [];
  const part = (focus: number[], hot: (p: number) => number = () => 0, width = 1.25): Part => {
    const pt: Part = { fills: [], line: lineMat(width), width, opacity: 0.9, focus, hot };
    parts.push(pt);
    return pt;
  };
  const lambert = (color: THREE.Color) =>
    new T.MeshLambertMaterial({ color, flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  /** For flat things lying on a face (screen, bubbles, card print), drawn over it. */
  const flat = (color: THREE.Color, layer = 1) =>
    new T.MeshBasicMaterial({
      color,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -layer,
      polygonOffsetUnits: -layer,
    });
  /** A mesh whose colour belongs to a part. */
  const solid = (pt: Part, geo: THREE.BufferGeometry, color: THREE.Color, opts: { hot?: THREE.Color; layer?: number; edges?: number | false } = {}) => {
    const mat = opts.layer ? flat(color, opts.layer) : lambert(color);
    pt.fills.push({ mat, base: color.clone(), hot: opts.hot ?? wash });
    const m = new T.Mesh(geo, mat);
    if (opts.edges !== false) outline(m, pt.line, opts.edges ?? 30);
    return m;
  };
  const box = (w: number, h: number, d: number) => {
    const g = new T.BoxGeometry(w, h, d);
    extraGeos.push(g);
    return g;
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
  const plane = (w: number, h: number, r = 0) => {
    const g = r > 0 ? new T.ShapeGeometry(roundRect(w, h, r), 3) : new T.PlaneGeometry(w, h);
    extraGeos.push(g);
    return g;
  };

  const world = new T.Group();
  scene.add(world);

  // ---- The page of course material ------------------------------------------------------------
  const pagePart = part([0, 1], (p) => near(p, 0));
  // On step 0 only the page's outline turns blue, so its lines of text stay readable as text.
  const page = solid(pagePart, box(PAGE.w, PAGE.t, PAGE.d), fills[0], { hot: fills[0] });
  page.position.set(PAGE.x, PAGE.t / 2, PAGE.z);
  world.add(page);
  const termPart = part([0, 1, 2], termsHot, 1.1);
  type Term = { mesh: THREE.Mesh; rest: THREE.Vector3; hover: THREE.Vector3; engine: THREE.Vector3 };
  const terms: Term[] = [];
  const barY = PAGE.t + 0.006;
  {
    const title = solid(pagePart, box(0.56, 0.012, 0.09), TEXT_DARK, { hot: TEXT_DARK, edges: false });
    title.position.set(PAGE.x - 0.52 + 0.28, barY, PAGE.z - 0.66);
    world.add(title);
    ROWS.forEach((row, r) => {
      let x = -0.52;
      const z = PAGE.z - 0.5 + r * 0.128;
      for (const [w, isTerm] of row) {
        const at = new T.Vector3(PAGE.x + x + w / 2, barY, z);
        if (isTerm) {
          const k = terms.length;
          const mesh = solid(termPart, box(w, 0.012, 0.055), TEXT, { hot: washStrong });
          mesh.position.copy(at);
          world.add(mesh);
          terms.push({
            mesh,
            rest: at,
            hover: new T.Vector3(PAGE.x + (k - 1.5) * 0.42, 0.74 + (k % 2) * 0.12, PAGE.z + 0.15),
            engine: new T.Vector3(NLP.x + (k - 1.5) * 0.36, 0.95 + (k % 2) * 0.08, NLP.z),
          });
        } else {
          const bar = solid(pagePart, box(w, 0.012, 0.055), TEXT, { hot: TEXT, edges: false });
          bar.position.copy(at);
          world.add(bar);
        }
        x += w + 0.05;
      }
    });
  }

  // ---- The Python NLP engine and IBM Watson ------------------------------------------------------
  const nlpPart = part([1, 2], (p) => near(p, 1));
  const nlpGeo = new T.CylinderGeometry(NLP.r, NLP.r, NLP.h, 8);
  extraGeos.push(nlpGeo);
  const nlp = solid(nlpPart, nlpGeo, fills[1]);
  nlp.position.set(NLP.x, NLP.h / 2, NLP.z);
  nlp.rotation.y = Math.PI / 8;
  world.add(nlp);

  const watsonPart = part([1, 3]);
  const watsonBase = solid(watsonPart, box(WATSON.w, WATSON.h, WATSON.d), fills[0]);
  watsonBase.position.set(WATSON.x, WATSON.h / 2, WATSON.z);
  world.add(watsonBase);
  const tileHot = [(p: number) => near(p, 1), () => 0, (p: number) => near(p, 3)];
  const tileFocus = [[1], [], [3]];
  const tileGeo = box(WATSON.tile, WATSON.tileH, WATSON.tile);
  TILES.forEach((x, i) => {
    const pt = part(tileFocus[i], tileHot[i]);
    const tile = solid(pt, tileGeo, fills[1]);
    tile.position.set(x, WATSON.h + WATSON.tileH / 2, WATSON.z);
    world.add(tile);
  });

  // ---- Node.js microservices on the Kubernetes platform, and MongoDB ------------------------------
  const platformPart = part([2, 3]);
  const platform = solid(platformPart, box(PLATFORM.w, PLATFORM.h, PLATFORM.d), fills[0]);
  platform.position.set(0, PLATFORM.h / 2, 0);
  world.add(platform);
  const msHot = [(p: number) => near(p, 2), () => 0, (p: number) => near(p, 3)];
  const msFocus = [[2], [], [3]];
  const msGeo = box(MS.w, MS.h, MS.d);
  MS.xs.forEach((x, i) => {
    const pt = part(msFocus[i], msHot[i]);
    // Two more containers stacked behind each service, as in the old diagram.
    for (const k of [2, 1, 0]) {
      const block = solid(pt, msGeo, k ? fills[0] : fills[1]);
      block.position.set(x, PLATFORM.h + MS.h / 2, MS.z - k * 0.13);
      world.add(block);
    }
  });

  const mongoPart = part([]);
  const discGeo = new T.CylinderGeometry(MONGO.r, MONGO.r, MONGO.disc, 12);
  extraGeos.push(discGeo);
  for (let k = 0; k < 3; k++) {
    const disc = solid(mongoPart, discGeo, fills[1]);
    disc.position.set(MONGO.x, MONGO.disc / 2 + k * (MONGO.disc + MONGO.gap), MONGO.z);
    world.add(disc);
  }

  // ---- The React front end: a screen for educators and one for students ---------------------------
  const reactPart = part([3]);
  const reactBase = solid(reactPart, box(REACT.w, REACT.h, REACT.d), fills[0]);
  reactBase.position.set(0, REACT.h / 2, REACT.z);
  world.add(reactBase);

  const screenAt = (x: number, pt: Part) => {
    const g = new T.Group();
    g.position.set(x, REACT.h, REACT.z);
    world.add(g);
    const stand = solid(pt, box(0.12, PANEL.lift, 0.08), fills[1]);
    stand.position.y = PANEL.lift / 2;
    g.add(stand);
    const face = new T.Group();
    face.position.y = PANEL.lift + PANEL.h / 2;
    face.rotation.x = PANEL.tilt;
    g.add(face);
    const body = solid(pt, box(PANEL.w, PANEL.h, PANEL.d), fills[1]);
    face.add(body);
    const glass = solid(pt, plane(PANEL.w - 0.08, PANEL.h - 0.08, 0.03), white, { layer: 1, hot: white, edges: 1 });
    glass.position.z = PANEL.d / 2 + 0.002;
    face.add(glass);
    return face;
  };
  const eduPart = part([]);
  const eduFace = screenAt(PANEL.xs[0], eduPart);
  {
    // A course page in the educators' view: a heading, three modules, a few lines.
    const head = solid(eduPart, plane(0.46, 0.05), TEXT_DARK, { layer: 2, hot: TEXT_DARK, edges: false });
    head.position.set(-0.24, 0.24, PANEL.d / 2 + 0.005);
    eduFace.add(head);
    for (let k = 0; k < 3; k++) {
      const mod = solid(eduPart, plane(0.3, 0.2, 0.02), fills[1], { layer: 2, hot: fills[1], edges: false });
      mod.position.set(-0.34 + k * 0.34, 0.04, PANEL.d / 2 + 0.005);
      eduFace.add(mod);
    }
    [0.7, 0.52].forEach((w, k) => {
      const line = solid(eduPart, plane(w, 0.035), TEXT, { layer: 2, hot: TEXT, edges: false });
      line.position.set(-0.49 + w / 2, -0.15 - k * 0.08, PANEL.d / 2 + 0.005);
      eduFace.add(line);
    });
  }
  const studentPart = part([3]);
  const studentFace = screenAt(PANEL.xs[1], studentPart);

  // The chat on the students' screen.
  const askPart = part([3], () => 0, 1.1);
  const ask = new T.Group();
  ask.position.set(0.2, 0.18, PANEL.d / 2 + 0.006);
  studentFace.add(ask);
  ask.add(solid(askPart, plane(0.52, 0.15, 0.06), fills[2], { layer: 2, hot: fills[2], edges: 1 }));
  {
    const words = solid(askPart, plane(0.34, 0.03), TEXT_DARK, { layer: 3, hot: TEXT_DARK, edges: false });
    words.position.z = 0.002;
    ask.add(words);
  }
  const replyPart = part([3], (p) => near(p, 3), 1.1);
  const reply = new T.Group();
  reply.position.set(-0.14, -0.1, PANEL.d / 2 + 0.006);
  studentFace.add(reply);
  reply.add(solid(replyPart, plane(0.74, 0.27, 0.07), white, { layer: 2, hot: wash, edges: 1 }));
  const typed = [0.56, 0.5, 0.3].map((w, k) => {
    const g = new T.Group();
    g.position.set(-0.29, 0.07 - k * 0.07, 0.002);
    reply.add(g);
    const line = solid(replyPart, plane(w, 0.03), TEXT_DARK, { layer: 3, hot: washStrong, edges: false });
    line.position.x = w / 2;
    g.add(line);
    return g;
  });

  // ---- Nginx in front ---------------------------------------------------------------------------------
  const nginxPart = part([]);
  const nginx = solid(nginxPart, box(NGINX.w, NGINX.h, NGINX.d), fills[1]);
  nginx.position.set(0, NGINX.h / 2, NGINX.z);
  world.add(nginx);

  // ---- Quiz cards ---------------------------------------------------------------------------------------
  const cardPart = part([2], (p) => near(p, 2), 1.1);
  const cardGeo = box(0.8, 0.52, 0.025);
  const cardFrom = new T.Vector3(MS.xs[0], PLATFORM.h + MS.h * 0.7, MS.z);
  const cards = [0, 1, 2].map((i) => {
    const g = new T.Group();
    world.add(g);
    g.add(solid(cardPart, cardGeo, white, { hot: wash }));
    const front = 0.0135;
    const q = solid(cardPart, plane(0.6, 0.05), TEXT_DARK, { layer: 2, hot: TEXT_DARK, edges: false });
    q.position.set(-0.04, 0.15, front);
    g.add(q);
    const dotGeo = new T.CircleGeometry(0.027, 10);
    extraGeos.push(dotGeo);
    for (let k = 0; k < 3; k++) {
      const right = k === (i + 1) % 3;
      const dot = solid(cardPart, dotGeo, right ? accent : TEXT, { layer: 2, hot: right ? accent : TEXT, edges: false });
      dot.position.set(-0.27, 0.03 - k * 0.1, front);
      g.add(dot);
      const opt = solid(cardPart, plane(0.38, 0.03), TEXT, { layer: 2, hot: TEXT, edges: false });
      opt.position.set(-0.03, 0.03 - k * 0.1, front);
      g.add(opt);
    }
    return {
      g,
      to: new T.Vector3(MS.xs[0] + (i - 1) * 0.6, 1.2 + (i === 1 ? 0.1 : 0), MS.z + 0.25 + (i === 1 ? 0.08 : 0)),
      roll: (1 - i) * 0.1,
    };
  });

  // ---- Links between parts --------------------------------------------------------------------------------
  type Link = { mat: LineMaterial; show: number[]; hot: (p: number) => number };
  const links: Link[] = [];
  const link = (a: [number, number], b: [number, number], show: number[], hot: (p: number) => number = () => 0) => {
    const g = new fat.LineSegmentsGeometry().setPositions([a[0], LINK_Y, a[1], b[0], LINK_Y, b[1]]);
    extraGeos.push(g);
    const mat = lineMat(1.25, 0, true);
    const l = new fat.LineSegments2(g, mat);
    l.computeLineDistances();
    l.raycast = () => {};
    world.add(l);
    links.push({ mat, show, hot });
  };
  const msBack = MS.z - 2 * 0.13 - MS.d / 2 - 0.02;
  const msFront = MS.z + MS.d / 2 + 0.02;
  const reactBack = REACT.z - REACT.d / 2 - 0.01;
  link([PAGE.x, PAGE.z + PAGE.d / 2 + 0.02], [NLP.x, NLP.z - NLP.r - 0.02], [1, 4], (p) => near(p, 1));
  link([NLP.x, NLP.z + NLP.r + 0.02], [MS.xs[0], msBack], [2, 4], (p) => near(p, 2));
  link([MS.xs[2] + 0.15, msBack], [TILES[2], WATSON.z + WATSON.tile / 2 + 0.02], [3, 4], (p) => near(p, 3));
  MS.xs.forEach((x, i) =>
    link([x * 0.45, reactBack], [x, msFront], i === 2 ? [3, 4] : [4], i === 2 ? (p) => near(p, 3) : undefined),
  );
  link([0, NGINX.z - NGINX.d / 2 - 0.02], [0, REACT.z + REACT.d / 2 + 0.02], [4]);
  link([PLATFORM.w / 2 + 0.02, MONGO.z], [MONGO.x - MONGO.r - 0.02, MONGO.z], [4]);

  world.updateMatrixWorld(true);

  // ---- What each step keeps in frame -------------------------------------------------------------------
  const corners = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const out: THREE.Vector3[] = [];
    for (let k = 0; k < 8; k++) out.push(new T.Vector3(k & 1 ? x1 : x0, k & 2 ? y1 : y0, k & 4 ? z1 : z0));
    return out;
  };
  const pageBox = corners(PAGE.x - PAGE.w / 2, PAGE.x + PAGE.w / 2, 0, 0.05, PAGE.z - PAGE.d / 2, PAGE.z + PAGE.d / 2 + 0.25);
  const nlpBox = corners(NLP.x - NLP.r, NLP.x + NLP.r, 0, NLP.h, NLP.z - NLP.r, NLP.z + NLP.r);
  const tileBox = (i: number) =>
    corners(TILES[i] - WATSON.tile / 2, TILES[i] + WATSON.tile / 2, 0, 0.4, WATSON.z - WATSON.tile / 2, WATSON.z + WATSON.tile / 2);
  const msBox = (i: number) => corners(MS.xs[i] - MS.w / 2, MS.xs[i] + MS.w / 2, 0, PLATFORM.h + MS.h, msBack, msFront);
  const studentBox = corners(PANEL.xs[1] - PANEL.w / 2, PANEL.xs[1] + PANEL.w / 2, 0, 1.0, REACT.z - 0.2, REACT.z + REACT.d / 2 + 0.25);
  const FRAME_PTS: THREE.Vector3[][] = [
    pageBox,
    [...pageBox, ...nlpBox, ...tileBox(0), ...corners(PAGE.x - 0.75, PAGE.x + 0.75, 0.6, 1.0, PAGE.z, PAGE.z + 0.3)],
    [...nlpBox, ...msBox(0), ...corners(MS.xs[0] - 0.95, MS.xs[0] + 0.95, 0.8, 1.6, MS.z, MS.z + 0.4)],
    [...studentBox, ...msBox(2), ...tileBox(2)],
    [
      ...pageBox,
      ...corners(-PLATFORM.w / 2, MONGO.x + MONGO.r, 0, 0.7, NLP.z - NLP.r, NGINX.z + NGINX.d / 2 + 0.25),
      ...corners(-REACT.w / 2, REACT.w / 2, 0, 1.0, REACT.z - 0.3, REACT.z),
    ],
  ];

  // ---- Camera ------------------------------------------------------------------------------------------
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

  type Framing = { target: THREE.Vector3; dist: number };
  let framings: Framing[] = [];
  function fit() {
    const aspect = width / height;
    framings = SHOTS.map((shot, step) => {
      const pts = FRAME_PTS[step];
      const target = new T.Vector3();
      for (const q of pts) target.add(q);
      target.divideScalar(pts.length);
      let dist = 14;
      for (let k = 0; k < 6; k++) {
        placeCamera(target, dist, shot.yaw, shot.pitch);
        right.setFromMatrixColumn(camera.matrixWorld, 0);
        up.setFromMatrixColumn(camera.matrixWorld, 1);
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const q of pts) {
          v.copy(q).project(camera);
          x0 = Math.min(x0, v.x);
          x1 = Math.max(x1, v.x);
          y0 = Math.min(y0, v.y);
          y1 = Math.max(y1, v.y);
        }
        // Recentre, then scale the distance so the box fills its share of the stage.
        const halfH = dist * tan;
        target.addScaledVector(right, ((x0 + x1) / 2) * halfH * aspect);
        target.addScaledVector(up, ((y0 + y1) / 2) * halfH);
        dist *= Math.max((y1 - y0) / 2 / shot.fill, (x1 - x0) / 2 / 0.88);
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

  // ---- Drag to turn, with a little inertia -----------------------------------------------------------------
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
    const dx = (e.clientX - dragging.x) * -0.006;
    const dt = Math.max((e.timeStamp - dragging.t) / 1000, 1 / 240);
    yawOff = Math.max(-1.1, Math.min(1.1, yawOff + dx));
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

  // ---- Layout -------------------------------------------------------------------------------------------
  const noteSizes = new Map<HTMLElement, { w: number; h: number }>();
  function resize() {
    const size = sizeRenderer(renderer, camera);
    if (!size) return;
    width = size.width;
    height = size.height;
    for (const m of lineMats) m.resolution.set(width, height);
    noteSizes.clear();
    fit();
  }

  // ---- State from scroll position -------------------------------------------------------------------------
  const weight = (p: number, steps: readonly number[]) => {
    let w = 0;
    for (const s of steps) w = Math.max(w, near(p, s));
    return w;
  };
  const termAt = new T.Vector3();
  function apply(p: number, time: number) {
    const idle = reducedMotion ? 0 : 1;

    // The terms: lift off the page, over to the NLP engine, then down into Content Generation.
    let lifted = 0;
    terms.forEach((t, i) => {
      const a = lift(p, i);
      const b = toEngine(p, i);
      const c = toContent(p, i);
      lifted = Math.max(lifted, a * (1 - c));
      termAt.lerpVectors(t.rest, t.hover, a);
      termAt.lerp(t.engine, b);
      termAt.y += Math.sin(Math.PI * b) * 0.25;
      termAt.lerp(cardFrom, c);
      termAt.y += Math.sin(Math.PI * c) * 0.15;
      const air = a * (1 - c);
      termAt.y += air * idle * 0.03 * Math.sin(time * 1.4 + i * 1.7);
      t.mesh.position.copy(termAt);
      const s = 1 - ramp(c, 0.65, 1);
      t.mesh.scale.set(lerp(1, 1.6, a) * s, lerp(1, 3, a) * s, lerp(1, 2.2, a) * s);
      t.mesh.visible = s > 0.01;
    });
    termPart.opacity = 0.9 * ramp(lifted, 0, 0.3);

    // The quiz cards.
    const gone = cardsGone(p);
    cards.forEach((c, i) => {
      const r = cardRise(p, i);
      const s = r * (1 - gone);
      c.g.visible = s > 0.01;
      c.g.position.lerpVectors(cardFrom, c.to, r);
      c.g.position.y += s * idle * 0.025 * Math.sin(time * 1.1 + i * 2.1);
      c.g.rotation.set(-0.35 * r, 0, c.roll * r);
      c.g.scale.setScalar(Math.max(s * CARD_SCALE, 0.001));
    });

    // The chat.
    const q = askAt(p);
    ask.visible = q > 0.01;
    ask.scale.setScalar(Math.max(q, 0.001));
    const r = replyAt(p);
    reply.visible = r > 0.01;
    reply.scale.setScalar(Math.max(r, 0.001));
    typed.forEach((g, k) => {
      const t = typeAt(p, k);
      g.visible = t > 0.01;
      g.scale.x = Math.max(t, 0.001);
    });

    // Focus, dimming and blue.
    for (const pt of parts) {
      const f = Math.max(near(p, LAST), weight(p, pt.focus));
      const d = 1 - f;
      const h = pt.hot(p);
      for (const fl of pt.fills) fl.mat.color.copy(fl.base).lerp(white, DIM * d).lerp(fl.hot, h);
      pt.line.color.copy(ink).lerp(accent, h);
      pt.line.opacity = pt.opacity * (1 - 0.8 * d);
      pt.line.linewidth = pt.width + 0.5 * h;
    }
    for (const l of links) {
      const h = l.hot(p);
      l.mat.opacity = 0.85 * weight(p, l.show);
      l.mat.color.copy(ink).lerp(accent, h);
      l.mat.linewidth = 1.25 + 0.5 * h;
      l.mat.dashOffset = reducedMotion ? 0 : -time * 0.25;
    }
  }

  // ---- Notes ----------------------------------------------------------------------------------------------
  const project = createProjector(T);
  const sp: ScreenPoint = { x: 0, y: 0, behind: false };
  const ideasAt = new T.Vector3();
  const quizAt = new T.Vector3();
  type NoteSpec = {
    key: NoteKey;
    at: THREE.Vector3;
    steps: number[];
    /** Further steps where it shows only on a wide stage, where it won't crowd its neighbours. */
    wideSteps?: number[];
    /** Pixels below the anchor (positive) or above it (negative), from the label's middle. */
    dy?: number;
  };
  const top = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  const NOTES: NoteSpec[] = [
    { key: "page", at: top(PAGE.x, 0, PAGE.z + PAGE.d / 2 + 0.12), steps: [0, 1], wideSteps: [4], dy: 12 },
    { key: "ideas", at: ideasAt, steps: [1], dy: -16 },
    { key: "nlp", at: top(NLP.x, NLP.h, NLP.z), steps: [1, 4] },
    { key: "nlu", at: top(TILES[0], WATSON.h + WATSON.tileH, WATSON.z), steps: [1] },
    { key: "content", at: top(MS.xs[0], PLATFORM.h + MS.h, MS.z), steps: [2, 4] },
    { key: "quiz", at: quizAt, steps: [2], dy: -14 },
    { key: "response", at: top(MS.xs[1], PLATFORM.h + MS.h, MS.z), steps: [4] },
    { key: "conversation", at: top(MS.xs[2], PLATFORM.h + MS.h, MS.z), steps: [3, 4] },
    { key: "assistant", at: top(TILES[2], WATSON.h + WATSON.tileH, WATSON.z), steps: [3] },
    { key: "watson", at: top(WATSON.x, 0, WATSON.z + WATSON.d / 2), steps: [4], dy: 13 },
    { key: "tileNlu", at: top(TILES[0], WATSON.h + WATSON.tileH, WATSON.z), steps: [], wideSteps: [4] },
    { key: "tileDiscovery", at: top(TILES[1], WATSON.h + WATSON.tileH, WATSON.z), steps: [], wideSteps: [4] },
    { key: "tileAssistant", at: top(TILES[2], WATSON.h + WATSON.tileH, WATSON.z), steps: [], wideSteps: [4] },
    { key: "students", at: top(PANEL.xs[1], REACT.h, REACT.z + 0.3), steps: [3, 4], dy: 8 },
    { key: "educators", at: top(PANEL.xs[0], REACT.h, REACT.z + 0.3), steps: [4], dy: 8 },
    { key: "react", at: top(-REACT.w / 2, 0, REACT.z), steps: [4] },
    { key: "nginx", at: top(0, 0, NGINX.z + NGINX.d / 2), steps: [4], dy: 13 },
    { key: "kube", at: top(MS.xs[0], 0, PLATFORM.d / 2), steps: [4], dy: 13 },
    { key: "mongo", at: top(MONGO.x, 0, MONGO.z + MONGO.r), steps: [4], dy: 13 },
  ];
  /** Labels that sit to the left of their anchor rather than centred on it. */
  const LEFT_OF = new Set<NoteKey>(["react"]);
  const f1 = (n: number) => n.toFixed(1);

  function overlays(p: number) {
    const narrow = width < 560;
    // The ideas label rides above the lifted terms; the quiz label above the cards.
    ideasAt.set(0, 0, 0);
    for (const t of terms) ideasAt.add(t.mesh.position);
    ideasAt.divideScalar(terms.length);
    ideasAt.y += 0.12;
    quizAt.copy(cards[1].g.position);
    quizAt.y += 0.3;

    for (const n of NOTES) {
      const el = dom.notes[n.key];
      let o = weight(p, n.steps);
      if (n.wideSteps && !narrow) o = Math.max(o, weight(p, n.wideSteps));
      // The labels that ride on moving things show only while those things are out.
      if (n.key === "ideas") o *= lift(p, 0) * (1 - toContent(p, 0));
      if (n.key === "quiz") o *= cardRise(p, 1) * (1 - cardsGone(p));
      if (o <= 0.01) {
        el.style.opacity = "0";
        continue;
      }
      project(n.at, camera, width, height, sp);
      if (sp.behind) {
        el.style.opacity = "0";
        continue;
      }
      let s = noteSizes.get(el);
      if (!s || !s.w) {
        s = { w: el.offsetWidth, h: el.offsetHeight };
        noteSizes.set(el, s);
      }
      let left = LEFT_OF.has(n.key) ? sp.x - s.w - 10 : sp.x - s.w / 2;
      let topPx = sp.y + (n.dy ?? 0) - s.h / 2;
      left = Math.min(Math.max(left, 4), width - s.w - 4);
      topPx = Math.min(Math.max(topPx, 4), height - s.h - 4);
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translate3d(${f1(left)}px, ${f1(topPx)}px, 0)`;
    }
  }

  // ---- Frame ------------------------------------------------------------------------------------------------
  let time = 0;
  let lastP = -1;
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
      yawOff = Math.max(-1.1, Math.min(1.1, yawOff + vel * dt));
      vel *= Math.exp(-dt * 3.2);
    }
    apply(p, time);
    const sway = reducedMotion ? 0 : 0.03 * Math.sin(time * 0.23);
    aim(p, dt, sway);
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
    overlays(p);
  }

  resize();
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
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
      for (const g of edgeGeos.values()) g.dispose();
      for (const g of extraGeos) g.dispose();
      for (const m of lineMats) m.dispose();
      disposeRenderer(renderer, scene);
    },
  };
}
