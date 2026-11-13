import type * as THREE from "three";
import {
  isWideStage,
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
import { buildLine, buildStopChart, GATE, LineSim, PLATE_LEN } from "./lineModel";

/*
  The production-lines breakdown. Scroll position (0 to 4, one per step) drives it:

  0  a chain: once the stage is in view, M3 stops, cartons queue behind it, M4 runs dry
  1  where the time goes: a stop-time bar rises over each machine, M3's far above the rest
  2  the machine: close in on M3, the crooked rail lifts out and a new one drops in
  3  the routine: an operator with a written procedure; M2 stops, the checks tick, it restarts
  4  the result: a second line slides in, downtime before and after on both

  Cartons always run. Blue marks what each step is about. Labels are HTML over the canvas,
  placed from projected 3D points every frame.
*/

type Three = typeof THREE;

/** Where the camera looks: a world box to fit, from an angle, into part of the stage. */
type Shot = {
  /** x0, y0, z0, x1, y1, z1 */
  box: [number, number, number, number, number, number];
  /** Around the vertical, from straight in front of the line; and up from level. */
  az: number;
  el: number;
  /** Left, top, right, bottom of the stage, as fractions. */
  frame: [number, number, number, number];
};

const LINE_B_Z = -4.4;

// Stages taller than wide (desktop columns).
const SHOTS_TALL: Shot[] = [
  { box: [-6.2, 0, -1.1, 7.1, 2.4, 1.2], az: 0.92, el: 0.6, frame: [0.03, 0.1, 0.97, 0.9] },
  { box: [-6.2, 0, -1.1, 7.1, 5.5, 1.2], az: 0.7, el: 0.4, frame: [0.04, 0.05, 0.96, 0.92] },
  { box: [-0.9, 0.55, -1.0, 1.6, 1.95, 0.5], az: 0.3, el: 0.38, frame: [0.1, 0.18, 0.9, 0.78] },
  { box: [-2.7, 0, -1.0, 1.7, 2.3, 1.5], az: 0.42, el: 0.4, frame: [0.05, 0.36, 0.95, 0.96] },
  { box: [-6.2, 0, LINE_B_Z - 1.2, 8.7, 2.7, 1.5], az: 0.45, el: 0.78, frame: [0.03, 0.06, 0.9, 0.92] },
];
// Stages about square or wider (phones).
const SHOTS_WIDE: Shot[] = [
  { box: SHOTS_TALL[0].box, az: 0.62, el: 0.55, frame: [0.03, 0.1, 0.97, 0.92] },
  { box: SHOTS_TALL[1].box, az: 0.5, el: 0.38, frame: [0.03, 0.04, 0.97, 0.96] },
  { box: SHOTS_TALL[2].box, az: 0.3, el: 0.38, frame: [0.1, 0.12, 0.9, 0.82] },
  { box: SHOTS_TALL[3].box, az: 0.42, el: 0.4, frame: [0.03, 0.34, 0.97, 0.98] },
  { box: SHOTS_TALL[4].box, az: 0.4, el: 0.72, frame: [0.03, 0.04, 0.85, 0.96] },
];

const TAG_KEYS = ["stopped", "bottleneck", "change", "texas", "california"] as const;
const NOTE_KEYS = ["backup", "dry", "stopTime", "cutA", "cutB"] as const;
type TagKey = (typeof TAG_KEYS)[number];
type NoteKey = (typeof NOTE_KEYS)[number];
type Tag = { el: HTMLElement; line: SVGLineElement; dot: SVGCircleElement };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Step 3's six-second loop: M2 stops, the card's three checks tick, then the line restarts. */
const TICKS = [0.5, 1.0, 1.5];
const RESTART_AT = 2.1;

/** Which machines are stopped at a scroll position and time. */
function stopsAt(p: number, t: number, armed: boolean) {
  const s = [false, false, false, false];
  let jam = false;
  // Step 0: once the reader is here, M3 stops and stays stopped.
  if (p < 0.5 && armed) s[2] = true;
  // Step 1, until the fix: M3 jams every few seconds, the others now and then.
  if (p >= 0.6 && p < 1.55) {
    if (t % 3 < 1) {
      s[2] = true;
      jam = true;
    }
    if ((t + 1.3) % 7 < 0.5) s[1] = true;
    if ((t + 4.1) % 8 < 0.45) s[3] = true;
  }
  // Step 3: M2 stops and the crew brings it back by the written steps.
  if (p >= 2.6 && p < 3.4 && t % 6 < RESTART_AT) s[1] = true;
  return { s, jam };
}

export function createLinesScene(T: Three, ctx: SceneContext): BreakdownScene {
  const { canvas, host, position, reducedMotion, invalidate } = ctx;
  const palette = readPalette(host);
  const renderer = createRenderer(T, canvas);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(22, 1, 0.1, 200);
  paperLights(T, scene);

  const lineA = buildLine(T, palette);
  const lineB = buildLine(T, palette);
  lineB.root.position.z = LINE_B_Z;
  lineB.oldRail.group.visible = false;
  lineB.plate.scale.x = PLATE_LEN.result;
  const chart = buildStopChart(T, palette);
  lineA.root.add(chart.root);
  scene.add(lineA.root, lineB.root);

  const simA = new LineSim(lineA.cartons);
  const simB = new LineSim(lineB.cartons);
  simA.run(9);
  simB.run(9.4);

  // ---- Overlays from the host --------------------------------------------------------------
  const q = <E extends Element>(sel: string): E => {
    const el = host.querySelector<E>(sel);
    if (!el) throw new Error(`Lines overlay is missing ${sel}`);
    return el;
  };
  const tags = {} as Record<TagKey, Tag>;
  for (const k of TAG_KEYS) {
    tags[k] = {
      el: q<HTMLElement>(`[data-tag="${k}"]`),
      line: q<SVGLineElement>(`[data-line="${k}"]`),
      dot: q<SVGCircleElement>(`[data-dot="${k}"]`),
    };
  }
  const notes = {} as Record<NoteKey, HTMLElement>;
  for (const k of NOTE_KEYS) notes[k] = q<HTMLElement>(`[data-note="${k}"]`);
  const dims = { backup: q<SVGPathElement>('[data-dim="backup"]'), dry: q<SVGPathElement>('[data-dim="dry"]') };
  const card = q<HTMLElement>('[data-k="card"]');
  const cardLine = q<SVGLineElement>('[data-line="card"]');
  const cardDot = q<SVGCircleElement>('[data-dot="card"]');
  const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-row]"));

  // ---- Layout ----------------------------------------------------------------------------------
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

  // ---- Camera ----------------------------------------------------------------------------------
  const right = new T.Vector3();
  const up = new T.Vector3();
  const back = new T.Vector3();
  const corner = new T.Vector3();
  const m4 = new T.Matrix4();
  const basis = (az: number, el: number) => {
    back.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    right.set(Math.cos(az), 0, -Math.sin(az));
    up.crossVectors(back, right);
  };
  const goal = { tx: 0, ty: 0, tz: 0, az: 0, el: 0, d: 1, rx: 0, ry: 0 };
  const cam = { ...goal, set: false };
  const keys = ["tx", "ty", "tz", "az", "el", "d", "rx", "ry"] as const;
  const box6 = [0, 0, 0, 0, 0, 0];
  const frame4 = [0, 0, 0, 0];
  const xs = [0, 0, 0, 0, 0, 0, 0, 0];
  const ys = [0, 0, 0, 0, 0, 0, 0, 0];
  const zs = [0, 0, 0, 0, 0, 0, 0, 0];
  // Each shot value as a column across the steps, for track().
  const columns = (shots: Shot[]) => ({
    box: [0, 1, 2, 3, 4, 5].map((k) => shots.map((s) => s.box[k])),
    frame: [0, 1, 2, 3].map((k) => shots.map((s) => s.frame[k])),
    az: shots.map((s) => s.az),
    el: shots.map((s) => s.el),
  });
  const colsTall = columns(SHOTS_TALL);
  const colsWide = columns(SHOTS_WIDE);

  /** The camera target and distance that fit the box for position p. */
  function aim(p: number) {
    const cols = wide ? colsWide : colsTall;
    for (let k = 0; k < 6; k++) box6[k] = track(cols.box[k], p);
    for (let k = 0; k < 4; k++) frame4[k] = track(cols.frame[k], p);
    goal.az = track(cols.az, p);
    goal.el = track(cols.el, p);
    basis(goal.az, goal.el);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let k = 0; k < 8; k++) {
      corner.set(k & 1 ? box6[3] : box6[0], k & 2 ? box6[4] : box6[1], k & 4 ? box6[5] : box6[2]);
      const cx = corner.dot(right);
      const cy = corner.dot(up);
      const cz = corner.dot(back);
      xs[k] = cx;
      ys[k] = cy;
      zs[k] = cz;
      x0 = Math.min(x0, cx);
      x1 = Math.max(x1, cx);
      y0 = Math.min(y0, cy);
      y1 = Math.max(y1, cy);
      z0 = Math.min(z0, cz);
      z1 = Math.max(z1, cz);
    }
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const mz = (z0 + z1) / 2;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = (tan * (frame4[2] - frame4[0]) * width) / height;
    const tanV = tan * (frame4[3] - frame4[1]);
    let d = 1;
    for (let k = 0; k < 8; k++) {
      d = Math.max(d, zs[k] - mz + Math.abs(xs[k] - mx) / tanH, zs[k] - mz + Math.abs(ys[k] - my) / tanV);
    }
    goal.tx = right.x * mx + up.x * my + back.x * mz;
    goal.ty = right.y * mx + up.y * my + back.y * mz;
    goal.tz = right.z * mx + up.z * my + back.z * mz;
    goal.d = d;
    goal.rx = ((frame4[0] + frame4[2]) / 2) * width;
    goal.ry = ((frame4[1] + frame4[3]) / 2) * height;
  }

  function place(p: number, dt: number) {
    aim(p);
    const e = !cam.set || reducedMotion || dt === 0 ? 1 : 1 - Math.exp(-dt * 6);
    for (const k of keys) cam[k] = lerp(cam[k], goal[k], e);
    cam.set = true;
    basis(cam.az, cam.el);
    camera.position.set(cam.tx + back.x * cam.d, cam.ty + back.y * cam.d, cam.tz + back.z * cam.d);
    camera.quaternion.setFromRotationMatrix(m4.makeBasis(right, up, back));
    camera.setViewOffset(width, height, width / 2 - cam.rx, height / 2 - cam.ry, width, height);
    camera.updateMatrixWorld(true);
  }

  // ---- State -------------------------------------------------------------------------------------
  let time = 0;
  /** Seconds since M3's step 0 stop began. */
  let stopClock = 0;
  const tintA = [0, 0, 0, 0];
  let staticStep = -1;

  /** A still picture for reduced motion: run the model with that step's stops. */
  function still(step: number) {
    simA.reset();
    simB.reset();
    simA.run(14, (t) => [false, false, step === 0 && t > 3, false]);
    simB.run(14.4);
    stopClock = step === 0 ? 10 : 0;
  }

  function apply(p: number, dt: number) {
    const r = host.getBoundingClientRect();
    const armed = reducedMotion || r.top < window.innerHeight * 0.35;
    const { s, jam } = stopsAt(p, time, armed);

    if (reducedMotion) {
      const k = Math.round(p);
      if (k !== staticStep) {
        staticStep = k;
        still(k);
      }
      // Still pictures only show step 0's stop.
      simA.stopped = [false, false, k === 0, false];
    } else {
      simA.stopped = s;
      simA.jam = jam;
      simA.step(dt);
      simB.step(dt);
      stopClock = p < 0.5 && s[2] ? stopClock + dt : 0;
    }
    simA.sync();
    simB.sync();
    lineA.belt(simA.belt);
    lineB.belt(simB.belt);

    // Moving parts follow the cartons through them, so a starved or blocked machine stalls.
    for (const [line, sim] of [
      [lineA, simA],
      [lineB, simB],
    ] as const) {
      const bob = 0.5 - 0.5 * Math.cos((sim.work[1] / sim.pitch) * Math.PI * 2);
      line.heads.m2.position.y = 1.68 - 0.09 * bob;
      line.heads.m3.rotation.y = sim.work[2] * 4;
      // Starts part full, gains a case every 3 cartons, and swaps the pallet when full.
      const filled = Math.floor((sim.out + 12) / 3) % 9;
      line.cases.forEach((c, i) => {
        c.visible = i < filled;
      });
    }

    // A stopped machine and its light turn blue.
    for (let k = 0; k < 4; k++) {
      const target = simA.stopped[k] ? 1 : 0;
      tintA[k] = reducedMotion || dt === 0 ? target : tintA[k] + (target - tintA[k]) * Math.min(1, dt * 10);
      lineA.machines[k].light(tintA[k]);
      lineA.machines[k].body(tintA[k] * 0.85);
    }

    // Step 1: the stop-time chart rises over the line.
    const chartOn = ramp(p, 0.4, 0.8) * (1 - ramp(p, 1.25, 1.55));
    chart.root.visible = chartOn > 0.01;
    chart.fade.set(chartOn);
    const grow = Math.max(1e-3, ramp(p, 0.5, 0.95) * (1 - ramp(p, 1.25, 1.55)));
    for (const bar of chart.bars) bar.scale.y = grow;

    // Step 2: the old rail lifts out and the new one drops in.
    const swap = ramp(p, 1.3, 1.8);
    lineA.oldRail.group.visible = swap < 0.99;
    lineA.oldRail.group.position.y = 0.8 * swap;
    lineA.oldRail.fade.set(1 - swap);
    lineA.newRail.group.visible = swap > 0.01;
    lineA.newRail.group.position.y = 0.8 * (1 - swap);
    lineA.newRail.fade.set(swap);
    lineA.newRail.tint(near(p, 2, 0.3, 0.7));

    // Step 3: the operator and the written procedure.
    const op = ramp(p, 2.35, 2.8);
    lineA.operator.group.visible = op > 0.01;
    lineA.operator.fade.set(op);
    lineA.operator.board(near(p, 3, 0.3, 0.6));

    // Step 4: the second line, and downtime before and after on both.
    const b = ramp(p, 3.25, 3.75);
    lineB.root.visible = b > 0.01;
    lineB.fade.set(b);
    lineB.root.position.z = LINE_B_Z - (1 - b) * 1.6;
    const g = Math.max(1e-3, ramp(p, 3.4, 3.9));
    lineA.plate.scale.x = lerp(PLATE_LEN.line, PLATE_LEN.result, ramp(p, 3.25, 3.75));
    for (const line of [lineA, lineB]) {
      line.result.group.visible = g > 0.01;
      for (const bar of line.result.bars) bar.scale.y = g;
    }
    return { b, g, op, swap, chartOn };
  }

  // ---- Overlays ---------------------------------------------------------------------------------
  const project = createProjector(T);
  const pt = (): ScreenPoint => ({ x: 0, y: 0, behind: false });
  const P = {
    m3Light: pt(),
    barTop: pt(),
    chartStart: pt(),
    rail: pt(),
    hand: pt(),
    texas: pt(),
    california: pt(),
    afterA: pt(),
    afterB: pt(),
    a: pt(),
    b: pt(),
  };
  const v = new T.Vector3();
  const f1 = (n: number) => n.toFixed(1);
  const setO = (el: Element, o: number) => {
    (el as HTMLElement | SVGElement).style.opacity = o > 0.01 ? o.toFixed(3) : "0";
  };
  const measure = (el: HTMLElement) => {
    let s = sizes.get(el);
    if (!s || !s.w) {
      s = { w: el.offsetWidth, h: el.offsetHeight };
      sizes.set(el, s);
    }
    return s;
  };

  /** A label centred at the anchor plus (dx, dy), with a leader back to the anchor. */
  function tag(t: { el: HTMLElement; line: SVGLineElement; dot: SVGCircleElement }, a: ScreenPoint, dx: number, dy: number, o: number) {
    const shown = a.behind ? 0 : o;
    setO(t.el, shown);
    setO(t.line, shown);
    setO(t.dot, shown);
    if (shown <= 0.01) return;
    const { w, h } = measure(t.el);
    const left = clamp(a.x + dx - w / 2, 4, width - w - 4);
    const top = clamp(a.y + dy - h / 2, 4, height - h - 4);
    t.el.style.transform = `translate3d(${f1(left)}px, ${f1(top)}px, 0)`;
    const ex = clamp(a.x, left, left + w);
    const ey = clamp(a.y, top, top + h);
    t.line.setAttribute("x1", f1(a.x));
    t.line.setAttribute("y1", f1(a.y));
    t.line.setAttribute("x2", f1(ex));
    t.line.setAttribute("y2", f1(ey));
    t.dot.setAttribute("cx", f1(a.x));
    t.dot.setAttribute("cy", f1(a.y));
  }

  /** A plain note with (x, y) at its left, centre or right middle. */
  function note(el: HTMLElement, x: number, y: number, o: number, align: "left" | "center" | "right" = "center") {
    setO(el, o);
    if (o <= 0.01) return;
    const { w, h } = measure(el);
    const left = clamp(align === "left" ? x : align === "right" ? x - w : x - w / 2, 4, width - w - 4);
    const top = clamp(y - h / 2, 4, height - h - 4);
    el.style.transform = `translate3d(${f1(left)}px, ${f1(top)}px, 0)`;
  }

  /** A dimension line on the floor from world x0 to x1 in front of line A, with a note under it. */
  function dim(path: SVGPathElement, label: HTMLElement, x0: number, x1: number, o: number) {
    setO(path, o);
    setO(label, o);
    if (o <= 0.01) return;
    project(v.set(x0, 0.01, 0.95), camera, width, height, P.a);
    project(v.set(x1, 0.01, 0.95), camera, width, height, P.b);
    const { a, b } = P;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Ticks square to the line, pointing up and down the screen.
    const nx = (-dy / len) * 5;
    const ny = (dx / len) * 5;
    path.setAttribute(
      "d",
      `M ${f1(a.x)} ${f1(a.y)} L ${f1(b.x)} ${f1(b.y)} ` +
        `M ${f1(a.x - nx)} ${f1(a.y - ny)} L ${f1(a.x + nx)} ${f1(a.y + ny)} ` +
        `M ${f1(b.x - nx)} ${f1(b.y - ny)} L ${f1(b.x + nx)} ${f1(b.y + ny)}`,
    );
    // Under the line, far enough down that the label clears its slope.
    const { w, h } = measure(label);
    const drop = (Math.abs(dy) / Math.max(Math.abs(dx), 1)) * (w / 2) + h / 2 + 10;
    note(label, (a.x + b.x) / 2, (a.y + b.y) / 2 + drop, o);
  }

  function overlays(p: number, st: ReturnType<typeof apply>) {
    const k = Math.min(1, width / 640);

    // Step 0: the stop, the queue and the dry run.
    const w0 = near(p, 0, 0.25, 0.5);
    project(lineA.marks.m3Light, camera, width, height, P.m3Light);
    tag(tags.stopped, P.m3Light, 64 * k, -34 * k, w0 * tintA[2]);
    dim(dims.backup, notes.backup, GATE[1] + 0.45, GATE[2] - 0.35, w0 * ramp(stopClock, 0.8, 1.8));
    dim(dims.dry, notes.dry, GATE[2] + 0.5, GATE[3] - 1.1, w0 * ramp(stopClock, 2.2, 3.2));

    // Step 1: the bottleneck's bar.
    const w1 = near(p, 1, 0.25, 0.5) * st.chartOn;
    project(chart.tops[2], camera, width, height, P.barTop);
    tag(tags.bottleneck, P.barTop, 40 + 70 * k, -6 * k, w1);
    project(chart.start, camera, width, height, P.chartStart);
    note(notes.stopTime, P.chartStart.x, P.chartStart.y - 30 * k, w1, "left");

    // Step 2: the new part.
    project(lineA.marks.rail, camera, width, height, P.rail);
    tag(tags.change, P.rail, -40 * k, 110 * k, near(p, 2, 0.25, 0.5) * st.swap);

    // Step 3: the procedure card.
    const w3 = near(p, 3, 0.25, 0.5) * st.op;
    project(lineA.operator.hand, camera, width, height, P.hand);
    setO(card, w3);
    setO(cardLine, w3);
    setO(cardDot, w3);
    if (w3 > 0.01) {
      // The card sits in the space above the line, up and to the left of the operator.
      const { w, h } = measure(card);
      const left = clamp(P.hand.x - w - 36 * k, 4, width - w - 4);
      const top = height * (wide ? 0.04 : 0.1);
      card.style.transform = `translate3d(${f1(left)}px, ${f1(top)}px, 0)`;
      const ex = clamp(P.hand.x, left, left + w);
      const ey = clamp(P.hand.y, top, top + h);
      cardLine.setAttribute("x1", f1(P.hand.x));
      cardLine.setAttribute("y1", f1(P.hand.y));
      cardLine.setAttribute("x2", f1(ex));
      cardLine.setAttribute("y2", f1(ey));
      cardDot.setAttribute("cx", f1(P.hand.x));
      cardDot.setAttribute("cy", f1(P.hand.y));
    }
    // The checks tick off one by one while M2 is down, then the line restarts.
    const c = time % 6;
    const done = reducedMotion || p < 2.6 || p >= 3.4 ? 3 : TICKS.filter((t) => c >= t).length;
    rows.forEach((row, i) => {
      if (i < done) row.dataset.done = "";
      else delete row.dataset.done;
    });

    // Step 4: the two lines and their downtime.
    const w4 = near(p, 4, 0.3, 0.55);
    project(lineA.marks.front, camera, width, height, P.texas);
    project(lineB.marks.m1Top, camera, width, height, P.california);
    tag(tags.texas, P.texas, 10 * k, 40 * k, w4);
    tag(tags.california, P.california, 10 * k, -44 * k, w4 * st.b);
    project(lineA.result.afterTop, camera, width, height, P.afterA);
    project(lineB.result.afterTop, camera, width, height, P.afterB);
    const w4b = w4 * ramp(st.g, 0.6, 1);
    note(notes.cutA, P.afterA.x + 6, P.afterA.y, w4b, "left");
    note(notes.cutB, P.afterB.x + 6, P.afterB.y, w4b * st.b, "left");
  }

  // ---- Frame -------------------------------------------------------------------------------------
  function frame(dt: number) {
    time += dt;
    const p = clamp(position.current ?? 0, 0, 4);
    const st = apply(p, dt);
    scene.updateMatrixWorld(true);
    place(p, dt);
    renderer.render(scene, camera);
    overlays(p, st);
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
      disposeRenderer(renderer, scene);
    },
  };
}
