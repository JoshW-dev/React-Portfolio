import type * as THREE from "three";
import {
  isWideStage,
  createProjector,
  createRenderer,
  disposeRenderer,
  lerp,
  near,
  ramp,
  readPalette,
  sizeRenderer,
  track,
  type ScreenPoint,
} from "@/components/breakdown/kit";
import type { BreakdownScene, SceneContext } from "@/components/breakdown/ScrollBreakdown";
import { buildPlant, type StreamName } from "./plant";

/*
  The hydrogen plant breakdown. Scroll position (0 to 4, one per step) drives everything:

  0  what it's for: gas comes in on the left, hydrogen leaves on the right (blue)
  1  how it's made: the reformer and shift vessels turn blue, CO2 puffs out of the stack
  2  capture: the stack drops to a trickle, the ground opens and CO2 runs down to storage
  3  the sessions: seen from above, the plot pulls in and a capital bar loses its top
  4  the result: the tighter plant running, hydrogen out and CO2 down, the lower bar

  Gas moves as beads along the pipes. Blue marks what each step is about. Labels are HTML
  over the canvas, placed from projected 3D points every frame.
*/

type Three = typeof THREE;

export type CalloutKey = "gas" | "h2" | "reformer" | "capture" | "co2" | "budget";
export type NoteKey = "formula" | "air" | "stored" | "cut";

export type Pin = { el: HTMLElement; line: SVGLineElement; dot: SVGCircleElement };

export type HydrogenDom = {
  callouts: Record<CalloutKey, Pin>;
  notes: Record<NoteKey, HTMLElement>;
};

/** min x, y, z, max x, y, z in world units. */
type Box6 = [number, number, number, number, number, number];
/** Where the focus box sits on the stage, as fractions: left, top, right, bottom. */
type Frame = [number, number, number, number];
type View = { az: number; el: number; box: Box6; frame: Frame };

// Frames wider than the stage let the tile's far corners run off the edge, where the mask
// fades them, so the plant itself fills the stage.
const PLANT_ALL: Box6 = [-8.6, -0.5, -5.5, 8.6, 5.8, 5.5];
const WITH_BAR: Box6 = [-8.6, -0.5, -5.5, 12.0, 5.8, 5.5];
const VIEWS_TALL: View[] = [
  { az: -30, el: 36, box: PLANT_ALL, frame: [-0.1, 0.2, 1.1, 0.8] },
  { az: -38, el: 21, box: [-6.4, -0.5, -4.6, 1.2, 8.2, 3.6], frame: [0.04, 0.1, 0.96, 0.86] },
  { az: 30, el: 15, box: [-1.2, -4.45, -4.2, 9.4, 5.6, 5.5], frame: [0.06, 0.1, 0.94, 0.9] },
  { az: -10, el: 46, box: WITH_BAR, frame: [-0.02, 0.2, 1.02, 0.8] },
  { az: -26, el: 27, box: WITH_BAR, frame: [-0.04, 0.2, 1.04, 0.82] },
];
// Phones: a squarer stage, so pull in tighter and leave less room round the edges.
const VIEWS_WIDE: View[] = [
  { az: -30, el: 31, box: PLANT_ALL, frame: [-0.08, 0.2, 1.08, 0.84] },
  { az: -38, el: 21, box: [-6.4, -0.5, -4.6, 1.2, 8.2, 3.6], frame: [0.02, 0.08, 0.98, 0.92] },
  { az: 30, el: 15, box: [-1.2, -4.45, -4.2, 9.4, 5.6, 5.5], frame: [0.04, 0.06, 0.96, 0.94] },
  { az: -10, el: 46, box: WITH_BAR, frame: [-0.04, 0.18, 1.04, 0.84] },
  { az: -26, el: 27, box: WITH_BAR, frame: [-0.06, 0.18, 1.06, 0.86] },
];

type Dir = [number, number];
type CalloutSpec = {
  key: CalloutKey;
  weight: (p: number) => number;
  /** Direction from the anchor to the label on screen, and the leader length in px. */
  tall: Dir;
  wide: Dir;
  /** A different direction for the last step, where more labels share the stage. */
  last?: Dir;
  len: number;
};
const CALLOUTS: CalloutSpec[] = [
  { key: "gas", weight: (p) => near(p, 0), tall: [-0.5, 1], wide: [-0.2, 1], len: 46 },
  { key: "h2", weight: (p) => Math.max(near(p, 0), near(p, 4)), tall: [0.3, -1], wide: [0.1, -1], len: 84 },
  { key: "reformer", weight: (p) => near(p, 1), tall: [-0.5, -1], wide: [-0.4, -1], len: 64 },
  { key: "capture", weight: (p) => near(p, 2), tall: [-1, -0.25], wide: [-1, -0.25], len: 56 },
  { key: "co2", weight: (p) => Math.max(near(p, 2), near(p, 4)), tall: [1, -0.6], wide: [1, -0.6], last: [-0.55, 1], len: 52 },
  { key: "budget", weight: (p) => Math.max(near(p, 3), near(p, 4)), tall: [0, 1], wide: [0, 1], len: 30 },
];

type Bead = { name: StreamName; speed: number; mesh: THREE.InstancedMesh; mat: THREE.MeshBasicMaterial; n: number };

export function createHydrogenScene(T: Three, ctx: SceneContext, dom: HydrogenDom): BreakdownScene {
  const { canvas, host, position, reducedMotion, invalidate } = ctx;
  const palette = readPalette(host);
  const renderer = createRenderer(T, canvas);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(24, 1, 0.5, 600);

  // Soft daylight with three clear tones: lit tops, front faces and the shaded side.
  // (three.js divides diffuse light by pi, hence the large-looking intensities.)
  const hemi = new T.HemisphereLight(0xffffff, 0xc9ced6, 2.5);
  const key = new T.DirectionalLight(0xffffff, 1.05);
  key.position.set(-4, 8, 6);
  scene.add(hemi, key);

  const plant = buildPlant(T, palette);
  scene.add(plant.root);

  const ink = new T.Color(palette.ink);
  const agent = new T.Color(palette.agent);

  // ---- Beads: gas moving along the pipes ------------------------------------------------
  const beadGeo = new T.IcosahedronGeometry(1, 0);
  const SPACING = 0.72;
  plant.layout(0, 1);
  const beads: Bead[] = (
    [
      ["feed", 1.3],
      ["syngas", 1.3],
      ["h2", 1.6],
      ["co2", 1.15],
    ] as [StreamName, number][]
  ).map(([name, speed]) => {
    const n = Math.max(4, Math.round(plant.length(name) / SPACING));
    const mat = new T.MeshBasicMaterial({ color: ink, toneMapped: false });
    const mesh = new T.InstancedMesh(beadGeo, mat, n);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { name, speed, mesh, mat, n };
  });
  plant.layout(0, 0);

  // ---- Puffs from the stack: what the CO2 does with no capture ---------------------------
  const PUFFS = 10;
  const puffGeo = new T.IcosahedronGeometry(1, 0);
  const puffEdges = new T.EdgesGeometry(puffGeo);
  const puffs = Array.from({ length: PUFFS }, () => {
    const mat = new T.MeshLambertMaterial({ color: palette.fills[0], flatShading: true, transparent: true, opacity: 0, depthWrite: false });
    const line = new T.LineBasicMaterial({ color: palette.ink, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const m = new T.Mesh(puffGeo, mat);
    m.add(new T.LineSegments(puffEdges, line));
    m.renderOrder = 3;
    scene.add(m);
    return { m, mat, line };
  });

  // ---- Drag to turn, with a little inertia -------------------------------------------------
  let dragAz = 0;
  let velAz = 0;
  let dragging: { id: number; x: number; t: number } | null = null;
  const SENS = 0.006;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = { id: e.pointerId, x: e.clientX, t: e.timeStamp };
    velAz = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.dataset.dragging = "";
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const d = -(e.clientX - dragging.x) * SENS;
    const dt = Math.max((e.timeStamp - dragging.t) / 1000, 1 / 240);
    dragAz = Math.max(-1.4, Math.min(1.4, dragAz + d));
    velAz = velAz * 0.5 + (d / dt) * 0.5;
    dragging.x = e.clientX;
    dragging.t = e.timeStamp;
    invalidate();
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    if ((e.timeStamp - dragging.t) / 1000 > 0.1 || reducedMotion) velAz = 0;
    velAz = Math.max(-3, Math.min(3, velAz));
    dragging = null;
    delete canvas.dataset.dragging;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  // ---- Layout ------------------------------------------------------------------------------
  let width = 1;
  let height = 1;
  let wide = false;
  const sizes = new Map<HTMLElement, { w: number; h: number }>();
  function resize() {
    const size = sizeRenderer(renderer, camera);
    if (!size) return;
    width = size.width;
    height = size.height;
    wide = isWideStage(width, height);
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

  // ---- Camera: an orbit angle per step, fitted to a focus box ------------------------------
  const cur = { az: 0, el: 0, box: [0, 0, 0, 0, 0, 0] as number[], frame: [0, 0, 0, 0] as number[], set: false };
  const goal = { az: 0, el: 0, box: [0, 0, 0, 0, 0, 0] as number[], frame: [0, 0, 0, 0] as number[] };
  const qCam = new T.Quaternion();
  const qInv = new T.Quaternion();
  const eul = new T.Euler(0, 0, 0, "YXZ");
  const c3 = new T.Vector3();
  const DEG = Math.PI / 180;

  function viewAt(p: number) {
    const views = wide ? VIEWS_WIDE : VIEWS_TALL;
    goal.az = track(views.map((v) => v.az), p);
    goal.el = track(views.map((v) => v.el), p);
    for (let k = 0; k < 6; k++) goal.box[k] = track(views.map((v) => v.box[k]), p);
    for (let k = 0; k < 4; k++) goal.frame[k] = track(views.map((v) => v.frame[k]), p);
  }

  function placeCamera(az: number, el: number) {
    eul.set(-el * DEG, az, 0, "YXZ");
    qCam.setFromEuler(eul);
    qInv.copy(qCam).invert();
    const b = cur.box;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    const pts: [number, number, number][] = [];
    for (let k = 0; k < 8; k++) {
      c3.set(k & 1 ? b[3] : b[0], k & 2 ? b[4] : b[1], k & 4 ? b[5] : b[2]).applyQuaternion(qInv);
      pts.push([c3.x, c3.y, c3.z]);
      x0 = Math.min(x0, c3.x);
      x1 = Math.max(x1, c3.x);
      y0 = Math.min(y0, c3.y);
      y1 = Math.max(y1, c3.y);
      z0 = Math.min(z0, c3.z);
      z1 = Math.max(z1, c3.z);
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const cz = (z0 + z1) / 2;
    const f = cur.frame;
    const tan = Math.tan((camera.fov * DEG) / 2);
    const tanH = (tan * (f[2] - f[0]) * width) / height;
    const tanV = tan * (f[3] - f[1]);
    let d = 1;
    for (const [x, y, z] of pts) d = Math.max(d, z - cz + Math.abs(x - cx) / tanH, z - cz + Math.abs(y - cy) / tanV);
    camera.position.set(cx, cy, cz + d).applyQuaternion(qCam);
    camera.quaternion.copy(qCam);
    const rx = ((f[0] + f[2]) / 2) * width;
    const ry = ((f[1] + f[3]) / 2) * height;
    camera.setViewOffset(width, height, width / 2 - rx, height / 2 - ry, width, height);
    camera.updateMatrixWorld(true);
  }

  // ---- Story state from scroll position ----------------------------------------------------
  const wellOpen = (p: number) => track([0, 0, 1, 0, 0], p);
  function apply(p: number) {
    const compact = track([0, 0, 0, 1, 1], p);
    plant.layout(compact, wellOpen(p));

    const h2Blue = Math.max(near(p, 0), near(p, 4));
    const co2Blue = Math.max(near(p, 2), near(p, 4));
    plant.tint("h2", h2Blue);
    plant.tint("reaction", near(p, 1));
    plant.tint("syngas", near(p, 1));
    plant.tint("capture", near(p, 2));
    plant.tint("co2", co2Blue);
    plant.tint("storage", near(p, 2));

    // The plot line pulls in during the sessions step, leaving the old one as a ghost.
    const w3 = near(p, 3, 0.35, 0.65);
    (plant.plot.material as THREE.LineDashedMaterial).opacity = w3;
    (plant.plotGhost.material as THREE.LineDashedMaterial).opacity = w3 * 0.45;
    plant.plot.visible = w3 > 0.01;
    plant.plotGhost.visible = w3 > 0.01;

    // The capital bar comes up out of its tile, then loses its top.
    const rise = ramp(p, 2.15, 2.5);
    const drop = ramp(p, 2.5, 2.82);
    const bar = plant.bar;
    bar.root.visible = rise > 0.01;
    bar.root.scale.set(lerp(0.6, 1, rise), Math.max(rise, 0.001), lerp(0.6, 1, rise));
    const cutMat = bar.cut.material as THREE.MeshLambertMaterial;
    cutMat.opacity = 1 - drop;
    cutMat.depthWrite = drop < 0.5;
    bar.cutLine.opacity = 0.9 * (1 - drop);
    bar.cut.position.y = drop * 0.5;
    bar.cut.visible = drop < 0.99;
    (bar.ghost.material as THREE.LineDashedMaterial).opacity = drop;

    for (const b of beads) {
      const blue = b.name === "h2" ? h2Blue : b.name === "co2" ? co2Blue : b.name === "syngas" ? near(p, 1) : 0;
      b.mat.color.copy(ink).lerp(agent, blue);
    }
  }

  // ---- Moving parts --------------------------------------------------------------------------
  const m4 = new T.Matrix4();
  const qI = new T.Quaternion();
  const vPos = new T.Vector3();
  const vScale = new T.Vector3();
  const BEAD_R = 0.15;
  function moveBeads(p: number, time: number) {
    const co2On = ramp(p, 1.35, 1.75);
    for (const b of beads) {
      const L = plant.length(b.name);
      const on = b.name === "co2" ? co2On : 1;
      for (let i = 0; i < b.n; i++) {
        const s = (((time * b.speed + (i * L) / b.n) % L) + L) % L;
        plant.sample(b.name, s, vPos);
        const fade = Math.min(1, s / 0.5, (L - s) / 0.5);
        const r = BEAD_R * on * Math.max(0, fade);
        vScale.setScalar(Math.max(r, 1e-4));
        m4.compose(vPos, qI, vScale);
        b.mesh.setMatrixAt(i, m4);
      }
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  const stackTop = new T.Vector3();
  function movePuffs(p: number, time: number) {
    plant.anchors.stack.getWorldPosition(stackTop);
    const base = ramp(p, 0.4, 0.8);
    const captured = ramp(p, 1.3, 1.75);
    // With capture on, the plume shrinks to a wisp: the plant catches over 90%, not all of it.
    const size = 1 - 0.62 * captured;
    const rise = 1 - 0.55 * captured;
    puffs.forEach((puff, i) => {
      const ph = (time / 7 + (i + 0.5) / PUFFS) % 1;
      const o = base * (1 - 0.45 * captured) * Math.pow(1 - ph, 1.2) * ramp(ph, 0, 0.08);
      puff.m.visible = o > 0.01;
      if (!puff.m.visible) return;
      puff.m.position.set(
        stackTop.x + (0.7 * ph + 0.12 * Math.sin(ph * 9 + i)) * rise,
        stackTop.y + 0.2 + 2.9 * ph * rise,
        stackTop.z + 0.3 * ph * rise,
      );
      puff.m.scale.setScalar((0.2 + 0.55 * ph) * size);
      puff.m.rotation.set(ph * 2 + i, ph * 3, 0);
      puff.mat.opacity = o * 0.9;
      puff.line.opacity = o * 0.75;
    });
  }

  // ---- Overlays ------------------------------------------------------------------------------
  const project = createProjector(T);
  const sp: ScreenPoint = { x: 0, y: 0, behind: false };
  const v = new T.Vector3();
  const f1 = (n: number) => n.toFixed(1);
  const setOpacity = (el: HTMLElement | SVGElement, o: number) => {
    el.style.opacity = o > 0.01 ? o.toFixed(3) : "0";
  };
  type R = { l: number; t: number; r: number; b: number };
  const placed: R[] = [];
  const clash = (a: R) => placed.some((q) => a.l < q.r + 4 && a.r > q.l - 4 && a.t < q.b + 3 && a.b > q.t - 3);

  /** A label with a thin leader from a 3D point, pushed along dir until it is clear. */
  function pin(c: Pin, at: THREE.Vector3, dir: Dir, len: number, o: number) {
    setOpacity(c.el, o);
    setOpacity(c.line, o);
    setOpacity(c.dot, o);
    if (o <= 0.01) return;
    project(at, camera, width, height, sp);
    const { w, h } = measure(c.el);
    const scale = Math.min(1, Math.max(0.6, width / 640));
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    const ux = dir[0] / dl;
    const uy = dir[1] / dl;
    let L = len * scale;
    let box: R = { l: 0, t: 0, r: 0, b: 0 };
    for (let tries = 0; tries < 8; tries++) {
      const ex = sp.x + ux * L;
      const ey = sp.y + uy * L;
      // The leader meets the label on the edge facing the anchor.
      let left: number;
      let top: number;
      if (Math.abs(uy) >= Math.abs(ux)) {
        left = ex - w / 2 + ux * w * 0.35;
        top = uy < 0 ? ey - h : ey;
      } else {
        left = ux < 0 ? ex - w : ex;
        top = ey - h / 2;
      }
      left = Math.min(Math.max(left, 4), width - w - 4);
      top = Math.min(Math.max(top, 4), height - h - 4);
      box = { l: left, t: top, r: left + w, b: top + h };
      if (!clash(box)) break;
      L += h + 6;
    }
    placed.push(box);
    c.el.style.transform = `translate3d(${f1(box.l)}px, ${f1(box.t)}px, 0)`;
    const lx = Math.min(Math.max(sp.x, box.l), box.r);
    const ly = Math.min(Math.max(sp.y, box.t), box.b);
    c.line.setAttribute("x1", f1(sp.x));
    c.line.setAttribute("y1", f1(sp.y));
    c.line.setAttribute("x2", f1(lx));
    c.line.setAttribute("y2", f1(ly));
    c.dot.setAttribute("cx", f1(sp.x));
    c.dot.setAttribute("cy", f1(sp.y));
  }

  /** A plain note at a 3D point, offset in px, with its left, centre or right on that spot. */
  function note(el: HTMLElement, at: THREE.Vector3, dx: number, dy: number, o: number, align: "left" | "center" | "right" = "left") {
    setOpacity(el, o);
    if (o <= 0.01) return;
    project(at, camera, width, height, sp);
    const { w, h } = measure(el);
    const x = sp.x + dx;
    const y = sp.y + dy;
    let left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
    let top = y - h / 2;
    left = Math.min(Math.max(left, 4), width - w - 4);
    top = Math.min(Math.max(top, 4), height - h - 4);
    placed.push({ l: left, t: top, r: left + w, b: top + h });
    el.style.transform = `translate3d(${f1(left)}px, ${f1(top)}px, 0)`;
  }

  const anchorFor: Record<CalloutKey, (out: THREE.Vector3) => THREE.Vector3> = {
    gas: (out) => plant.sample("feed", 2.6, out),
    h2: (out) => plant.sample("h2", plant.length("h2") - 2.6, out),
    reformer: (out) => plant.anchors.reformer.getWorldPosition(out),
    capture: (out) => plant.anchors.absorber.getWorldPosition(out),
    co2: (out) => plant.anchors.wellhead.getWorldPosition(out),
    budget: (out) => plant.anchors.barMid.getWorldPosition(out),
  };

  function overlays(p: number) {
    placed.length = 0;
    const s = Math.min(1, Math.max(0.6, width / 640));

    // Notes first, so the labels step round them.
    // The formula sits in the clear sky left of the stack, the plume note to its right.
    const w1 = near(p, 1);
    plant.anchors.stack.getWorldPosition(v);
    v.y -= 1.2;
    note(dom.notes.formula, v, -22 * s, 0, w1, "right");
    plant.anchors.stack.getWorldPosition(v);
    v.y += 2.0;
    v.x += 1.7;
    note(dom.notes.air, v, 8 * s, 0, w1, "left");

    const w2 = near(p, 2) * ramp(wellOpen(p), 0.6, 0.95);
    plant.anchors.storage.getWorldPosition(v);
    note(dom.notes.stored, v, 0, 38 * s, w2, "center");

    // Above the dashed outline of the part of the bar that came off.
    const wCut = Math.max(near(p, 3), near(p, 4)) * ramp(p, 2.6, 2.85);
    plant.anchors.barCut.getWorldPosition(v);
    note(dom.notes.cut, v, 0, -14 * s, wCut, "center");

    for (const spec of CALLOUTS) {
      anchorFor[spec.key](v);
      let o = spec.weight(p);
      if (spec.key === "budget") o *= ramp(p, 2.4, 2.6);
      const dir = spec.last && p > 3.5 ? spec.last : wide ? spec.wide : spec.tall;
      pin(dom.callouts[spec.key], v, dir, spec.len, o);
    }
  }

  // ---- Frame ------------------------------------------------------------------------------
  let time = 0;
  let lastP = -1;
  function frame(dt: number) {
    time += dt;
    const p = Math.min(4, Math.max(0, position.current ?? 0));

    // Scrolling eases a drag back to the story's view.
    if (lastP >= 0 && !dragging) {
      const dp = Math.abs(p - lastP);
      if (dp > 0) dragAz *= Math.max(0, 1 - dp * 2.5);
    }
    lastP = p;
    if (!dragging && Math.abs(velAz) > 1e-3) {
      dragAz = Math.max(-1.4, Math.min(1.4, dragAz + velAz * dt));
      velAz *= Math.exp(-dt * 3.2);
    }

    apply(p);
    viewAt(p);
    const e = !cur.set || reducedMotion || dt === 0 ? 1 : 1 - Math.exp(-dt * 6);
    cur.az = lerp(cur.az, goal.az, e);
    cur.el = lerp(cur.el, goal.el, e);
    for (let k = 0; k < 6; k++) cur.box[k] = lerp(cur.box[k], goal.box[k], e);
    for (let k = 0; k < 4; k++) cur.frame[k] = lerp(cur.frame[k], goal.frame[k], e);
    cur.set = true;
    const sway = reducedMotion ? 0 : 1.1 * Math.sin(time * 0.21);
    const bob = reducedMotion ? 0 : 0.5 * Math.sin(time * 0.17 + 1);
    placeCamera((cur.az + sway) * DEG + dragAz, cur.el + bob);

    if (!reducedMotion) for (const f of plant.fans) f.rotation.y += dt * 2.6;
    moveBeads(p, time);
    movePuffs(p, time);
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
      plant.dispose();
      beadGeo.dispose();
      puffGeo.dispose();
      puffEdges.dispose();
      disposeRenderer(renderer, scene);
    },
  };
}
