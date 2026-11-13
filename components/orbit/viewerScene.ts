import type * as THREE from "three";
import { buildCubeSat } from "./cubesat";

/*
  The take-it-apart viewer: the CubeSat on a transparent canvas with studio light. Drag to
  turn it; when idle it rolls slowly about its long axis, which keeps the three units side
  by side for the labels. Taking it apart separates the units, lifts the skins and moves
  every surface from real materials to an engineering drawing.
*/

type Three = typeof THREE;

export class ViewerUnsupportedError extends Error {}

export type ViewerOptions = {
  canvas: HTMLCanvasElement;
  /** Edge line colour for the drawing look. */
  ink: string;
  reduceMotion: boolean;
  onReady?: () => void;
  onFail?: () => void;
  /** Screen positions (CSS px on the canvas) of the payload, ADCS and power anchors. */
  onFrame?: (anchors: { x: number; y: number }[], explode: number) => void;
};

export type ViewerScene = {
  /** 0 closed, 1 fully taken apart. Eased toward unless motion is reduced. */
  setExplode(e: number): void;
  setActive(active: boolean): void;
  resize(): void;
  dispose(): void;
};

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createViewerScene(T: Three, opts: ViewerOptions): ViewerScene {
  const { canvas, ink, reduceMotion, onReady, onFail, onFrame } = opts;
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true, depth: true });
  if (!gl) throw new ViewerUnsupportedError("WebGL 2 is not available");
  const renderer = new T.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NeutralToneMapping;

  let failed = false;
  let disposed = false;
  const fail = () => {
    if (failed || disposed) return;
    failed = true;
    setActive(false);
    onFail?.();
  };
  renderer.debug.onShaderError = () => fail();

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(28, 1.6, 0.05, 20);

  // Studio reflections: a grey room with three soft boxes.
  const pmrem = new T.PMREMGenerator(renderer);
  const room = new T.Scene();
  const roomGeo = new T.BoxGeometry(10, 6, 10);
  const roomMat = new T.MeshBasicMaterial({ color: 0x5c6066, side: T.BackSide });
  room.add(new T.Mesh(roomGeo, roomMat));
  const boxGeo = new T.PlaneGeometry(1, 1);
  const boxMat = new T.MeshBasicMaterial({ color: 0xffffff });
  const softboxes: [number, number, number, number, number][] = [
    [0, 2.9, 0, 6, 3],
    [-4.9, 0.8, 1.5, 3, 2.4],
    [4.9, 1.2, -1, 2.4, 3],
  ];
  for (const [x, y, z, w, h] of softboxes) {
    const m = new T.Mesh(boxGeo, boxMat);
    m.position.set(x, y, z);
    m.scale.set(w, h, 1);
    m.lookAt(0, 0, 0);
    room.add(m);
  }
  const envTarget = pmrem.fromScene(room, 0.04);
  scene.environment = envTarget.texture;
  roomGeo.dispose();
  roomMat.dispose();
  boxGeo.dispose();
  boxMat.dispose();

  const hemi = new T.HemisphereLight(0xffffff, 0xd6dae2, 1.0);
  const key = new T.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.5, 2.6, 2.2);
  const rim = new T.DirectionalLight(0xffffff, 0.9);
  rim.position.set(-2, 1.2, -1.8);
  scene.add(hemi, key, rim);

  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  const sat = buildCubeSat(T, { interior: true, edges: true, ink, anisotropy });

  // pivot (drag) > base (three-quarter view) > lay the long axis along X > roll > satellite
  const pivot = new T.Group();
  const base = new T.Group();
  // Turned so the long axis runs corner to corner, and seen from a little above.
  base.rotation.set(0.5, -0.55, 0, "XYZ");
  const lay = new T.Group();
  lay.rotation.z = -Math.PI / 2;
  const roll = new T.Group();
  roll.rotation.y = -1.1;
  roll.add(sat.root);
  lay.add(roll);
  base.add(lay);
  pivot.add(base);
  scene.add(pivot);

  // ---- Drag with inertia -------------------------------------------------------------
  const qDrag = new T.Quaternion();
  const axisX = new T.Vector3(1, 0, 0);
  const axisY = new T.Vector3(0, 1, 0);
  let velX = 0;
  let velY = 0;
  let dragging: { id: number; x: number; y: number; t: number } | null = null;
  let idleAt = 0;
  let clock = 0;
  const SENS = 0.0085;

  function turn(dx: number, dy: number) {
    qDrag.setFromAxisAngle(axisY, dx);
    pivot.quaternion.premultiply(qDrag);
    qDrag.setFromAxisAngle(axisX, dy);
    pivot.quaternion.premultiply(qDrag);
  }

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    velX = 0;
    velY = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.dataset.dragging = "";
    if (!running) draw(0);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const dx = (e.clientX - dragging.x) * SENS;
    // Touch scrolls vertically (touch-action: pan-y), so only a mouse or pen tilts.
    const dy = e.pointerType === "touch" ? 0 : (e.clientY - dragging.y) * SENS;
    const dt = Math.max((e.timeStamp - dragging.t) / 1000, 1 / 240);
    turn(dx, dy);
    velX = velX * 0.5 + (dx / dt) * 0.5;
    velY = velY * 0.5 + (dy / dt) * 0.5;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    dragging.t = e.timeStamp;
    if (!running) draw(0);
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    if ((e.timeStamp - dragging.t) / 1000 > 0.1 || reduceMotion) {
      velX = 0;
      velY = 0;
    }
    velX = Math.max(-6, Math.min(6, velX));
    velY = Math.max(-6, Math.min(6, velY));
    dragging = null;
    idleAt = clock + 1.4;
    delete canvas.dataset.dragging;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  // ---- Layout ------------------------------------------------------------------------
  let width = 1;
  let height = 1;
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    width = w;
    height = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ---- Frame -------------------------------------------------------------------------
  let explodeTo = 0;
  let explode = 0;
  let running = false;
  let raf = 0;
  let last = 0;
  const anchorPx = [0, 1, 2].map(() => ({ x: 0, y: 0 }));
  const v = new T.Vector3();

  // The long axis on screen for the resting view (drags don't refit, so the size holds).
  const axis = new T.Vector3(0, 1, 0).applyQuaternion(
    new T.Quaternion().setFromEuler(base.rotation).multiply(new T.Quaternion().setFromEuler(lay.rotation)),
  );
  function frameCamera() {
    // Fit the cylinder that holds the satellite at any roll: closed, the wings set its
    // radius; taken apart, the length grows and the faint wings may run off the edge.
    // Room is kept above and below for the labels.
    const e = smooth(0, 1, explode);
    const halfLen = 0.19 + 0.2 * e;
    const r = 0.3 - 0.13 * e;
    const extX = Math.abs(axis.x) * halfLen + r * Math.sqrt(1 - axis.x * axis.x);
    const extY = Math.abs(axis.y) * halfLen + r * Math.sqrt(1 - axis.y * axis.y);
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const fitV = extY / (tan * (0.92 - 0.18 * e));
    const fitH = extX / (tan * camera.aspect * 0.94);
    camera.position.set(0, 0, Math.max(fitV, fitH));
    camera.lookAt(0, 0, 0);
  }

  function draw(dt: number) {
    clock += dt;
    if (reduceMotion) explode = explodeTo;
    else explode += (explodeTo - explode) * (1 - Math.exp(-dt * 6));
    if (Math.abs(explodeTo - explode) < 1e-4) explode = explodeTo;
    const eased = smooth(0, 1, explode);
    sat.setExplode(eased);
    sat.setSchematic(smooth(0.12, 0.62, explode));
    // Flatter, brighter light for the drawing; modelled light for the real thing.
    const s = smooth(0.12, 0.62, explode);
    hemi.intensity = 1.0 + 1.9 * s;
    key.intensity = 2.2 - 1.3 * s;
    rim.intensity = 0.9 - 0.6 * s;

    if (!reduceMotion) {
      sat.spin(dt);
      if (!dragging) {
        if (Math.abs(velX) + Math.abs(velY) > 1e-3) {
          turn(velX * dt, velY * dt);
          const k = Math.exp(-dt * 3.2);
          velX *= k;
          velY *= k;
        }
        if (clock > idleAt) roll.rotation.y += dt * 0.16;
      }
    }

    frameCamera();
    renderer.render(scene, camera);

    if (onFrame) {
      sat.anchors.forEach((a, i) => {
        a.getWorldPosition(v).project(camera);
        anchorPx[i].x = ((v.x + 1) / 2) * width;
        anchorPx[i].y = ((1 - v.y) / 2) * height;
      });
      onFrame(anchorPx, explode);
    }
  }

  function frame(now: number) {
    raf = 0;
    if (!running || disposed) return;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    draw(dt);
    raf = requestAnimationFrame(frame);
  }

  function setActive(next: boolean) {
    running = next && !disposed && !failed;
    if (running && !raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    } else if (!running && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  const onLost = (e: Event) => {
    e.preventDefault();
    fail();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  resize();
  draw(0);
  requestAnimationFrame(() => {
    if (!disposed && !failed) onReady?.();
  });

  return {
    setExplode(e) {
      explodeTo = Math.min(1, Math.max(0, e));
      // With reduced motion there is no loop running, so draw the new state at once.
      if (!running && !failed && !disposed) draw(0);
    },
    setActive(next) {
      // Reduced motion keeps a still figure that redraws on input only.
      setActive(next && !reduceMotion);
    },
    resize() {
      resize();
      if (!running && !failed) draw(0);
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("webglcontextlost", onLost);
      sat.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
