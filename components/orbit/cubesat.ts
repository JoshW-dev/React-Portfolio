import type * as THREE from "three";

/*
  A 3U CubeSat built from three.js primitives, shared by the film intro and the scroll
  breakdown on the project page. Units are metres. The long axis is +Y; the camera lens
  sits on the -Y end (the end that faces Earth) and the antennas on the +Y end.

  Solar cells sit on one face only, the +Z face, one cell per unit. Two wings, each a 1U by
  3U panel, hinge on that face's long edges and open out flat beside it, so deployed the
  array is one plane of 3 x 3 cells, about 30 cm square. Stowed, the wings fold down
  against the +X and -X faces. The other faces are plain plates.

  Unit 0 (the -Y end) is the payload, unit 1 the ADCS, unit 2 power and computer. Three is
  passed in, so this file never pulls three.js into a bundle on its own.
*/

type Three = typeof THREE;

/** One unit along the long axis. A 3U CubeSat is 340.5 mm long. */
export const UNIT = 0.1135;
const WIDTH = 0.1;
const HALF = WIDTH / 2;
const RAIL = 0.0085;
const INNER = HALF - RAIL;
const PANEL_T = 0.0016;
/** One solar cell fills each 1U square of the array. */
const CELL_W = 0.08;
const CELL_H = 0.098;
/** A wing is one 1U by 3U panel. Its hinge line sits just outside the body. */
const WING_W = 0.096;
const WING_H = 3 * UNIT - 0.004;
const HINGE_OUT = 0.002;
const WING_GAP = 0.003;
const ANTENNA = 0.17;

/** How far apart the units move when fully taken apart, and how far the skins lift. */
const SEPARATION = 0.15;
const LIFT = 0.07;

/** Material sets: one per unit and one for the wings, so each can be faded or tinted. */
export const SET = { payload: 0, adcs: 1, power: 2, wings: 3 } as const;
export type SetIndex = (typeof SET)[keyof typeof SET];

export type Role =
  | "alu"
  | "plate"
  | "skin"
  | "black"
  | "substrate"
  | "cell"
  | "hinge"
  | "glass"
  | "tape"
  | "antennaBase"
  | "pcb"
  | "chip"
  | "gold"
  | "copper"
  | "rotor"
  | "battery";

type Spec = {
  color: number;
  metal: number;
  rough: number;
  /** Fades out when the set is ghosted (skins and wings). */
  ghost?: boolean;
  /** Clear coat, which needs a physical material. */
  coat?: number;
  map?: boolean;
  /** Edge line weight in the drawing look. */
  weight?: number;
};

const SPEC: Record<Role, Spec> = {
  alu: { color: 0xc3c7cd, metal: 0.95, rough: 0.32, weight: 0.4 },
  plate: { color: 0xb4b8be, metal: 0.9, rough: 0.42, weight: 0.4 },
  skin: { color: 0xb3b7bd, metal: 0.85, rough: 0.46, ghost: true },
  black: { color: 0x1b1d21, metal: 0.55, rough: 0.42 },
  substrate: { color: 0x1d2924, metal: 0.2, rough: 0.5, ghost: true },
  cell: { color: 0xffffff, metal: 0.3, rough: 0.3, ghost: true, coat: 1, map: true },
  hinge: { color: 0xb9bdc3, metal: 0.95, rough: 0.35, ghost: true },
  glass: { color: 0x080b14, metal: 0, rough: 0.04, coat: 1 },
  tape: { color: 0xd3c8a8, metal: 0.9, rough: 0.32 },
  antennaBase: { color: 0x202a26, metal: 0.2, rough: 0.55 },
  pcb: { color: 0x1d5a3b, metal: 0.05, rough: 0.6 },
  chip: { color: 0x141518, metal: 0.2, rough: 0.45 },
  gold: { color: 0xd4a54a, metal: 1, rough: 0.3 },
  copper: { color: 0xb9703f, metal: 1, rough: 0.36 },
  rotor: { color: 0xc9ccd2, metal: 1, rough: 0.22 },
  battery: { color: 0x3d5d57, metal: 0.15, rough: 0.45 },
};

export type CubeSatOptions = {
  /** Build the parts inside each unit (the breakdown only). */
  interior?: boolean;
  /** Add edge lines for the engineering-drawing look (the breakdown only). */
  edges?: boolean;
  /** Edge line colour. */
  ink?: string;
  /** Colour for tinted parts in the drawing look. */
  accent?: string;
  anisotropy?: number;
};

export type PointName = "lens" | "antenna" | "wheels" | "torquers" | "computer" | "array" | "arrayNormal" | "lensAhead" | "hinge";

export type CubeSat = {
  root: THREE.Group;
  /** Centre of each unit's contents: payload, ADCS, power and computer. */
  anchors: THREE.Object3D[];
  /** Named points that follow their parts, for labels and overlays. */
  points: Record<PointName, THREE.Object3D>;
  /** The front of the lens. */
  lensTip: THREE.Object3D;
  /** The outer ends of the four tape antennas. */
  antennaTips: THREE.Object3D[];
  /** Points on the silhouette when closed and deployed, for sizing on screen. */
  keypoints: THREE.Vector3[];
  /** 0 closed, 1 fully taken apart. */
  setExplode(e: number): void;
  /** 0 real materials, 1 engineering drawing. */
  setSchematic(s: number): void;
  /** 0 wings folded against the sides, 1 flat (the default). */
  setDeploy(d: number): void;
  /** Fades a set's skins (or the whole of the wings) toward 10% opacity. Drawing look only. */
  setGhost(set: SetIndex, g: number): void;
  /** Edge weight for a set in the drawing look, 0 to 1. Lower pushes it back. */
  setFocus(set: SetIndex, f: number): void;
  /** Tints parts toward the accent colour in the drawing look, 0 to 1. */
  setTint(set: SetIndex, roles: Role[], t: number): void;
  /** Turn the reaction wheels. */
  spin(dt: number): void;
  dispose(): void;
};

type Look = {
  mat: THREE.MeshStandardMaterial;
  spec: Spec;
  set: number;
  role: Role;
  paperColor: { value: THREE.Color };
  line: THREE.LineBasicMaterial | null;
  tint: number;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/** Joins geometries that share one material into one draw call. */
function merge(T: Three, geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new T.BufferGeometry();
  for (const [name, size] of [
    ["position", 3],
    ["normal", 3],
    ["uv", 2],
  ] as const) {
    const total = flat.reduce((n, g) => n + g.getAttribute(name).array.length, 0);
    const arr = new Float32Array(total);
    let offset = 0;
    for (const g of flat) {
      const a = g.getAttribute(name).array as Float32Array;
      arr.set(a, offset);
      offset += a.length;
    }
    out.setAttribute(name, new T.BufferAttribute(arr, size));
  }
  geos.forEach((g) => g.dispose());
  flat.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** A triple-junction cell on its substrate: cropped corners, fine fingers, one busbar. */
function cellTexture(T: Three, anisotropy: number): THREE.Texture {
  const W = 208;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#18241f";
  g.fillRect(0, 0, W, H);
  const m = 4;
  const cut = 20;
  g.beginPath();
  g.moveTo(m + cut, m);
  g.lineTo(W - m - cut, m);
  g.lineTo(W - m, m + cut);
  g.lineTo(W - m, H - m - cut);
  g.lineTo(W - m - cut, H - m);
  g.lineTo(m + cut, H - m);
  g.lineTo(m, H - m - cut);
  g.lineTo(m, m + cut);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#1b2c63");
  grad.addColorStop(0.5, "#13214e");
  grad.addColorStop(1, "#18295b");
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = "rgba(170, 185, 225, 0.22)";
  g.lineWidth = 1;
  for (let x = m + 4; x < W - m; x += 5) {
    g.beginPath();
    g.moveTo(x + 0.5, m);
    g.lineTo(x + 0.5, H - m);
    g.stroke();
  }
  g.restore();
  g.fillStyle = "#b9bec8";
  g.fillRect(m + cut, m, W - 2 * (m + cut), 6);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

export function buildCubeSat(T: Three, opts: CubeSatOptions = {}): CubeSat {
  const { interior = false, edges = false, ink = "#000000", accent = "#2540f5", anisotropy = 4 } = opts;
  const geometries = new Set<THREE.BufferGeometry>();
  const looks: Look[] = [];
  const paper = { value: 0 };
  const inkColor = new T.Color(ink);
  const accentColor = new T.Color(accent);
  const white = new T.Color(0xffffff);
  /** Paper colour for a fully tinted part: the accent, much lighter. */
  const tintFill = white.clone().lerp(accentColor, 0.2);
  const cellMap = cellTexture(T, anisotropy);

  const state = {
    schematic: 0,
    ghost: [0, 0, 0, 0],
    focus: [1, 1, 1, 1],
  };

  function makeLook(set: number, role: Role): Look {
    const spec = SPEC[role];
    const params: THREE.MeshPhysicalMaterialParameters = {
      color: spec.color,
      metalness: spec.metal,
      roughness: spec.rough,
    };
    if (spec.map) params.map = cellMap;
    let mat: THREE.MeshStandardMaterial;
    if (spec.coat) {
      params.clearcoat = spec.coat;
      params.clearcoatRoughness = role === "glass" ? 0.02 : 0.06;
      mat = new T.MeshPhysicalMaterial(params);
    } else {
      mat = new T.MeshStandardMaterial(params);
    }
    const look: Look = {
      mat,
      spec,
      set,
      role,
      paperColor: { value: white.clone() },
      line: null,
      tint: 0,
    };
    if (edges) {
      if (spec.ghost) mat.transparent = true;
      // Engineering-drawing mode mixes the surface colour (map included) toward paper.
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uPaper = paper;
        shader.uniforms.uPaperColor = look.paperColor;
        shader.fragmentShader =
          "uniform float uPaper;\nuniform vec3 uPaperColor;\n" +
          shader.fragmentShader.replace(
            "#include <map_fragment>",
            "#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, uPaperColor, uPaper);",
          );
      };
      mat.customProgramCacheKey = () => "cubesat-paper";
      // Edge lines draw on top of the faces they outline.
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = 1;
      mat.polygonOffsetUnits = 1;
      look.line = new T.LineBasicMaterial({
        color: ink,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
    }
    looks.push(look);
    return look;
  }

  const lookCache = new Map<string, Look>();
  function lookFor(set: number, role: Role): Look {
    const key = `${set}:${role}`;
    let look = lookCache.get(key);
    if (!look) {
      look = makeLook(set, role);
      lookCache.set(key, look);
    }
    return look;
  }

  function mesh(geo: THREE.BufferGeometry, set: number, role: Role) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    geometries.add(geo);
    const look = lookFor(set, role);
    const m = new T.Mesh(geo, look.mat);
    m.userData.role = role;
    if (look.line) {
      const eg = new T.EdgesGeometry(geo, 24);
      geometries.add(eg);
      const lines = new T.LineSegments(eg, look.line);
      lines.raycast = () => {};
      m.add(lines);
    }
    return m;
  }

  const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) =>
    new T.BoxGeometry(w, h, d).translate(x, y, z);
  /** A cylinder along Y. */
  const cyl = (r: number, h: number, x = 0, y = 0, z = 0, seg = 28) =>
    new T.CylinderGeometry(r, r, h, seg).translate(x, y, z);
  /** A cylinder along X or Z. */
  const rod = (r: number, len: number, axis: "x" | "z", x = 0, y = 0, z = 0) => {
    const g = new T.CylinderGeometry(r, r, len, 20);
    if (axis === "x") g.rotateZ(Math.PI / 2);
    else g.rotateX(Math.PI / 2);
    return g.translate(x, y, z);
  };
  const point = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const o = new T.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };

  const root = new T.Group();
  root.name = "cubesat";
  const body = new T.Group();
  root.add(body);

  type Mover = { obj: THREE.Object3D; base: THREE.Vector3; dir: THREE.Vector3; dist: number };
  const movers: Mover[] = [];
  const addMover = (obj: THREE.Object3D, dir: THREE.Vector3, dist: number) =>
    movers.push({ obj, base: obj.position.clone(), dir: dir.clone().normalize(), dist });

  const anchors: THREE.Object3D[] = [];
  const wheels: { rotor: THREE.Object3D; rate: number }[] = [];
  const interiors: THREE.Group[] = [];
  const hinges: { group: THREE.Group; side: number }[] = [];
  const points = {} as Record<PointName, THREE.Object3D>;
  const antennaTips: THREE.Object3D[] = [];
  let lensTip: THREE.Object3D = new T.Object3D();

  // A side panel facing +Z before it is turned to its face. The +Z face carries one cell;
  // the other three are plain plates.
  function sidePanel(set: number, cells: boolean): THREE.Group {
    const g = new T.Group();
    const z = HALF - PANEL_T / 2 - 0.0004;
    if (cells) {
      g.add(mesh(box(2 * INNER - 0.001, UNIT - 0.003, PANEL_T, 0, 0, z), set, "substrate"));
      g.add(mesh(new T.PlaneGeometry(CELL_W, CELL_H).translate(0, 0, z + PANEL_T / 2 + 0.0002), set, "cell"));
    } else {
      g.add(mesh(box(2 * INNER - 0.001, UNIT - 0.003, PANEL_T, 0, 0, z), set, "skin"));
    }
    return g;
  }

  const faces: { dir: THREE.Vector3; rotY: number; cells: boolean }[] = [
    { dir: new T.Vector3(0, 0, 1), rotY: 0, cells: true },
    { dir: new T.Vector3(1, 0, 0), rotY: Math.PI / 2, cells: false },
    { dir: new T.Vector3(0, 0, -1), rotY: Math.PI, cells: false },
    { dir: new T.Vector3(-1, 0, 0), rotY: -Math.PI / 2, cells: false },
  ];

  const foot = 0.004;
  for (let i = 0; i < 3; i++) {
    const unit = new T.Group();
    unit.name = ["payload", "adcs", "power"][i];
    unit.position.y = (i - 1) * UNIT;
    body.add(unit);
    addMover(unit, new T.Vector3(0, 1, 0), (i - 1) * SEPARATION);

    // Rails (with feet on the outer ends) and the frame bars that tie them together.
    const lo = -UNIT / 2 - (i === 0 ? foot : 0);
    const hi = UNIT / 2 + (i === 2 ? foot : 0);
    const r = HALF - RAIL / 2;
    const frame: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) frame.push(box(RAIL, hi - lo - 0.0006, RAIL, sx * r, (lo + hi) / 2, sz * r));
    const fz = HALF - PANEL_T - 0.0035;
    for (const y of [-UNIT / 2 + 0.0025, UNIT / 2 - 0.0025]) {
      for (const s of [-1, 1]) {
        frame.push(box(2 * INNER, 0.004, 0.003, 0, y, s * fz));
        frame.push(box(0.003, 0.004, 2 * INNER, s * fz, y, 0));
      }
    }
    unit.add(mesh(merge(T, frame), i, "alu"));

    // Four side panels; each lifts straight out along its face normal.
    for (const f of faces) {
      const lift = new T.Group();
      const p = sidePanel(i, f.cells);
      p.rotation.y = f.rotY;
      lift.add(p);
      unit.add(lift);
      addMover(lift, f.dir, LIFT);
      if (i === 1 && f.cells) {
        points.array = point(lift, 0, 0, HALF);
        points.arrayNormal = point(lift, 0, 0, HALF + 0.2);
      }
    }

    const anchor = new T.Object3D();
    unit.add(anchor);
    anchors.push(anchor);

    if (i === 0) {
      // Earth-facing end plate with the lens.
      const end = new T.Group();
      end.add(mesh(box(2 * INNER, 0.002, 2 * INNER, 0, -UNIT / 2 + 0.001, 0), i, "plate"));
      const lensParts = [cyl(0.019, 0.012, 0, -UNIT / 2 - 0.006, 0), cyl(0.0205, 0.003, 0, -UNIT / 2 - 0.011, 0)];
      end.add(mesh(merge(T, lensParts), i, "black"));
      end.add(mesh(cyl(0.0152, 0.0012, 0, -UNIT / 2 - 0.0126, 0, 32), i, "glass"));
      lensTip = point(end, 0, -UNIT / 2 - 0.013, 0);
      points.lens = lensTip;
      points.lensAhead = point(end, 0, -UNIT / 2 - 0.4, 0);
      unit.add(end);
      addMover(end, new T.Vector3(0, -1, 0), LIFT * 0.7);
    }

    if (i === 1) {
      points.wheels = point(unit, 0, -UNIT / 2 + 0.032, 0);
      points.torquers = point(unit, 0.033, 0.042, 0);
    }

    if (i === 2) {
      points.computer = point(unit, 0, -UNIT / 2 + 0.062, 0);
      // Top plate with the antenna module and four tape antennas in a turnstile.
      const end = new T.Group();
      end.add(mesh(box(2 * INNER, 0.002, 2 * INNER, 0, UNIT / 2 - 0.001, 0), i, "plate"));
      end.add(mesh(box(0.094, 0.006, 0.094, 0, UNIT / 2 + 0.003 + foot, 0), i, "antennaBase"));
      const tapes: THREE.BufferGeometry[] = [];
      for (const [sx, sz] of [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ]) {
        const g = new T.BoxGeometry(ANTENNA, 0.005, 0.0004);
        g.translate(ANTENNA / 2, 0, 0);
        g.rotateY(-Math.atan2(sz, sx));
        g.translate(sx * 0.045, UNIT / 2 + 0.003 + foot, sz * 0.045);
        tapes.push(g);
      }
      end.add(mesh(merge(T, tapes), i, "tape"));
      for (const [sx, sz] of [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ]) {
        const r = 0.045 * Math.SQRT2 + ANTENNA;
        const a = Math.atan2(sz, sx);
        antennaTips.push(point(end, Math.cos(a) * r, UNIT / 2 + 0.003 + foot, Math.sin(a) * r));
      }
      points.antenna = point(end, 0, UNIT / 2 + 0.006 + foot, 0);
      unit.add(end);
      addMover(end, new T.Vector3(0, 1, 0), LIFT * 0.7);
    }

    if (interior) {
      const inside = new T.Group();
      inside.visible = false;
      unit.add(inside);
      interiors.push(inside);
      if (i === 0) buildPayload(inside, i);
      if (i === 1) buildAdcs(inside, i);
      if (i === 2) buildPower(inside, i);
    }
  }

  // The wings: one 1U by 3U panel on each long edge of the +Z face, one cell per unit, cells
  // facing +Z when flat. The hinge line runs along Y just outside the body's corner.
  const W = SET.wings;
  for (const s of [-1, 1]) {
    const lift = new T.Group();
    const hinge = new T.Group();
    hinge.position.set(s * (HALF + HINGE_OUT), 0, HALF);
    const cx = s * (WING_GAP + WING_W / 2);
    hinge.add(mesh(box(WING_W, WING_H, PANEL_T, cx, 0, -PANEL_T / 2), W, "substrate"));
    hinge.add(
      mesh(
        merge(
          T,
          [-1, 0, 1].map((k) => new T.PlaneGeometry(CELL_W, CELL_H).translate(cx, k * UNIT, 0.0002)),
        ),
        W,
        "cell",
      ),
    );
    hinge.add(
      mesh(
        merge(
          T,
          [-0.12, 0, 0.12].map((y) => box(0.006, 0.016, 0.004, s * 0.0008, y, -0.0012)),
        ),
        W,
        "hinge",
      ),
    );
    if (s === 1) points.hinge = point(hinge, 0, 0.12, 0);
    lift.add(hinge);
    body.add(lift);
    hinges.push({ group: hinge, side: s });
    addMover(lift, new T.Vector3(s * 0.75, 0, 1), LIFT * 1.6);
  }

  function buildPayload(g: THREE.Group, set: number) {
    // Camera: a lens barrel with two rings, and the sensor board behind it.
    const y0 = -UNIT / 2;
    g.add(mesh(merge(T, [cyl(0.0185, 0.05, 0, y0 + 0.027, 0), cyl(0.021, 0.005, 0, y0 + 0.014, 0), cyl(0.021, 0.005, 0, y0 + 0.036, 0)]), set, "black"));
    const board = y0 + 0.058;
    g.add(mesh(box(0.08, 0.0016, 0.08, 0, board, 0), set, "pcb"));
    g.add(mesh(box(0.024, 0.003, 0.024, 0, board - 0.0023, 0), set, "chip"));
    g.add(
      mesh(
        merge(T, [box(0.012, 0.002, 0.016, 0.022, board + 0.0018, -0.018), box(0.016, 0.002, 0.01, -0.02, board + 0.0018, 0.02), box(0.008, 0.002, 0.008, 0.024, board + 0.0018, 0.022)]),
        set,
        "chip",
      ),
    );
    g.add(mesh(box(0.05, 0.005, 0.007, 0, board + 0.0034, -0.033), set, "gold"));
    // Standoffs from the end plate to the board.
    g.add(mesh(merge(T, [-1, 1].flatMap((sx) => [-1, 1].map((sz) => cyl(0.0022, 0.056, sx * 0.034, y0 + 0.029, sz * 0.034, 10)))), set, "alu"));
  }

  function buildAdcs(g: THREE.Group, set: number) {
    const y0 = -UNIT / 2;
    g.add(mesh(box(0.08, 0.0016, 0.08, 0, y0 + 0.008, 0), set, "pcb"));
    // Four reaction wheels in a pyramid: axes tilted 35 degrees out from the long axis.
    const tilt = (35 * Math.PI) / 180;
    const rates = [1.3, -1.0, 1.6, -1.2];
    for (let k = 0; k < 4; k++) {
      const az = Math.PI / 4 + (k * Math.PI) / 2;
      const axis = new T.Vector3(Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt));
      const wheel = new T.Group();
      wheel.position.set(Math.cos(az) * 0.024, y0 + 0.032, Math.sin(az) * 0.024);
      wheel.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis);
      wheel.add(mesh(cyl(0.0125, 0.011, 0, -0.008, 0), set, "black"));
      const rotor = new T.Group();
      rotor.add(mesh(cyl(0.0165, 0.006, 0, 0.0005, 0, 36), set, "rotor"));
      rotor.add(mesh(cyl(0.0045, 0.0075, 0, 0.0005, 0, 16), set, "black"));
      rotor.add(mesh(box(0.006, 0.0068, 0.0035, 0.0125, 0.0005, 0), set, "gold"));
      wheel.add(rotor);
      wheels.push({ rotor, rate: rates[k] * Math.PI * 2 });
      g.add(wheel);
    }
    // Three magnetorquer rods on the x, y and z axes, with dark end caps.
    const L = 0.05;
    g.add(mesh(merge(T, [rod(0.0045, L, "x", 0, 0.042, -0.033), rod(0.0045, L, "z", 0.033, 0.042, 0), cyl(0.0045, L, 0, 0.004, 0, 20)]), set, "copper"));
    g.add(
      mesh(
        merge(T, [
          rod(0.0052, 0.004, "x", -L / 2, 0.042, -0.033),
          rod(0.0052, 0.004, "x", L / 2, 0.042, -0.033),
          rod(0.0052, 0.004, "z", 0.033, 0.042, -L / 2),
          rod(0.0052, 0.004, "z", 0.033, 0.042, L / 2),
          cyl(0.0052, 0.004, 0, 0.004 - L / 2, 0, 20),
          cyl(0.0052, 0.004, 0, 0.004 + L / 2, 0, 20),
        ]),
        set,
        "black",
      ),
    );
  }

  function buildPower(g: THREE.Group, set: number) {
    const y0 = -UNIT / 2;
    // Battery pack: four cells lying across the unit on a holder board.
    g.add(mesh(box(0.08, 0.0016, 0.08, 0, y0 + 0.006, 0), set, "pcb"));
    g.add(mesh(merge(T, [-0.0285, -0.0095, 0.0095, 0.0285].map((z) => rod(0.0088, 0.064, "x", 0, y0 + 0.0158, z))), set, "battery"));
    g.add(
      mesh(
        merge(T, [-0.0285, -0.0095, 0.0095, 0.0285].flatMap((z) => [rod(0.0089, 0.003, "x", -0.0335, y0 + 0.0158, z), rod(0.0089, 0.003, "x", 0.0335, y0 + 0.0158, z)])),
        set,
        "alu",
      ),
    );
    // A stack of three boards on standoffs.
    const ys = [y0 + 0.042, y0 + 0.062, y0 + 0.082];
    g.add(mesh(merge(T, ys.map((y) => box(0.08, 0.0016, 0.08, 0, y, 0))), set, "pcb"));
    g.add(
      mesh(
        merge(
          T,
          ys.flatMap((y, n) => [
            box(0.018, 0.0024, 0.018, -0.012 + n * 0.008, y + 0.002, 0.008),
            box(0.01, 0.002, 0.014, 0.022, y + 0.0018, -0.016 + n * 0.006),
            box(0.008, 0.002, 0.006, -0.026, y + 0.0018, -0.022),
          ]),
        ),
        set,
        "chip",
      ),
    );
    g.add(mesh(merge(T, ys.map((y) => box(0.054, 0.006, 0.006, 0, y + 0.0038, 0.033))), set, "gold"));
    g.add(mesh(merge(T, [-1, 1].flatMap((sx) => [-1, 1].map((sz) => cyl(0.0022, 0.05, sx * 0.034, y0 + 0.062, sz * 0.034, 10)))), set, "alu"));
  }

  // Silhouette points when closed and deployed.
  const keypoints: THREE.Vector3[] = [];
  const reach = HALF + HINGE_OUT + WING_GAP + WING_W;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) keypoints.push(new T.Vector3(sx * reach, (sy * WING_H) / 2, HALF));
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) keypoints.push(new T.Vector3(sx * HALF, sy * (1.5 * UNIT + 0.004), sz * HALF));
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ]) {
    const d = (ANTENNA + 0.064) / Math.SQRT2;
    keypoints.push(new T.Vector3(sx * d, 1.5 * UNIT + 0.007, sz * d));
  }
  keypoints.push(new T.Vector3(0, -1.5 * UNIT - 0.013, 0));

  function refresh() {
    const s = state.schematic;
    paper.value = s;
    for (const l of looks) {
      const { mat, spec } = l;
      mat.metalness = spec.metal * (1 - s);
      mat.roughness = spec.rough + (0.85 - spec.rough) * s;
      mat.envMapIntensity = 1 - 0.75 * s;
      // Stay above zero, so the clear-coat shader variant never has to recompile.
      if (spec.coat) (mat as THREE.MeshPhysicalMaterial).clearcoat = Math.max(0.001, spec.coat * (1 - s));
      if (!edges) continue;
      l.paperColor.value.copy(white).lerp(tintFill, l.tint);
      const ghost = spec.ghost ? state.ghost[l.set] : 0;
      if (spec.ghost) {
        mat.opacity = 1 - 0.9 * smooth(ghost);
        mat.depthWrite = mat.opacity > 0.98;
      }
      const weight = spec.weight ?? 0.85;
      const base = spec.ghost ? weight + (0.22 - weight) * ghost : weight;
      const line = l.line!;
      line.color.copy(inkColor).lerp(accentColor, l.tint);
      line.opacity = s * (base * state.focus[l.set] * (1 - l.tint) + l.tint);
    }
  }

  let explodeNow = -1;
  function setExplode(e: number) {
    e = clamp01(e);
    if (e === explodeNow) return;
    explodeNow = e;
    for (const m of movers) m.obj.position.copy(m.base).addScaledVector(m.dir, m.dist * e);
    for (const g of interiors) g.visible = e > 0.004;
  }

  let deployNow = -1;
  function setDeploy(d: number) {
    d = clamp01(d);
    if (d === deployNow) return;
    deployNow = d;
    const fold = (Math.PI / 2) * (1 - smooth(d));
    for (const h of hinges) h.group.rotation.y = h.side * fold;
  }

  function spin(dt: number) {
    for (const w of wheels) w.rotor.rotation.y += w.rate * dt;
  }

  function dispose() {
    geometries.forEach((g) => g.dispose());
    looks.forEach((l) => {
      l.mat.dispose();
      l.line?.dispose();
    });
    cellMap.dispose();
  }

  setExplode(0);
  setDeploy(1);
  refresh();

  return {
    root,
    anchors,
    points,
    lensTip,
    antennaTips,
    keypoints,
    setExplode,
    setSchematic(s) {
      s = clamp01(s);
      if (s === state.schematic) return;
      state.schematic = s;
      refresh();
    },
    setDeploy,
    setGhost(set, g) {
      g = clamp01(g);
      if (g === state.ghost[set]) return;
      state.ghost[set] = g;
      refresh();
    },
    setFocus(set, f) {
      f = clamp01(f);
      if (f === state.focus[set]) return;
      state.focus[set] = f;
      refresh();
    },
    setTint(set, roles, t) {
      t = clamp01(t);
      let changed = false;
      for (const l of looks) {
        if (l.set === set && roles.includes(l.role) && l.tint !== t) {
          l.tint = t;
          changed = true;
        }
      }
      if (changed) refresh();
    },
    spin,
    dispose,
  };
}
