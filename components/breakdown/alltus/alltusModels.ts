import type * as THREE from "three";
import { lerp, paperMaterial, type Palette } from "@/components/breakdown/kit";

/*
  Low-poly parts for the Alltus breakdown: a resident with a phone, a house, the county
  office, the call router, the rack of voice agents and the three things an agent reads
  from. Everything is built from a few primitives with flat shading and ink edges, like
  the rest of the breakdown family.

  A Part is a group whose pieces share materials, so the scene can tint it blue, fade it
  toward the page, or raise it out of the ground with one call. Builders take an `add`
  function, so the same office and houses can be built live or baked into one geometry
  for the repeated tiles in the last step.
*/

type Three = typeof THREE;
export type V3 = [number, number, number];
/** Fill shades: the three pale fills from the palette, then white. */
export type Shade = 0 | 1 | 2 | 3;
export type Add = (geo: THREE.BufferGeometry, shade: Shade, pos?: V3, rot?: V3, scale?: V3) => void;

export type Part = {
  group: THREE.Group;
  add: Add;
  /** 0 to 1: toward the site blue. */
  tint: number;
  /** 0 to 1: toward the page, for parts out of focus. */
  dim: number;
  /** 0 to 1: grown up out of the ground. 0 hides it. */
  rise: number;
  update(): void;
};

/** Overshoots a little past 1 before settling, so parts pop up out of the ground. */
const easeOutBack = (t: number) => {
  const c = 1.4;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

export function createShop(T: Three, palette: Palette) {
  const geos = new Map<string, THREE.BufferGeometry>();
  const edgeGeos = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const shades = [palette.fills[0], palette.fills[1], palette.fills[2], "#ffffff"].map((h) => new T.Color(h));
  const white = new T.Color("#ffffff");
  const ink = new T.Color(palette.ink);
  const agent = new T.Color(palette.agent);
  /** The fill for a part that is live: a pale wash of the site blue. */
  const tintFill = new T.Color("#ffffff").lerp(agent, 0.2);

  const cached = (key: string, make: () => THREE.BufferGeometry) => {
    let g = geos.get(key);
    if (!g) {
      g = make();
      geos.set(key, g);
    }
    return g;
  };

  const box = (w: number, h: number, d: number) => cached(`b${w}/${h}/${d}`, () => new T.BoxGeometry(w, h, d));
  const cyl = (rTop: number, rBottom: number, h: number, seg = 6) =>
    cached(`c${rTop}/${rBottom}/${h}/${seg}`, () => new T.CylinderGeometry(rTop, rBottom, h, seg));
  const ico = (r: number, detail = 0) => cached(`i${r}/${detail}`, () => new T.IcosahedronGeometry(r, detail));

  /** A triangular prism: a gable roof or a pediment. Triangle in x/y, depth along z. */
  const prism = (w: number, h: number, d: number) =>
    cached(`p${w}/${h}/${d}`, () => {
      const s = new T.Shape();
      s.moveTo(-w / 2, 0);
      s.lineTo(w / 2, 0);
      s.lineTo(0, h);
      s.closePath();
      const g = new T.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
      g.translate(0, 0, -d / 2);
      return g;
    });

  /** A speech bubble standing upright, its tail at the lower left. Origin at the base. */
  const bubble = (w: number, h: number, d: number) =>
    cached(`s${w}/${h}/${d}`, () => {
      const r = Math.min(w, h) * 0.24;
      const s = new T.Shape();
      const x0 = -w / 2;
      const x1 = w / 2;
      s.moveTo(x0 + r, 0);
      s.lineTo(x0 + w * 0.2, 0);
      s.lineTo(x0 + w * 0.1, -h * 0.32);
      s.lineTo(x0 + w * 0.42, 0);
      s.lineTo(x1 - r, 0);
      s.quadraticCurveTo(x1, 0, x1, r);
      s.lineTo(x1, h - r);
      s.quadraticCurveTo(x1, h, x1 - r, h);
      s.lineTo(x0 + r, h);
      s.quadraticCurveTo(x0, h, x0, h - r);
      s.lineTo(x0, r);
      s.quadraticCurveTo(x0, 0, x0 + r, 0);
      const g = new T.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 3 });
      g.translate(0, h * 0.32, -d / 2);
      return g;
    });

  const edgesOf = (geo: THREE.BufferGeometry) => {
    let e = edgeGeos.get(geo);
    if (!e) {
      e = new T.EdgesGeometry(geo, 20);
      edgeGeos.set(geo, e);
    }
    return e;
  };

  const euler = new T.Euler();
  function place(o: THREE.Object3D, pos?: V3, rot?: V3, scale?: V3) {
    if (pos) o.position.set(pos[0], pos[1], pos[2]);
    if (rot) o.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) o.scale.set(scale[0], scale[1], scale[2]);
  }

  function part(name = ""): Part {
    const group = new T.Group();
    group.name = name;
    const mats = new Map<Shade, THREE.MeshLambertMaterial>();
    const edge = new T.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    let last = "";
    const p: Part = {
      group,
      tint: 0,
      dim: 0,
      rise: 1,
      add(geo, shade, pos, rot, scale) {
        let mat = mats.get(shade);
        if (!mat) {
          mat = paperMaterial(T, shades[shade]);
          mats.set(shade, mat);
        }
        const mesh = new T.Mesh(geo, mat);
        place(mesh, pos, rot, scale);
        const lines = new T.LineSegments(edgesOf(geo), edge);
        lines.raycast = () => {};
        mesh.add(lines);
        group.add(mesh);
      },
      update() {
        const key = `${p.tint.toFixed(3)}|${p.dim.toFixed(3)}|${p.rise.toFixed(3)}`;
        if (key === last) return;
        last = key;
        for (const [shade, mat] of mats) mat.color.copy(shades[shade]).lerp(white, p.dim * 0.9).lerp(tintFill, p.tint);
        edge.color.copy(ink).lerp(agent, p.tint);
        edge.opacity = lerp(0.85 * (1 - 0.85 * p.dim), 1, p.tint);
        const r = p.rise;
        group.visible = r > 0.002;
        group.scale.setScalar(Math.max(0.001, easeOutBack(r)));
      },
    };
    return p;
  }

  /** A cylinder from one point to another, for arms and legs. rTo is the radius at `to`. */
  const up = new T.Vector3(0, 1, 0);
  const q = new T.Quaternion();
  const va = new T.Vector3();
  const vb = new T.Vector3();
  function limb(add: Add, from: V3, to: V3, rTo: number, rFrom: number, shade: Shade, seg = 6) {
    va.set(...from);
    vb.set(...to);
    const len = va.distanceTo(vb);
    const dir = vb.clone().sub(va).normalize();
    q.setFromUnitVectors(up, dir);
    euler.setFromQuaternion(q);
    const mid: V3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    add(cyl(rTo, rFrom, +len.toFixed(3), seg), shade, mid, [euler.x, euler.y, euler.z]);
  }

  /** An `add` that records pieces under a base transform, for baking. */
  function collector(base: THREE.Matrix4, into: { geo: THREE.BufferGeometry; m: THREE.Matrix4; shade: Shade }[]): Add {
    return (geo, shade, pos, rot, scale) => {
      const o = new T.Object3D();
      place(o, pos, rot, scale);
      o.updateMatrix();
      into.push({ geo, m: base.clone().multiply(o.matrix), shade });
    };
  }

  /** Merges recorded pieces into one fill geometry (with vertex colours) and one edge geometry. */
  function bake(items: { geo: THREE.BufferGeometry; m: THREE.Matrix4; shade: Shade }[]) {
    const pos: number[] = [];
    const col: number[] = [];
    const lines: number[] = [];
    for (const { geo, m, shade } of items) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.applyMatrix4(m);
      const a = g.getAttribute("position");
      const c = shades[shade];
      for (let i = 0; i < a.count; i++) {
        pos.push(a.getX(i), a.getY(i), a.getZ(i));
        col.push(c.r, c.g, c.b);
      }
      g.dispose();
      const e = edgesOf(geo).clone();
      e.applyMatrix4(m);
      const ea = e.getAttribute("position");
      for (let i = 0; i < ea.count; i++) lines.push(ea.getX(i), ea.getY(i), ea.getZ(i));
      e.dispose();
    }
    const fill = new T.BufferGeometry();
    fill.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    fill.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    fill.computeBoundingBox();
    const edges = new T.BufferGeometry();
    edges.setAttribute("position", new T.Float32BufferAttribute(lines, 3));
    return { fill, edges };
  }

  return { box, cyl, ico, prism, bubble, edgesOf, part, place, limb, collector, bake, shades, tintFill };
}

export type Shop = ReturnType<typeof createShop>;

/* ---------- builders ---------- */

/**
 * A resident standing with a phone to the right ear, facing +z, feet at the origin.
 * Returns anchors for labels and for the call line.
 */
export function buildPerson(T: Three, shop: Shop, body: Part, phone: Part) {
  const { box, cyl, ico, limb } = shop;
  const add = body.add;
  for (const s of [-1, 1]) {
    add(box(0.15, 0.09, 0.28), 2, [s * 0.11, 0.045, 0.04]);
    limb(add, [s * 0.11, 0.09, 0], [s * 0.11, 0.88, 0], 0.095, 0.075, 1);
  }
  add(cyl(0.27, 0.2, 0.66, 6), 2, [0, 1.19, 0], [0, Math.PI / 6, 0], [1, 1, 0.74]);
  add(cyl(0.065, 0.07, 0.1, 6), 0, [0, 1.56, 0]);
  add(ico(0.2, 0), 0, [0, 1.79, 0.01], [0.3, 0.2, 0], [1, 1.08, 1]);
  // Left arm hangs; the right arm holds the phone to the ear.
  limb(add, [-0.29, 1.46, 0], [-0.36, 1.16, 0.05], 0.06, 0.07, 2);
  limb(add, [-0.36, 1.16, 0.05], [-0.33, 0.88, 0.09], 0.055, 0.06, 1);
  add(ico(0.06, 0), 0, [-0.33, 0.84, 0.09]);
  limb(add, [0.29, 1.46, 0], [0.44, 1.22, 0.17], 0.06, 0.07, 2);
  limb(add, [0.44, 1.22, 0.17], [0.29, 1.64, 0.12], 0.055, 0.06, 1);
  add(ico(0.06, 0), 0, [0.27, 1.68, 0.11]);

  const holder = new T.Group();
  holder.position.set(0.25, 1.77, 0.07);
  holder.rotation.set(-0.45, 0, -0.12);
  holder.add(phone.group);
  phone.add(box(0.032, 0.21, 0.11), 2);
  body.group.add(holder);

  const anchor = (x: number, y: number, z: number) => {
    const o = new T.Object3D();
    o.position.set(x, y, z);
    body.group.add(o);
    return o;
  };
  return {
    head: anchor(0, 2.04, 0),
    chest: anchor(0, 1.25, 0.15),
    /** Where the call line leaves the phone. */
    tip: (() => {
      const o = new T.Object3D();
      o.position.set(0.03, 0.08, 0);
      phone.group.add(o);
      return o;
    })(),
  };
}

/** A small house, front door facing +z. */
export function buildHouse(shop: Shop, add: Add) {
  const { box, prism } = shop;
  add(box(1.4, 1.0, 1.15), 0, [0, 0.5, 0]);
  add(prism(1.62, 0.62, 1.32), 2, [0, 1.0, 0]);
  add(box(0.17, 0.42, 0.17), 1, [0.4, 1.2, -0.22]);
  add(box(0.28, 0.52, 0.03), 2, [-0.32, 0.26, 0.585]);
  add(box(0.32, 0.3, 0.03), 1, [0.3, 0.6, 0.585]);
}

/** The county office: steps, four columns and a pediment, entrance facing +z. 2.5 tall. */
export function buildOffice(shop: Shop, add: Add) {
  const { box, cyl, prism } = shop;
  add(box(3.6, 0.12, 2.5), 1, [0, 0.06, 0]);
  add(box(3.36, 0.12, 2.3), 0, [0, 0.18, 0]);
  add(box(2.9, 1.5, 1.5), 0, [0, 0.99, -0.3]);
  for (const x of [-1.26, -0.42, 0.42, 1.26]) add(cyl(0.1, 0.12, 1.5, 6), 3, [x, 0.99, 0.85]);
  add(box(3.36, 0.22, 2.3), 1, [0, 1.85, 0]);
  add(prism(3.36, 0.55, 2.3), 2, [0, 1.96, 0]);
  add(box(0.5, 0.8, 0.03), 2, [0, 0.64, 0.465]);
  for (const x of [-0.95, 0.95]) add(box(0.34, 0.5, 0.03), 1, [x, 1.0, 0.465]);
}

/** The call router: a flat box with a row of ports. */
export function buildRouter(shop: Shop, add: Add) {
  const { box } = shop;
  add(box(1.15, 0.3, 0.72), 1, [0, 0.15, 0]);
  add(box(1.05, 0.04, 0.62), 0, [0, 0.32, 0]);
  for (let i = 0; i < 5; i++) add(box(0.12, 0.08, 0.02), 2, [-0.4 + i * 0.2, 0.15, 0.37]);
}

export const UNIT_Y = [0.27, 0.61, 0.95, 1.29, 1.63];

/** The rack: a frame and five units, one voice agent each. */
export function buildRack(shop: Shop, frame: Part, units: Part[]) {
  const { box } = shop;
  frame.add(box(0.9, 0.08, 0.78), 2, [0, 0.04, 0]);
  frame.add(box(0.9, 0.08, 0.78), 2, [0, 1.94, 0]);
  for (const [x, z] of [
    [-0.41, -0.35],
    [0.41, -0.35],
    [-0.41, 0.35],
    [0.41, 0.35],
  ])
    frame.add(box(0.06, 1.82, 0.06), 2, [x, 0.99, z]);
  units.forEach((u, i) => {
    const y = UNIT_Y[i];
    u.add(box(0.74, 0.28, 0.66), 0, [0, y, 0]);
    u.add(box(0.07, 0.06, 0.02), 2, [0.27, y, 0.335]);
    u.add(box(0.38, 0.035, 0.015), 1, [-0.12, y + 0.05, 0.335]);
    u.add(box(0.38, 0.035, 0.015), 1, [-0.12, y - 0.05, 0.335]);
    frame.group.add(u.group);
  });
}

/** The knowledge base: a stack of three books. */
export function buildBooks(shop: Shop, add: Add) {
  const { box } = shop;
  const books: [number, number, number, number][] = [
    [1.0, 0.17, 0.7, 0.05],
    [0.92, 0.15, 0.64, -0.14],
    [0.96, 0.16, 0.68, 0.2],
  ];
  let y = 0;
  for (const [w, h, d, r] of books) {
    const c = Math.cos(r);
    const s = Math.sin(r);
    // Local offsets rotated by r about y.
    const at = (lx: number, ly: number, lz: number): V3 => [lx * c + lz * s, y + ly, -lx * s + lz * c];
    add(box(w, 0.025, d), 2, at(0, 0.0125, 0), [0, r, 0]);
    add(box(w, 0.025, d), 2, at(0, h - 0.0125, 0), [0, r, 0]);
    add(box(0.035, h, d), 2, at(-w / 2 + 0.0175, h / 2, 0), [0, r, 0]);
    add(box(w - 0.06, h - 0.05, d - 0.05), 3, at(0.01, h / 2, 0), [0, r, 0]);
    y += h;
  }
  return y;
}

/** Records data: the usual stack of discs. */
export function buildDatabase(shop: Shop, add: Add) {
  const { cyl } = shop;
  for (let i = 0; i < 3; i++) add(cyl(0.44, 0.44, 0.24, 10), i === 1 ? 0 : 1, [0, 0.12 + i * 0.3, 0]);
  return 0.84;
}

/** The FAQ bank: past conversations as a file of speech bubbles. */
export function buildFaq(shop: Shop, add: Add) {
  const { box, bubble } = shop;
  add(box(1.2, 0.08, 0.7), 2, [0.1, 0.04, -0.12]);
  for (let i = 0; i < 3; i++) {
    const z = 0.12 - i * 0.2;
    const y = 0.2 + i * 0.13;
    const x = i * 0.1;
    add(bubble(0.86, 0.52, 0.06), i === 0 ? 3 : 0, [x, y, z]);
    // Two lines of "text" on the front face.
    for (let k = 0; k < 2; k++) add(box(k ? 0.36 : 0.52, 0.04, 0.012), 2, [x - 0.04 - (k ? 0.08 : 0), y + 0.49 - k * 0.12, z + 0.036]);
  }
  return 1.24;
}
