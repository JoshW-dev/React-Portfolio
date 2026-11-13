import type * as THREE from "three";

/*
  Small three.js helpers shared by every scroll breakdown, so the scenes look like one
  family: low-poly parts, flat shading, pale fills, thin ink edges, and the site blue only
  on the part that is live or active.

  three.js is passed in (T), so importing this file never pulls three.js into a bundle.
*/

type Three = typeof THREE;

/* ---------- palette ---------- */

export type Palette = {
  bg: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  /** The site blue. Only for the live or active part. */
  agent: string;
  agentPale: string;
  /** Pale fills for low-poly parts, lightest first. */
  fills: [string, string, string];
};

const FALLBACK: Palette = {
  bg: "#ffffff",
  ink: "#000000",
  muted: "#5d6168",
  faint: "#9a9ea6",
  line: "#e5e5e5",
  agent: "#2540f5",
  agentPale: "#eef1ff",
  fills: ["#f6f7f8", "#eceef1", "#dfe2e6"],
};

/** Reads the site tokens from CSS custom properties on an element, with fallbacks. */
export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    ...FALLBACK,
    bg: v("--bg", FALLBACK.bg),
    ink: v("--ink", FALLBACK.ink),
    muted: v("--muted", FALLBACK.muted),
    faint: v("--faint", FALLBACK.faint),
    line: v("--line", FALLBACK.line),
    agent: v("--agent", FALLBACK.agent),
    agentPale: v("--agent-pale", FALLBACK.agentPale),
  };
}

/* ---------- maths ---------- */

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smoothstep of v between a and b. */
export const ramp = (v: number, a: number, b: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * One value per step, read at a continuous step position. Each value holds around its
 * step and eases to the next one across the middle of the gap, so the model sits still
 * while a step's text is centred.
 */
export function track(values: readonly number[], position: number, hold = 0.18): number {
  const n = values.length;
  if (position <= 0) return values[0];
  if (position >= n - 1) return values[n - 1];
  const i = Math.floor(position);
  const t = ramp(position - i, hold, 1 - hold);
  return lerp(values[i], values[i + 1], t);
}

/** 1 while step i is in view, fading to 0 by the time the next step takes over. */
export function near(position: number, i: number, inner = 0.3, outer = 0.55): number {
  return 1 - ramp(Math.abs(position - i), inner, outer);
}

/* ---------- stage shape ---------- */

/** The shell's phone layout: the visual pinned across the top, the steps under it. */
export const NARROW_QUERY = "(max-width: 799px)";

/**
 * Whether a scene should use its layout for a wide stage. On phones the stage counts as
 * wide from about square. On wide screens the stage is about square already, so there it
 * takes a clearly wide stage, such as a short browser window.
 */
export function isWideStage(width: number, height: number) {
  const narrow = typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches;
  return width / height > (narrow ? 0.95 : 1.45);
}

/* ---------- renderer ---------- */

export class NoWebGLError extends Error {}

const dprCaps = new WeakMap<THREE.WebGLRenderer, number>();

export type RendererOptions = {
  /** Device pixel ratio cap. Defaults to 2. */
  maxDpr?: number;
  /** "neutral" for metal and studio light, "none" (default) for exact palette colours. */
  toneMapping?: "neutral" | "none";
};

/**
 * A WebGL 2 renderer on a transparent canvas, so the page's white shows through. Throws
 * NoWebGLError when WebGL 2 is missing.
 */
export function createRenderer(T: Three, canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true, depth: true });
  if (!gl) throw new NoWebGLError("WebGL 2 is not available");
  const renderer = new T.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true });
  renderer.setClearColor(0xffffff, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = opts.toneMapping === "neutral" ? T.NeutralToneMapping : T.NoToneMapping;
  dprCaps.set(renderer, opts.maxDpr ?? 2);
  return renderer;
}

/**
 * Matches the drawing buffer to the canvas's CSS size (DPR capped) and the camera aspect.
 * Returns the CSS size, or null while the canvas has no size.
 */
export function sizeRenderer(renderer: THREE.WebGLRenderer, camera?: THREE.PerspectiveCamera) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  const cap = dprCaps.get(renderer) ?? 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  renderer.setSize(width, height, false);
  if (camera) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  return { width, height };
}

/** Frees every geometry, material and texture under an object. */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const value of Object.values(mat)) {
        if (value && typeof value === "object" && "isTexture" in value) (value as THREE.Texture).dispose();
      }
      mat.dispose();
    }
  });
}

/** Full teardown: the scene's contents, then the renderer and its context. */
export function disposeRenderer(renderer: THREE.WebGLRenderer, scene?: THREE.Object3D) {
  if (scene) disposeTree(scene);
  renderer.dispose();
  renderer.forceContextLoss();
}

/* ---------- look ---------- */

/** Soft daylight for flat-shaded paper parts: a sky fill plus one key from the upper left. */
export function paperLights(T: Three, scene: THREE.Object3D) {
  const hemi = new T.HemisphereLight(0xffffff, 0xd9dde3, 2.2);
  const key = new T.DirectionalLight(0xffffff, 1.1);
  key.position.set(-1.2, 2.4, 1.8);
  scene.add(hemi, key);
  return { hemi, key };
}

/**
 * A flat-shaded material for low-poly parts. Use palette.fills for the body of a part and
 * palette.agentPale for the active one. Polygon offset keeps ink edges on top.
 */
export function paperMaterial(T: Three, color: THREE.ColorRepresentation, opacity = 1) {
  return new T.MeshLambertMaterial({
    color,
    flatShading: true,
    transparent: opacity < 1,
    opacity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/**
 * Thin ink outlines on a mesh's hard edges (EdgesGeometry), added as a child so they
 * follow it. Lines are always 1 CSS pixel in WebGL, which suits a technical drawing.
 */
export function inkEdges(
  T: Three,
  mesh: THREE.Mesh,
  opts: { color?: THREE.ColorRepresentation; opacity?: number; threshold?: number } = {},
) {
  const { color = "#000000", opacity = 0.85, threshold = 20 } = opts;
  const lines = new T.LineSegments(
    new T.EdgesGeometry(mesh.geometry, threshold),
    new T.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }),
  );
  lines.raycast = () => {};
  mesh.add(lines);
  return lines;
}

/* ---------- screen projection and labels ---------- */

export type ScreenPoint = { x: number; y: number; behind: boolean };

/**
 * Returns a function that projects a 3D point or object to CSS pixels on the canvas.
 * Call it after the camera has moved for the frame.
 */
export function createProjector(T: Three) {
  const v = new T.Vector3();
  return function project(
    target: THREE.Object3D | THREE.Vector3,
    camera: THREE.Camera,
    width: number,
    height: number,
    out: ScreenPoint = { x: 0, y: 0, behind: false },
  ): ScreenPoint {
    if ((target as THREE.Object3D).isObject3D) (target as THREE.Object3D).getWorldPosition(v);
    else v.copy(target as THREE.Vector3);
    v.project(camera);
    out.x = ((v.x + 1) / 2) * width;
    out.y = ((1 - v.y) / 2) * height;
    out.behind = v.z > 1;
    return out;
  };
}

export type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * Screen box of the visible meshes under root, from the corners of each mesh's own
 * bounding box (tight for box-shaped parts). Skips meshes faded under minOpacity.
 */
export function createScreenBox(T: Three) {
  const corner = new T.Vector3();
  return function screenBox(
    root: THREE.Object3D,
    camera: THREE.Camera,
    width: number,
    height: number,
    out: Rect,
    minOpacity = 0.5,
  ): Rect {
    out.left = Infinity;
    out.top = Infinity;
    out.right = -Infinity;
    out.bottom = -Infinity;
    root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      if (mat.transparent && mat.opacity < minOpacity) return;
      const bb = m.geometry.boundingBox ?? (m.geometry.computeBoundingBox(), m.geometry.boundingBox!);
      for (let k = 0; k < 8; k++) {
        corner
          .set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z)
          .applyMatrix4(m.matrixWorld)
          .project(camera);
        const x = ((corner.x + 1) / 2) * width;
        const y = ((1 - corner.y) / 2) * height;
        if (x < out.left) out.left = x;
        if (x > out.right) out.right = x;
        if (y < out.top) out.top = y;
        if (y > out.bottom) out.bottom = y;
      }
    });
    return out;
  };
}

export type Side = "left" | "right" | "top" | "bottom";

export type Callout = {
  /** The label. Absolutely positioned at 0,0 inside the stage; moved with transforms. */
  el: HTMLElement;
  /** Leader line from the anchor to the label, in an SVG that covers the stage. */
  line: SVGLineElement;
  /** Optional dot on the anchor. */
  dot?: SVGCircleElement | null;
};

export type CalloutPlacement = {
  callout: Callout;
  /** Anchor in CSS px on the stage. */
  x: number;
  y: number;
  /** Which side of the model box the label goes on. */
  side: Side;
  /** 0 to 1. Below 0.01 the label is hidden. */
  opacity: number;
};

const sizes = new WeakMap<HTMLElement, { w: number; h: number }>();

/** Forgets measured label sizes, after a resize or font change. */
export function remeasureCallouts(callouts: Callout[]) {
  for (const c of callouts) sizes.delete(c.el);
}

/**
 * Puts each label just outside the model's screen box on its side, lined up with its
 * anchor, kept inside the stage and clear of the other labels on that side, then draws a
 * thin leader from the anchor to the nearest edge of the label.
 */
export function placeCallouts(items: CalloutPlacement[], box: Rect, stage: { width: number; height: number }, gap = 18) {
  const pad = 6;
  const placed: { side: Side; a: number; b: number }[] = [];
  const order = [...items].sort((p, q) => (p.side === "left" || p.side === "right" ? p.y - q.y : p.x - q.x));
  for (const item of order) {
    const { callout, x, y, side, opacity } = item;
    const { el, line, dot } = callout;
    const on = opacity > 0.01;
    el.style.opacity = on ? opacity.toFixed(3) : "0";
    line.style.opacity = el.style.opacity;
    if (dot) dot.style.opacity = el.style.opacity;
    if (!on) continue;
    let size = sizes.get(el);
    if (!size || !size.w) {
      size = { w: el.offsetWidth, h: el.offsetHeight };
      sizes.set(el, size);
    }
    const { w, h } = size;
    let left: number;
    let top: number;
    if (side === "left" || side === "right") {
      left = side === "left" ? box.left - gap - w : box.right + gap;
      left = Math.min(Math.max(left, pad), stage.width - w - pad);
      top = Math.min(Math.max(y - h / 2, pad), stage.height - h - pad);
      // Step clear of labels already on this side.
      for (const p of placed) if (p.side === side && top < p.b + 4 && top + h > p.a - 4) top = p.b + 4;
      placed.push({ side, a: top, b: top + h });
    } else {
      top = side === "top" ? box.top - gap - h : box.bottom + gap;
      top = Math.min(Math.max(top, pad), stage.height - h - pad);
      left = Math.min(Math.max(x - w / 2, pad), stage.width - w - pad);
      for (const p of placed) if (p.side === side && left < p.b + 6 && left + w > p.a - 6) left = p.b + 6;
      placed.push({ side, a: left, b: left + w });
    }
    el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
    // Leader: to the label's nearest edge point.
    const ex = Math.min(Math.max(x, left), left + w);
    const ey = Math.min(Math.max(y, top), top + h);
    line.setAttribute("x1", x.toFixed(1));
    line.setAttribute("y1", y.toFixed(1));
    line.setAttribute("x2", ex.toFixed(1));
    line.setAttribute("y2", ey.toFixed(1));
    if (dot) {
      dot.setAttribute("cx", x.toFixed(1));
      dot.setAttribute("cy", y.toFixed(1));
    }
  }
}

/* ---------- running ---------- */

export type Loop = { start(): void; stop(): void; readonly running: boolean };

/** A requestAnimationFrame loop. dt is in seconds, capped at 0.05 after a stall. */
export function createLoop(step: (dt: number) => void): Loop {
  let raf = 0;
  let last = 0;
  const frame = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    step(dt);
    raf = requestAnimationFrame(frame);
  };
  return {
    start() {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    get running() {
      return raf !== 0;
    },
  };
}

/**
 * Calls onChange(true) while the element is near the viewport and the tab is visible, and
 * onChange(false) otherwise. Returns the cleanup.
 */
export function watchActive(el: Element, onChange: (active: boolean) => void) {
  let onScreen = false;
  let shown = document.visibilityState === "visible";
  let now = false;
  const sync = () => {
    const next = onScreen && shown;
    if (next !== now) {
      now = next;
      onChange(next);
    }
  };
  const io = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    },
    { rootMargin: "100px 0px" },
  );
  io.observe(el);
  const onVisibility = () => {
    shown = document.visibilityState === "visible";
    sync();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    io.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
