import type * as THREE from "three";

/*
  A 3U CubeSat built from three.js primitives, shared by the orbit intro and the
  take-it-apart viewer. Units are metres. The long axis is +Y; the camera lens sits on the
  -Y end (the end that faces Earth) and the antennas on the +Y end.

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
/** The deployed wings: two hinged panels each, coplanar with the +Z face. */
const WING_W = 0.19;
const WING_H = 0.31;
const WING_GAP = 0.004;
/** The wings sweep back from the cell face by this much, in radians. */
const WING_CANT = 0.26;
const ANTENNA = 0.17;

/** How far apart the units move when fully taken apart, and how far the skins lift. */
const SEPARATION = 0.15;
const LIFT = 0.07;

export type CubeSatOptions = {
  /** Build the parts inside each unit (the viewer only). */
  interior?: boolean;
  /** Add edge lines for the engineering-drawing look (the viewer only). */
  edges?: boolean;
  /** Edge line colour. */
  ink?: string;
  anisotropy?: number;
};

export type CubeSat = {
  root: THREE.Group;
  /** Centre of each unit's contents, for labels: payload, ADCS, power and computer. */
  anchors: THREE.Object3D[];
  /** The front of the lens. */
  lensTip: THREE.Object3D;
  /** Points on the silhouette in the closed state, for sizing on screen. */
  keypoints: THREE.Vector3[];
  /** Every material, so a scene can brighten them on hover. */
  materials: THREE.MeshStandardMaterial[];
  /** 0 closed, 1 fully taken apart. */
  setExplode(e: number): void;
  /** 0 real materials, 1 engineering drawing. */
  setSchematic(s: number): void;
  /** Turn the reaction wheels. */
  spin(dt: number): void;
  dispose(): void;
};

type Look = {
  mat: THREE.MeshStandardMaterial;
  color: THREE.Color;
  metal: number;
  rough: number;
  coat: number;
  env: number;
  ghost: boolean;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
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
  return out;
}

/** A triple-junction cell on its substrate: cropped corners, fine fingers, one busbar. */
function cellTexture(T: Three, anisotropy: number): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#18241f";
  g.fillRect(0, 0, 128, 256);
  const m = 5;
  const cut = 14;
  g.beginPath();
  g.moveTo(m + cut, m);
  g.lineTo(128 - m - cut, m);
  g.lineTo(128 - m, m + cut);
  g.lineTo(128 - m, 256 - m - cut);
  g.lineTo(128 - m - cut, 256 - m);
  g.lineTo(m + cut, 256 - m);
  g.lineTo(m, 256 - m - cut);
  g.lineTo(m, m + cut);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 128, 256);
  grad.addColorStop(0, "#1b2c63");
  grad.addColorStop(0.5, "#13214e");
  grad.addColorStop(1, "#18295b");
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = "rgba(170, 185, 225, 0.22)";
  g.lineWidth = 1;
  for (let x = m + 4; x < 128 - m; x += 5) {
    g.beginPath();
    g.moveTo(x + 0.5, m);
    g.lineTo(x + 0.5, 256 - m);
    g.stroke();
  }
  g.restore();
  g.fillStyle = "#b9bec8";
  g.fillRect(m + cut, m, 128 - 2 * (m + cut), 5);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

export function buildCubeSat(T: Three, opts: CubeSatOptions = {}): CubeSat {
  const { interior = false, edges = false, ink = "#000000", anisotropy = 4 } = opts;
  const geometries = new Set<THREE.BufferGeometry>();
  const looks: Look[] = [];
  const paper = { value: 0 };
  const paperColor = { value: new T.Color(0xffffff) };

  function patch(mat: THREE.MeshStandardMaterial) {
    if (!edges) return;
    // Engineering-drawing mode mixes the surface colour (map included) toward paper white.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uPaper = paper;
      shader.uniforms.uPaperColor = paperColor;
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
  }

  function std(
    color: number,
    metal: number,
    rough: number,
    ghost = false,
    extra: Partial<THREE.MeshPhysicalMaterialParameters> = {},
    physical = false,
  ) {
    const params = { color, metalness: metal, roughness: rough, ...extra };
    const mat = physical ? new T.MeshPhysicalMaterial(params) : new T.MeshStandardMaterial(params);
    if (ghost && edges) mat.transparent = true;
    patch(mat);
    looks.push({
      mat,
      color: mat.color.clone(),
      metal,
      rough,
      coat: (mat as THREE.MeshPhysicalMaterial).clearcoat ?? 0,
      env: 1,
      ghost: ghost && edges,
    });
    return mat;
  }

  const cellMap = cellTexture(T, anisotropy);
  const M = {
    alu: std(0xc3c7cd, 0.95, 0.32),
    aluPlate: std(0xb4b8be, 0.9, 0.42),
    black: std(0x1b1d21, 0.55, 0.42),
    substrate: std(0x1d2924, 0.2, 0.5, true),
    cell: std(0xffffff, 0.3, 0.3, true, { map: cellMap, clearcoat: 1, clearcoatRoughness: 0.06 }, true),
    wingBack: std(0x8a6d36, 0.55, 0.5, true),
    hinge: std(0xb9bdc3, 0.95, 0.35, true),
    glass: std(0x080b14, 0.0, 0.04, false, { clearcoat: 1, clearcoatRoughness: 0.02 }, true),
    tape: std(0xd3c8a8, 0.9, 0.32),
    antennaBase: std(0x202a26, 0.2, 0.55),
    pcb: std(0x1d5a3b, 0.05, 0.6),
    chip: std(0x141518, 0.2, 0.45),
    gold: std(0xd4a54a, 1.0, 0.3),
    copper: std(0xb9703f, 1.0, 0.36),
    rotor: std(0xc9ccd2, 1.0, 0.22),
    battery: std(0x3d5d57, 0.15, 0.45),
  };

  // Three line weights for the drawing: parts inside, the frame, and the lifted skins.
  const edgeSolid = new T.LineBasicMaterial({ color: ink, transparent: true, opacity: 0, depthWrite: false });
  const edgeFrame = new T.LineBasicMaterial({ color: ink, transparent: true, opacity: 0, depthWrite: false });
  const edgeGhost = new T.LineBasicMaterial({ color: ink, transparent: true, opacity: 0, depthWrite: false });

  function mesh(geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial) {
    geometries.add(geo);
    const m = new T.Mesh(geo, mat);
    if (edges) {
      const eg = new T.EdgesGeometry(geo, 24);
      geometries.add(eg);
      const look = looks.find((l) => l.mat === mat);
      const frame = mat === M.alu || mat === M.aluPlate;
      const lines = new T.LineSegments(eg, look?.ghost ? edgeGhost : frame ? edgeFrame : edgeSolid);
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
  let lensTip: THREE.Object3D = new T.Object3D();

  // A body panel facing +Z before it is turned to its face: substrate and two cells.
  function bodyPanel(): THREE.Group {
    const g = new T.Group();
    const z = HALF - PANEL_T / 2 - 0.0004;
    g.add(mesh(box(2 * INNER - 0.001, UNIT - 0.003, PANEL_T, 0, 0, z), M.substrate));
    const cw = 0.0385;
    const ch = 0.082;
    const cells = merge(T, [
      new T.PlaneGeometry(cw, ch).translate(-cw / 2 - 0.001, 0, z + PANEL_T / 2 + 0.0002),
      new T.PlaneGeometry(cw, ch).translate(cw / 2 + 0.001, 0, z + PANEL_T / 2 + 0.0002),
    ]);
    g.add(mesh(cells, M.cell));
    return g;
  }

  const faces: { dir: THREE.Vector3; rotY: number }[] = [
    { dir: new T.Vector3(0, 0, 1), rotY: 0 },
    { dir: new T.Vector3(1, 0, 0), rotY: Math.PI / 2 },
    { dir: new T.Vector3(0, 0, -1), rotY: Math.PI },
    { dir: new T.Vector3(-1, 0, 0), rotY: -Math.PI / 2 },
  ];

  for (let i = 0; i < 3; i++) {
    const unit = new T.Group();
    unit.name = ["payload", "adcs", "power"][i];
    unit.position.y = (i - 1) * UNIT;
    body.add(unit);
    addMover(unit, new T.Vector3(0, 1, 0), (i - 1) * SEPARATION);

    // Rails (with feet on the outer ends) and the frame bars that tie them together.
    const foot = 0.004;
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
    unit.add(mesh(merge(T, frame), M.alu));

    // Four body panels; each lifts straight out along its face normal.
    for (const f of faces) {
      const lift = new T.Group();
      const p = bodyPanel();
      p.rotation.y = f.rotY;
      lift.add(p);
      unit.add(lift);
      addMover(lift, f.dir, LIFT);
    }

    const anchor = new T.Object3D();
    unit.add(anchor);
    anchors.push(anchor);

    if (i === 0) {
      // Earth-facing end plate with the lens.
      const end = new T.Group();
      end.add(mesh(box(2 * INNER, 0.002, 2 * INNER, 0, -UNIT / 2 + 0.001, 0), M.aluPlate));
      const lensParts = [cyl(0.019, 0.012, 0, -UNIT / 2 - 0.006, 0), cyl(0.0205, 0.003, 0, -UNIT / 2 - 0.011, 0)];
      end.add(mesh(merge(T, lensParts), M.black));
      end.add(mesh(cyl(0.0152, 0.0012, 0, -UNIT / 2 - 0.0126, 0, 32), M.glass));
      lensTip = new T.Object3D();
      lensTip.position.set(0, -UNIT / 2 - 0.013, 0);
      end.add(lensTip);
      unit.add(end);
      addMover(end, new T.Vector3(0, -1, 0), LIFT * 0.7);
    }

    if (i === 2) {
      // Top plate with the antenna module and four tape antennas in a turnstile.
      const end = new T.Group();
      end.add(mesh(box(2 * INNER, 0.002, 2 * INNER, 0, UNIT / 2 - 0.001, 0), M.aluPlate));
      end.add(mesh(box(0.094, 0.006, 0.094, 0, UNIT / 2 + 0.003 + foot, 0), M.antennaBase));
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
      end.add(mesh(merge(T, tapes), M.tape));
      unit.add(end);
      addMover(end, new T.Vector3(0, 1, 0), LIFT * 0.7);
    }

    if (interior) {
      const inside = new T.Group();
      inside.visible = false;
      unit.add(inside);
      interiors.push(inside);
      if (i === 0) buildPayload(inside);
      if (i === 1) buildAdcs(inside);
      if (i === 2) buildPower(inside);
    }
  }

  // Deployed wings: hinged on the long edges of the +Z face, swung out nearly flat and swept
  // back a little. Cells face +Z; the back is gold kapton.
  for (const s of [-1, 1]) {
    const lift = new T.Group();
    const wing = new T.Group();
    const z = HALF - PANEL_T / 2 - 0.0004;
    const sub = (WING_W - WING_GAP) / 2;
    const backs: THREE.BufferGeometry[] = [];
    const cells: THREE.BufferGeometry[] = [];
    const hinges: THREE.BufferGeometry[] = [];
    const cw = 0.04;
    const ch = 0.083;
    for (let k = 0; k < 2; k++) {
      const cx = s * (HALF + WING_GAP + sub / 2 + k * (sub + WING_GAP));
      backs.push(box(sub, WING_H, PANEL_T, cx, 0, z));
      for (const ox of [-1, 1])
        for (const oy of [-1, 0, 1])
          cells.push(
            new T.PlaneGeometry(cw, ch).translate(cx + ox * (cw / 2 + 0.0012), oy * (ch + 0.012), z + PANEL_T / 2 + 0.0002),
          );
      const hx = s * (HALF + WING_GAP / 2 + k * (sub + WING_GAP));
      for (const hy of [-0.11, 0, 0.11]) hinges.push(box(0.006, 0.014, 0.004, hx, hy, z));
    }
    wing.add(mesh(merge(T, backs), M.substrate));
    wing.add(mesh(merge(T, cells), M.cell));
    wing.add(mesh(merge(T, hinges), M.hinge));
    // Gold kapton on the back.
    const back = merge(
      T,
      [0, 1].map((k) =>
        new T.PlaneGeometry(sub - 0.002, WING_H - 0.002)
          .rotateY(Math.PI)
          .translate(s * (HALF + WING_GAP + sub / 2 + k * (sub + WING_GAP)), 0, z - PANEL_T / 2 - 0.0002),
      ),
    );
    wing.add(mesh(back, M.wingBack));
    const hinge = new T.Group();
    hinge.position.set(s * HALF, 0, HALF);
    hinge.rotation.y = s * WING_CANT;
    wing.position.set(-s * HALF, 0, -HALF);
    hinge.add(wing);
    lift.add(hinge);
    body.add(lift);
    addMover(lift, new T.Vector3(s * 0.75, 0, 1), LIFT * 1.6);
  }

  function buildPayload(g: THREE.Group) {
    // Camera: a lens barrel with two rings, and the sensor board behind it.
    const y0 = -UNIT / 2;
    g.add(mesh(merge(T, [cyl(0.0185, 0.05, 0, y0 + 0.027, 0), cyl(0.021, 0.005, 0, y0 + 0.014, 0), cyl(0.021, 0.005, 0, y0 + 0.036, 0)]), M.black));
    const board = y0 + 0.058;
    g.add(mesh(box(0.08, 0.0016, 0.08, 0, board, 0), M.pcb));
    g.add(mesh(box(0.024, 0.003, 0.024, 0, board - 0.0023, 0), M.chip));
    g.add(
      mesh(
        merge(T, [box(0.012, 0.002, 0.016, 0.022, board + 0.0018, -0.018), box(0.016, 0.002, 0.01, -0.02, board + 0.0018, 0.02), box(0.008, 0.002, 0.008, 0.024, board + 0.0018, 0.022)]),
        M.chip,
      ),
    );
    g.add(mesh(box(0.05, 0.005, 0.007, 0, board + 0.0034, -0.033), M.gold));
    // Standoffs from the end plate to the board.
    g.add(mesh(merge(T, [-1, 1].flatMap((sx) => [-1, 1].map((sz) => cyl(0.0022, 0.056, sx * 0.034, y0 + 0.029, sz * 0.034, 10)))), M.alu));
  }

  function buildAdcs(g: THREE.Group) {
    const y0 = -UNIT / 2;
    g.add(mesh(box(0.08, 0.0016, 0.08, 0, y0 + 0.008, 0), M.pcb));
    // Four reaction wheels in a pyramid: axes tilted 35 degrees out from the long axis.
    const tilt = (35 * Math.PI) / 180;
    const rates = [1.3, -1.0, 1.6, -1.2];
    for (let k = 0; k < 4; k++) {
      const az = Math.PI / 4 + (k * Math.PI) / 2;
      const axis = new T.Vector3(Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt));
      const wheel = new T.Group();
      wheel.position.set(Math.cos(az) * 0.024, y0 + 0.032, Math.sin(az) * 0.024);
      wheel.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis);
      wheel.add(mesh(cyl(0.0125, 0.011, 0, -0.008, 0), M.black));
      const rotor = new T.Group();
      rotor.add(mesh(cyl(0.0165, 0.006, 0, 0.0005, 0, 36), M.rotor));
      rotor.add(mesh(cyl(0.0045, 0.0075, 0, 0.0005, 0, 16), M.black));
      rotor.add(mesh(box(0.006, 0.0068, 0.0035, 0.0125, 0.0005, 0), M.gold));
      wheel.add(rotor);
      wheels.push({ rotor, rate: rates[k] * Math.PI * 2 });
      g.add(wheel);
    }
    // Three magnetorquer rods on the x, y and z axes, with dark end caps.
    const L = 0.05;
    g.add(mesh(merge(T, [rod(0.0045, L, "x", 0, 0.042, -0.033), rod(0.0045, L, "z", 0.033, 0.042, 0), cyl(0.0045, L, 0, 0.004, 0, 20)]), M.copper));
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
        M.black,
      ),
    );
  }

  function buildPower(g: THREE.Group) {
    const y0 = -UNIT / 2;
    // Battery pack: four cells lying across the unit on a holder board.
    g.add(mesh(box(0.08, 0.0016, 0.08, 0, y0 + 0.006, 0), M.pcb));
    g.add(mesh(merge(T, [-0.0285, -0.0095, 0.0095, 0.0285].map((z) => rod(0.0088, 0.064, "x", 0, y0 + 0.0158, z))), M.battery));
    g.add(
      mesh(
        merge(T, [-0.0285, -0.0095, 0.0095, 0.0285].flatMap((z) => [rod(0.0089, 0.003, "x", -0.0335, y0 + 0.0158, z), rod(0.0089, 0.003, "x", 0.0335, y0 + 0.0158, z)])),
        M.alu,
      ),
    );
    // A stack of three boards on standoffs: power, flight computer, radio.
    const ys = [y0 + 0.042, y0 + 0.062, y0 + 0.082];
    g.add(mesh(merge(T, ys.map((y) => box(0.08, 0.0016, 0.08, 0, y, 0))), M.pcb));
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
        M.chip,
      ),
    );
    g.add(mesh(merge(T, ys.map((y) => box(0.054, 0.006, 0.006, 0, y + 0.0038, 0.033))), M.gold));
    g.add(mesh(merge(T, [-1, 1].flatMap((sx) => [-1, 1].map((sz) => cyl(0.0022, 0.05, sx * 0.034, y0 + 0.062, sz * 0.034, 10)))), M.alu));
  }

  // Silhouette points in the closed state.
  const keypoints: THREE.Vector3[] = [];
  const wingReach = WING_GAP * 2 + WING_W;
  const up = new T.Vector3(0, 1, 0);
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      keypoints.push(
        new T.Vector3(sx * wingReach, (sy * WING_H) / 2, 0).applyAxisAngle(up, sx * WING_CANT).add(new T.Vector3(sx * HALF, 0, HALF)),
      );
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

  let explodeNow = -1;
  function setExplode(e: number) {
    e = clamp01(e);
    if (e === explodeNow) return;
    explodeNow = e;
    for (const m of movers) m.obj.position.copy(m.base).addScaledVector(m.dir, m.dist * e);
    for (const g of interiors) g.visible = e > 0.004;
  }

  let schematicNow = -1;
  function setSchematic(s: number) {
    s = clamp01(s);
    if (s === schematicNow) return;
    schematicNow = s;
    paper.value = s;
    for (const l of looks) {
      l.mat.metalness = l.metal + (0 - l.metal) * s;
      l.mat.roughness = l.rough + (0.85 - l.rough) * s;
      l.mat.envMapIntensity = 1 - 0.75 * s;
      const phys = l.mat as THREE.MeshPhysicalMaterial;
      // Stay above zero, so the clear-coat shader variant never has to recompile.
      if (l.coat > 0) phys.clearcoat = Math.max(0.001, l.coat * (1 - s));
      if (l.ghost) {
        l.mat.opacity = 1 - 0.9 * smooth(0.25, 1, s);
        l.mat.depthWrite = l.mat.opacity > 0.98;
      }
    }
    edgeSolid.opacity = 0.85 * s;
    edgeFrame.opacity = 0.4 * s;
    edgeGhost.opacity = 0.22 * s;
  }

  function spin(dt: number) {
    for (const w of wheels) w.rotor.rotation.y += w.rate * dt;
  }

  function dispose() {
    geometries.forEach((g) => g.dispose());
    looks.forEach((l) => l.mat.dispose());
    edgeSolid.dispose();
    edgeFrame.dispose();
    edgeGhost.dispose();
    cellMap.dispose();
  }

  setExplode(0);
  if (edges) setSchematic(0);

  return {
    root,
    anchors,
    lensTip,
    keypoints,
    materials: looks.map((l) => l.mat),
    setExplode,
    setSchematic,
    spin,
    dispose,
  };
}
