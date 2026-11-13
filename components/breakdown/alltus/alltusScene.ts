import type * as THREE from "three";
import {
  createProjector,
  createRenderer,
  createScreenBox,
  disposeRenderer,
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
import {
  UNIT_Y,
  buildBooks,
  buildDatabase,
  buildFaq,
  buildHouse,
  buildOffice,
  buildPerson,
  buildRack,
  buildRouter,
  createShop,
  type Part,
  type Shade,
  type V3,
} from "./alltusModels";

/*
  The Alltus breakdown: a low-poly diorama of one county's phone line. Scroll position
  (0 to 4, one per step) drives it:

  0  a resident calls the county office; blue pulses run down the line to the office
  1  call routing and a rack of voice agents rise on the line; more callers dial in at once
  2  the agent checks the county's own material; which sources light depends on the question
  3  the answer runs back to the phone, and a link goes out by text
  4  the camera pulls up and the one county becomes a field of them

  Blue marks what is live. Labels are HTML over the canvas, placed from projected points.
*/

type Three = typeof THREE;

export type CalloutKey = "resident" | "office" | "router" | "rack" | "kb" | "records" | "faq" | "answer" | "text" | "deploy";
export type NoteKey = "ask" | "askA" | "askB" | "govs";

export type AlltusDom = {
  callouts: Record<CalloutKey, Callout>;
  notes: Record<NoteKey, HTMLElement>;
  /** Three sound arcs by the resident's phone while the answer plays. */
  waves: SVGPathElement[];
};

/* ---------- layout (world units, about a metre each) ---------- */

const SLAB_W = 15;
const SLAB_D = 9.5;
type Spot = { at: V3; rot: number };
const RESIDENTS: Spot[] = [
  { at: [-3.9, 0, 1.6], rot: 0.5 },
  { at: [-2.5, 0, 3.4], rot: 0.3 },
  { at: [-5.8, 0, 3.1], rot: 0.6 },
  { at: [-4.4, 0, -1.3], rot: 0.8 },
];
const HOUSES: Spot[] = [
  { at: [-5.4, 0, -0.1], rot: 0.35 },
  { at: [-6.0, 0, -2.9], rot: 0.25 },
  { at: [-3.7, 0, -3.4], rot: 0.15 },
];
const ROUTER: Spot = { at: [-0.9, 0, 1.0], rot: 0.1 };
const RACK: Spot = { at: [1.0, 0, 1.2], rot: -0.15 };
const OFFICE: Spot = { at: [-0.6, 0, -2.9], rot: 0.1 };
const KB: Spot = { at: [3.0, 0, 2.6], rot: -0.3 };
const RECORDS: Spot = { at: [4.8, 0, 1.4], rot: 0 };
const FAQ: Spot = { at: [3.2, 0, 0.2], rot: -0.4 };

/** Camera per step: target x, y, z, radius to fit, yaw, pitch. */
type Shot = [number, number, number, number, number, number];
const SHOTS: Shot[] = [
  [-2.05, 1.0, -0.5, 4.25, 0.35, 0.34],
  [-2.35, 0.75, 1.2, 4.7, 0.22, 0.5],
  [2.75, 0.75, 1.3, 3.0, -0.15, 0.55],
  [-1.4, 0.9, 1.3, 3.8, 0.15, 0.38],
  [0, 0, 0, 27, 0.42, 0.88],
];

const FOV = 24;
const CABLE_R = 0.02;
const PULSE_R = 0.06;
const SPEED = 2.6;
const PULSE_GAP = 1.5;
const TILE_PITCH: [number, number] = [SLAB_W + 2, SLAB_D + 2];

export function createAlltusBreakdown(T: Three, ctx: SceneContext, dom: AlltusDom): BreakdownScene {
  const { canvas, host, position, reducedMotion, invalidate } = ctx;
  const palette = readPalette(host);
  const renderer = createRenderer(T, canvas);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(FOV, 1, 0.1, 400);
  paperLights(T, scene);
  // A little extra fill keeps the faces turned from the key as pale as the rest of the family.
  scene.add(new T.AmbientLight(0xffffff, 0.7));
  const shop = createShop(T, palette);

  const world = new T.Group();
  scene.add(world);
  const parts: Part[] = [];
  const mk = (name: string) => {
    const p = shop.part(name);
    parts.push(p);
    return p;
  };
  const put = (p: Part, s: Spot) => {
    p.group.position.set(...s.at);
    p.group.rotation.y = s.rot;
    world.add(p.group);
    return p;
  };
  const marker = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const o = new T.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };

  // ---- The diorama ------------------------------------------------------------------
  const slab = mk("slab");
  slab.add(shop.box(SLAB_W, 0.24, SLAB_D), 0, [0, -0.12, 0]);
  world.add(slab.group);
  slab.dim = 0.35;

  const residents = RESIDENTS.map((s, i) => {
    const body = mk(`resident${i}`);
    const phone = mk(`phone${i}`);
    const anchors = buildPerson(T, shop, body, phone);
    put(body, s);
    return { body, phone, ...anchors };
  });
  const feet = marker(residents[0].body.group, 0, 0.02, 0.1);
  const houses = HOUSES.map((s, i) => {
    const h = mk(`house${i}`);
    buildHouse(shop, h.add);
    return put(h, s);
  });

  const office = mk("office");
  buildOffice(shop, office.add);
  put(office, OFFICE);
  const officeTop = marker(office.group, 0, 2.5, 0);

  const router = mk("router");
  buildRouter(shop, router.add);
  put(router, ROUTER);
  const routerTop = marker(router.group, 0, 0.34, 0);

  const rack = mk("rack");
  const units = UNIT_Y.map((_, i) => mk(`unit${i}`));
  buildRack(shop, rack, units);
  put(rack, RACK);
  const rackTop = marker(rack.group, 0, 2.0, 0);

  const kb = mk("kb");
  const kbH = buildBooks(shop, kb.add);
  put(kb, KB);
  const records = mk("records");
  const recH = buildDatabase(shop, records.add);
  put(records, RECORDS);
  const faq = mk("faq");
  const faqH = buildFaq(shop, faq.add);
  put(faq, FAQ);
  const sources = [
    { part: kb, top: marker(kb.group, 0, kbH, 0), spot: KB },
    { part: records, top: marker(records.group, 0, recH, 0), spot: RECORDS },
    { part: faq, top: marker(faq.group, 0.1, faqH, -0.1), spot: FAQ },
  ];

  // The text message: a small blue bubble that flies from the rack to the phone.
  const text = mk("text");
  text.add(shop.bubble(0.5, 0.3, 0.05), 3);
  text.add(shop.box(0.26, 0.035, 0.012), 2, [-0.04, 0.24, 0.03]);
  world.add(text.group);
  text.tint = 1;

  world.updateMatrixWorld(true);

  // ---- Cables and the pulses that run along them -------------------------------------
  const lineColor = new T.Color("#c4c7cd");
  const agentColor = new T.Color(palette.agent);
  type Cable = {
    curve: THREE.Curve<THREE.Vector3>;
    len: number;
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    seg: number;
    draw: number;
    tint: number;
    alpha: number;
  };
  const RADIAL = 5;
  const cables: Cable[] = [];
  function cable(curve: THREE.Curve<THREE.Vector3>, seg = 72): Cable {
    const geo = new T.TubeGeometry(curve, seg, CABLE_R, RADIAL, false);
    const mat = new T.MeshBasicMaterial({ color: lineColor, transparent: true, toneMapped: false });
    const mesh = new T.Mesh(geo, mat);
    world.add(mesh);
    const c: Cable = { curve, len: curve.getLength(), mesh, mat, seg, draw: 1, tint: 0, alpha: 1 };
    cables.push(c);
    return c;
  }
  function updateCable(c: Cable) {
    const n = Math.round(Math.min(1, Math.max(0, c.draw)) * c.seg);
    c.mesh.visible = n > 0 && c.alpha > 0.01;
    c.mesh.geometry.setDrawRange(0, n * RADIAL * 6);
    c.mat.color.copy(lineColor).lerp(agentColor, c.tint);
    c.mat.opacity = c.alpha;
  }

  const wp = (o: THREE.Object3D) => o.getWorldPosition(new T.Vector3());
  const local = (p: Part, x: number, y: number, z: number) => p.group.localToWorld(new T.Vector3(x, y, z));
  /** An arc through the air, for a phone call. */
  const arc = (a: THREE.Vector3, b: THREE.Vector3, lift: number) => {
    const c1 = a.clone().lerp(b, 0.25);
    c1.y = a.y + lift;
    const c2 = a.clone().lerp(b, 0.75);
    c2.y = b.y + lift * 1.1;
    return new T.CubicBezierCurve3(a, c1, c2, b);
  };
  /** A cable along the floor that climbs to its end. */
  const floor = (a: THREE.Vector3, b: THREE.Vector3) => {
    const c1 = a.clone().lerp(b, 0.35);
    c1.y = 0.03;
    const c2 = b.clone().lerp(a, 0.3);
    c2.y = 0.03;
    return new T.CubicBezierCurve3(a, c1, c2, b);
  };

  /** Wires rising off the router and running level into each unit of the rack. */
  const fan = (a: THREE.Vector3, b: THREE.Vector3) => {
    const c1 = a.clone().lerp(b, 0.28);
    c1.y = b.y;
    const c2 = a.clone().lerp(b, 0.6);
    c2.y = b.y;
    return new T.CubicBezierCurve3(a, c1, c2, b);
  };

  // The calls. The first one starts out on the office's own line and, as the router comes
  // up, swings over to it.
  const officeDoor = local(office, 0, 0.3, 1.35);
  const routerIn = (i: number) => local(router, -0.36 + i * 0.12, 0.33, -0.12 + i * 0.08);
  const callCurve = (i: number, k = 1) =>
    arc(wp(residents[i].tip), i === 0 ? officeDoor.clone().lerp(routerIn(0), k) : routerIn(i), lerp(1.0, 1.25, k) + i * 0.1);
  const calls = residents.map((_, i) => cable(callCurve(i, i === 0 ? 0 : 1)));
  let reroute = 0;
  function setCurve(c: Cable, curve: THREE.Curve<THREE.Vector3>) {
    c.mesh.geometry.dispose();
    c.mesh.geometry = new T.TubeGeometry(curve, c.seg, CABLE_R, RADIAL, false);
    c.curve = curve;
    c.len = curve.getLength();
  }
  const toUnits = [0, 1, 2, 3].map((i) => cable(fan(local(router, 0.58, 0.15, 0.2 - i * 0.13), local(rack, -0.37, UNIT_Y[i], 0.06))));
  const toSources = sources.map((s, j) => {
    const a = local(rack, 0.37, UNIT_Y[0] - 0.04, 0.18 - j * 0.18);
    const centre = new T.Vector3(...s.spot.at);
    const r = j === 1 ? 0.44 : 0.5;
    const b = centre.clone().add(a.clone().sub(centre).setY(0).normalize().multiplyScalar(r));
    b.y = 0.1;
    return cable(floor(a, b));
  });
  const textArc = arc(wp(rackTop).add(new T.Vector3(0, 0.15, 0)), wp(residents[0].tip).add(new T.Vector3(0.1, 0.25, 0)), 1.4);
  const trail = new T.Line(
    new T.BufferGeometry().setFromPoints(textArc.getPoints(64)),
    new T.LineDashedMaterial({ color: palette.agent, dashSize: 0.07, gapSize: 0.09, transparent: true, opacity: 0, toneMapped: false }),
  );
  trail.computeLineDistances();
  world.add(trail);
  const answerAt = new T.Object3D();
  callCurve(0, 1).getPointAt(0.42, answerAt.position);
  world.add(answerAt);
  const textAt = new T.Object3D();
  textArc.getPointAt(0.45, textAt.position);
  world.add(textAt);

  type Leg = { c: Cable; rev: boolean };
  type Flow = { route: Leg[]; pulses: THREE.Mesh[]; phase: number; weight: number };
  const pulseGeo = new T.IcosahedronGeometry(PULSE_R, 0);
  const pulseMat = new T.MeshBasicMaterial({ color: palette.agent, toneMapped: false });
  const flows: Flow[] = [];
  function flow(route: Leg[], phase = 0): Flow {
    const len = route.reduce((s, l) => s + l.c.len, 0);
    const n = Math.max(2, Math.round(len / PULSE_GAP));
    const pulses = Array.from({ length: n }, () => {
      const m = new T.Mesh(pulseGeo, pulseMat);
      m.visible = false;
      world.add(m);
      return m;
    });
    const f = { route, pulses, phase, weight: 0 };
    flows.push(f);
    return f;
  }
  const fwd = (c: Cable): Leg => ({ c, rev: false });
  const back = (c: Cable): Leg => ({ c, rev: true });
  const toOffice = flow([fwd(calls[0])]);
  const inbound = calls.map((c, i) => flow([fwd(c), fwd(toUnits[i])], i * 0.29));
  const lookups = toSources.map((c, j) => ({ out: flow([fwd(c)], j * 0.2), ret: flow([back(c)], j * 0.2 + 0.5) }));
  const answer = flow([back(toUnits[0]), back(calls[0])]);

  function updateFlow(f: Flow, time: number) {
    const n = f.pulses.length;
    let len = 0;
    for (const l of f.route) len += l.c.len;
    for (let k = 0; k < n; k++) {
      const m = f.pulses[k];
      if (f.weight < 0.01) {
        m.visible = false;
        continue;
      }
      const g = (((time * SPEED) / len + k / n + f.phase) % 1 + 1) % 1;
      let rest = g * len;
      let leg = f.route[f.route.length - 1];
      for (const l of f.route) {
        if (rest <= l.c.len) {
          leg = l;
          break;
        }
        rest -= l.c.len;
      }
      const u = Math.min(1, rest / leg.c.len);
      const uu = leg.rev ? 1 - u : u;
      if (uu > leg.c.draw + 1e-3 || !leg.c.mesh.visible) {
        m.visible = false;
        continue;
      }
      leg.c.curve.getPointAt(uu, m.position);
      const edge = Math.min(1, g / 0.05, (1 - g) / 0.05);
      const s = f.weight * edge;
      m.visible = s > 0.03;
      m.scale.setScalar(Math.max(0.001, s));
    }
  }

  // ---- The field of counties for the last step ---------------------------------------
  const tileItems: { geo: THREE.BufferGeometry; m: THREE.Matrix4; shade: Shade }[] = [];
  const mat4 = (s: Spot) =>
    new T.Matrix4().compose(new T.Vector3(...s.at), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), s.rot), new T.Vector3(1, 1, 1));
  shop.collector(new T.Matrix4(), tileItems)(shop.box(SLAB_W, 0.24, SLAB_D), 0, [0, -0.12, 0]);
  buildOffice(shop, shop.collector(mat4(OFFICE), tileItems));
  for (const h of HOUSES) buildHouse(shop, shop.collector(mat4(h), tileItems));
  const tileGeo = shop.bake(tileItems);
  const tileMat = paperMaterial(T, "#ffffff");
  tileMat.vertexColors = true;
  const tileEdge = new T.LineBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
  const tiles: { group: THREE.Group; ring: number; jitter: number }[] = [];
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      if (!i && !j) continue;
      const g = new T.Group();
      g.position.set(i * TILE_PITCH[0], 0, j * TILE_PITCH[1]);
      g.add(new T.Mesh(tileGeo.fill, tileMat));
      g.add(new T.LineSegments(tileGeo.edges, tileEdge));
      g.visible = false;
      world.add(g);
      const ring = Math.max(Math.abs(i), Math.abs(j));
      tiles.push({ group: g, ring, jitter: ((i * 7 + j * 13 + 40) % 5) / 5 });
    }
  }

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

  // ---- Layout ------------------------------------------------------------------------
  let width = 1;
  let height = 1;
  const callouts = Object.values(dom.callouts);
  const noteSizes = new Map<HTMLElement, { w: number; h: number }>();
  function resize() {
    const size = sizeRenderer(renderer, camera);
    if (!size) return;
    width = size.width;
    height = size.height;
    remeasureCallouts(callouts);
    noteSizes.clear();
  }

  // ---- State from scroll position ----------------------------------------------------
  let qA = 1;
  let qB = 0;
  function apply(p: number, time: number) {
    const w = [0, 1, 2, 3, 4].map((i) => near(p, i));
    const phase = reducedMotion ? 0 : (time / 7) % 1;
    qB = ramp(phase, 0.46, 0.54) * (1 - ramp(phase, 0.96, 1));
    qA = 1 - qB;
    const busy = Math.max(w[1], w[4]);
    // Callers and houses other than the one we follow sit back in steps 2 and 3.
    const aside = track([0, 0, 1, 1, 0], p);
    // From high up in the last step, the small parts would turn to a smudge of ink.
    const far = ramp(p, 3.2, 3.75) * 0.75;

    residents[0].body.dim = Math.max(track([0, 0, 0.6, 0, 0], p), far);
    residents[0].phone.tint = track([1, 1, 0.5, 1, 1], p);
    for (let i = 1; i < residents.length; i++) {
      const r = residents[i];
      r.body.rise = ramp(p, 0.4 + 0.07 * i, 0.72 + 0.06 * i);
      r.body.dim = Math.max(aside, far);
      r.phone.tint = track([0, 1, 0, 0, 1], p);
      r.phone.dim = aside;
    }
    houses[0].dim = Math.max(track([0, 0, 0.8, 0.5, 0], p), far);
    for (let i = 1; i < houses.length; i++) {
      houses[i].rise = ramp(p, 0.45 + 0.06 * i, 0.78 + 0.06 * i);
      houses[i].dim = Math.max(aside, far);
    }
    office.dim = track([0, 0.8, 0.97, 0.92, 0], p);
    office.tint = track([0, 0, 0, 0, 1], p);
    router.rise = ramp(p, 0.36, 0.7);
    router.tint = track([0, 1, 0, 0.6, 0], p);
    router.dim = Math.max(track([0, 0, 0.5, 0, 0], p), far);
    rack.rise = ramp(p, 0.46, 0.8);
    rack.dim = far;
    units.forEach((u, i) => {
      if (i === 0) u.tint = track([0, 1, 1, 1, 1], p);
      else if (i < 4) u.tint = track([0, 1, 0, 0, 0.6], p);
      u.dim = i === 0 ? 0 : Math.max(track([0, i === 4 ? 0.3 : 0, 0.7, 0.7, 0.3], p), far);
    });
    const act = [1, qB, qA];
    sources.forEach((s, j) => {
      s.part.rise = ramp(p, 1.4 + 0.08 * j, 1.74 + 0.08 * j);
      s.part.tint = w[2] * act[j];
      s.part.dim = Math.max(track([0, 0, 0, 0.6, 0], p), far);
    });

    // Cables. The first call swings from the office's line over to the router.
    const k = ramp(p, 0.3, 0.72);
    if (Math.abs(k - reroute) > 0.002 || (k !== reroute && (k === 0 || k === 1))) {
      reroute = k;
      setCurve(calls[0], callCurve(0, k));
    }
    calls.forEach((c, i) => {
      if (i === 0) {
        c.tint = Math.max(w[0], w[1], w[3], w[4], w[2] * 0.4);
        c.alpha = 1;
      } else {
        c.draw = ramp(p, 0.45 + 0.07 * i, 0.78 + 0.06 * i);
        c.tint = busy;
        c.alpha = 1 - aside * 0.9;
      }
    });
    toUnits.forEach((c, i) => {
      c.draw = ramp(p, 0.55 + 0.05 * i, 0.9);
      c.tint = i === 0 ? Math.max(busy, w[3], w[2] * 0.4) : busy;
      c.alpha = i === 0 ? 1 : 1 - aside * 0.9;
    });
    toSources.forEach((c, j) => {
      c.draw = ramp(p, 1.45 + 0.08 * j, 1.8 + 0.08 * j);
      c.tint = w[2] * act[j];
      c.alpha = 1 - 0.9 * ramp(p, 2.5, 3);
    });

    // Pulses.
    toOffice.weight = w[0];
    inbound.forEach((f) => (f.weight = busy));
    lookups.forEach((l, j) => {
      l.out.weight = w[2] * act[j];
      l.ret.weight = w[2] * act[j];
    });
    answer.weight = w[3];

    // The text: out of the rack, over the top and down to the phone, every few seconds.
    const u = reducedMotion ? 0.5 : (time / 3.2) % 1;
    textArc.getPointAt(Math.min(1, u / 0.72), text.group.position);
    text.rise = w[3] * Math.min(ramp(u, 0, 0.08), 1 - ramp(u, 0.84, 0.98));
    (trail.material as THREE.LineDashedMaterial).opacity = w[3] * 0.85;
    trail.visible = w[3] > 0.01;

    // The field of counties.
    for (const t of tiles) {
      const a = 3.2 + 0.14 * t.ring + 0.06 * t.jitter;
      const r = ramp(p, a, a + 0.34);
      t.group.visible = r > 0.002;
      t.group.scale.set(lerp(0.6, 1, r), Math.max(0.001, r), lerp(0.6, 1, r));
    }

    for (const part of parts) part.update();
    for (const c of cables) updateCable(c);
  }

  // ---- Camera ------------------------------------------------------------------------
  const cam = { x: 0, y: 0, z: 0, r: 1, yaw: 0, pitch: 0, set: false };
  const target = new T.Vector3();
  function aim(p: number, dt: number, time: number) {
    const goal = {
      x: track(SHOTS.map((s) => s[0]), p),
      y: track(SHOTS.map((s) => s[1]), p),
      z: track(SHOTS.map((s) => s[2]), p),
      r: Math.exp(track(SHOTS.map((s) => Math.log(s[3])), p)),
      yaw: track(SHOTS.map((s) => s[4]), p),
      pitch: track(SHOTS.map((s) => s[5]), p),
    };
    const e = !cam.set || reducedMotion || dt === 0 ? 1 : 1 - Math.exp(-dt * 6);
    cam.x = lerp(cam.x, goal.x, e);
    cam.y = lerp(cam.y, goal.y, e);
    cam.z = lerp(cam.z, goal.z, e);
    cam.r = Math.exp(lerp(Math.log(cam.r), Math.log(goal.r), e));
    cam.yaw = lerp(cam.yaw, goal.yaw, e);
    cam.pitch = lerp(cam.pitch, goal.pitch, e);
    cam.set = true;

    const sway = reducedMotion ? 0 : 0.035 * Math.sin(time * 0.23);
    const yaw = cam.yaw + yawOff + sway;
    const tan = Math.tan((FOV * Math.PI) / 360);
    const d = cam.r / Math.min(tan, (tan * width) / height);
    target.set(cam.x, cam.y, cam.z);
    camera.position.set(
      cam.x + d * Math.sin(yaw) * Math.cos(cam.pitch),
      cam.y + d * Math.sin(cam.pitch),
      cam.z + d * Math.cos(yaw) * Math.cos(cam.pitch),
    );
    camera.lookAt(target);
    camera.near = Math.max(0.05, d * 0.05);
    camera.far = d * 6;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  // ---- Overlays ----------------------------------------------------------------------
  const project = createProjector(T);
  const screenBox = createScreenBox(T);
  const f1 = (n: number) => n.toFixed(1);
  const setOpacity = (el: Element, o: number) => {
    (el as HTMLElement | SVGElement).style.opacity = o > 0.01 ? o.toFixed(3) : "0";
  };

  type Spec = { key: CalloutKey; anchor: THREE.Object3D; box: THREE.Object3D | null; side: Side; weight: (p: number) => number };
  const SPECS: Spec[] = [
    { key: "resident", anchor: feet, box: residents[0].body.group, side: "bottom", weight: (p) => near(p, 0) },
    { key: "office", anchor: officeTop, box: office.group, side: "top", weight: (p) => near(p, 0) },
    { key: "router", anchor: routerTop, box: router.group, side: "bottom", weight: (p) => near(p, 1) },
    { key: "rack", anchor: rackTop, box: rack.group, side: "top", weight: (p) => near(p, 1) },
    { key: "kb", anchor: sources[0].top, box: kb.group, side: "bottom", weight: (p) => near(p, 2) },
    { key: "records", anchor: sources[1].top, box: records.group, side: "top", weight: (p) => near(p, 2) },
    { key: "faq", anchor: sources[2].top, box: faq.group, side: "top", weight: (p) => near(p, 2) },
    { key: "answer", anchor: answerAt, box: null, side: "top", weight: (p) => near(p, 3) },
    { key: "text", anchor: textAt, box: null, side: "top", weight: (p) => near(p, 3) },
    { key: "deploy", anchor: officeTop, box: office.group, side: "top", weight: (p) => near(p, 4) },
  ];
  const sp: ScreenPoint = { x: 0, y: 0, behind: false };
  const rect: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const placement: CalloutPlacement = { callout: callouts[0], x: 0, y: 0, side: "top", opacity: 0 };

  function sizeOf(el: HTMLElement) {
    let s = noteSizes.get(el);
    if (!s || !s.w) {
      s = { w: el.offsetWidth, h: el.offsetHeight };
      noteSizes.set(el, s);
    }
    return s;
  }

  function note(el: HTMLElement, x: number, y: number, o: number, align: "left" | "center" | "right" = "left") {
    setOpacity(el, o);
    if (o <= 0.01) return;
    const s = sizeOf(el);
    let left = align === "left" ? x : align === "right" ? x - s.w : x - s.w / 2;
    let top = y - s.h / 2;
    left = Math.min(Math.max(left, 4), width - s.w - 4);
    top = Math.min(Math.max(top, 4), height - s.h - 4);
    el.style.transform = `translate3d(${f1(left)}px, ${f1(top)}px, 0)`;
  }

  const headPt: ScreenPoint = { x: 0, y: 0, behind: false };
  const phonePt: ScreenPoint = { x: 0, y: 0, behind: false };
  const topPt: ScreenPoint = { x: 0, y: 0, behind: false };
  function overlays(p: number, time: number) {
    const W = width;
    const H = height;
    const stage = { width: W, height: H };
    const gap = W < 520 ? 12 : 18;
    let faqTop = Infinity;
    for (const spec of SPECS) {
      const o = spec.weight(p);
      placement.callout = dom.callouts[spec.key];
      placement.opacity = 0;
      if (o > 0.01) {
        project(spec.anchor, camera, W, H, sp);
        placement.x = sp.x;
        placement.y = sp.y;
        placement.side = spec.side;
        // A label whose part is off the stage would trail a long leader; leave it out.
        const off = sp.x < 0 || sp.x > W || sp.y < 0 || sp.y > H;
        placement.opacity = sp.behind || off ? 0 : o;
        if (spec.box) screenBox(spec.box, camera, W, H, rect);
        else {
          rect.left = sp.x - 6;
          rect.right = sp.x + 6;
          rect.top = sp.y - 6;
          rect.bottom = sp.y + 6;
        }
        if (spec.key === "faq") faqTop = rect.top - gap - sizeOf(placement.callout.el).h;
      }
      placeCallouts([placement], rect, stage, gap);
    }

    // The caller's question by their head, then above the agent while it looks it up.
    project(residents[0].head, camera, W, H, headPt);
    note(dom.notes.ask, headPt.x - 12, headPt.y - 20, near(p, 0, 0.25, 0.5), "right");
    project(rackTop, camera, W, H, topPt);
    const w2 = near(p, 2, 0.25, 0.5);
    // Kept above the FAQ bank's label, which sits close by on a narrow stage.
    const askY = Math.min(topPt.y - 30, faqTop - 6 - sizeOf(dom.notes.askA).h / 2);
    note(dom.notes.askA, topPt.x, askY, w2 * qA, "center");
    note(dom.notes.askB, topPt.x, askY, w2 * qB, "center");
    note(dom.notes.govs, W / 2, H - 22, near(p, 4), "center");

    // Sound coming out of the phone while the answer plays.
    project(residents[0].tip, camera, W, H, phonePt);
    const w3 = near(p, 3);
    const dir = phonePt.x >= headPt.x ? 1 : -1;
    dom.waves.forEach((path, i) => {
      const r = 9 + i * 6;
      const cx = phonePt.x + dir * 5;
      const cy = phonePt.y - 2;
      const a0 = (-50 * Math.PI) / 180;
      const a1 = (50 * Math.PI) / 180;
      const x0 = cx + dir * r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + dir * r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      path.setAttribute("d", `M ${f1(x0)} ${f1(y0)} A ${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${f1(x1)} ${f1(y1)}`);
      const beat = reducedMotion ? 0.8 : 0.25 + 0.75 * Math.max(0, Math.sin(time * 5 - i * 0.9));
      setOpacity(path, w3 * beat);
    });
  }

  // ---- Frame -------------------------------------------------------------------------
  let time = 0;
  let lastP = -1;
  function frame(dt: number) {
    time += dt;
    const p = Math.min(4, Math.max(0, position.current ?? 0));
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
    aim(p, dt, time);
    text.group.quaternion.copy(camera.quaternion);
    world.updateMatrixWorld(true);
    for (const f of flows) updateFlow(f, time);
    renderer.render(scene, camera);
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
      tileGeo.fill.dispose();
      tileGeo.edges.dispose();
      disposeRenderer(renderer, scene);
    },
  };
}
