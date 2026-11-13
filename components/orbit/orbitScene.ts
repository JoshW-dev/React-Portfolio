import type * as THREE from "three";
import { buildCubeSat } from "./cubesat";
import { TEXTURES, earthFragment, earthVertex, latLon, loadImage, makeTexture, type Tier } from "./earth";

/*
  The film's opening shot: Earth from low orbit with a 3U CubeSat drifting in, tumbling,
  then steadying with its camera on the ground.

  Two passes share one renderer. The planet is ray-cast on a full-screen triangle in
  Earth radii; the satellite is a normal scene in metres, drawn after a depth clear with
  a camera that has the same orientation and field of view. Both use the same sun.
*/

type Three = typeof THREE;

/** Camera altitude in Earth radii: about 1,800 km. */
const ALT = 0.28;
/** The point under the camera at the start and the heading it looks along (degrees). */
const START = { lat: 38.5, lon: -116.5, heading: 10 };
/** Sun azimuth (degrees from north, toward east) and elevation at the start point. */
const SUN_AZ = 281;
const SUN_EL = 6;
/** Ground drift in radians a second: about one frame-width every 75 seconds. */
const SPIN = 0.007;
/** Where the top of the horizon sits, in normalised device coordinates (0.2 = 40% down). */
const HORIZON_Y = 0.2;

/** Choreography, in seconds from the first frame. */
const T_ENTER = 2;
const T_CROSS = 10.5;
const T_DETUMBLE = T_ENTER + 3.4;
const T_SETTLED = T_ENTER + 10.2;
/** Satellite path in device coordinates. */
const START_NDC: [number, number] = [-1.5, 0.5];
const HOLD_NDC: [number, number] = [0.1, 0.34];
/**
 * Where the satellite's camera settles: a little ahead of and left of straight down, in
 * the world frame (up +Y, ahead -Z). Close to nadir, so the long body shows side-on.
 */
const LOOK_DIR: [number, number, number] = [-0.2, -1, -0.34];
/** Share of the viewport height the satellite fills at the hold; cap on width share. */
const SIZE = 0.18;
const MAX_WIDTH = 0.4;
/** Turn about the long axis at the hold, in radians, away from facing the camera. */
const ROLL = 0.85;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class OrbitUnsupportedError extends Error {}

export type SatFrame = {
  /** Satellite bounding box on the canvas, in CSS pixels. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  cy: number;
  shown: boolean;
  settled: boolean;
};

export type OrbitSceneOptions = {
  canvas: HTMLCanvasElement;
  onReady?: () => void;
  onFail?: () => void;
  onFrame?: (f: SatFrame) => void;
};

export type OrbitScene = {
  setActive(active: boolean): void;
  resize(): void;
  /** True when a viewport point is over the satellite. */
  hitTest(clientX: number, clientY: number): boolean;
  setHover(on: boolean): void;
  /** Average milliseconds between frames over the last second (0 before that). */
  frameMs(): number;
  dispose(): void;
};

function fovFor(aspect: number) {
  // Keep the horizontal view under about 80 degrees on wide screens, and widen the
  // vertical view on portrait screens so the horizon still curves.
  const wide = (2 * Math.atan(Math.tan((40 * Math.PI) / 180) / aspect) * 180) / Math.PI;
  if (aspect >= 1.2) return Math.min(46, wide);
  return Math.min(66, 46 * Math.sqrt(1.2 / aspect));
}

export function createOrbitScene(T: Three, opts: OrbitSceneOptions): OrbitScene {
  const { canvas, onReady, onFail, onFrame } = opts;
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (!gl) throw new OrbitUnsupportedError("WebGL 2 is not available");

  const renderer = new T.WebGLRenderer({ canvas, context: gl, antialias: true });
  renderer.autoClear = false;
  renderer.setClearColor(0x020306, 1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  let failed = false;
  const fail = () => {
    if (failed || disposed) return;
    failed = true;
    setActive(false);
    onFail?.();
  };
  renderer.debug.onShaderError = () => fail();

  // ---- Earth pass -------------------------------------------------------------------
  const earthCam = new T.PerspectiveCamera(46, 1, 0.01, 10);
  earthCam.position.set(0, 1 + ALT, 0);
  const earthScene = new T.Scene();
  const tri = new T.BufferGeometry();
  tri.setAttribute("position", new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const toEarth = new T.Matrix3();
  const sunAz = (SUN_AZ * Math.PI) / 180;
  const sunEl = (SUN_EL * Math.PI) / 180;
  // World frame at the start point: up +Y, north -Z, east +X.
  const sun = new T.Vector3(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz) * Math.cos(sunEl)).normalize();
  const earthMat = new T.ShaderMaterial({
    vertexShader: earthVertex,
    fragmentShader: earthFragment,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uDay: { value: null },
      uLights: { value: null },
      uWater: { value: null },
      uDaySize: { value: 4096 },
      uSun: { value: sun },
      uCamPos: { value: earthCam.position },
      uToEarth: { value: toEarth },
      uPixel: { value: 0.001 },
      uInvProj: { value: earthCam.projectionMatrixInverse },
      uCamWorld: { value: earthCam.matrixWorld },
    },
  });
  const earthQuad = new T.Mesh(tri, earthMat);
  earthQuad.frustumCulled = false;
  earthScene.add(earthQuad);

  // Earth orientation: the start point under the camera, its north pointing forward.
  const up0 = latLon(T, START.lat, START.lon);
  const north0 = new T.Vector3(0, 1, 0).addScaledVector(up0, -up0.y).normalize();
  const east0 = new T.Vector3().crossVectors(north0, up0);
  const hd = (START.heading * Math.PI) / 180;
  const ahead0 = north0.clone().multiplyScalar(Math.cos(hd)).addScaledVector(east0, Math.sin(hd));
  const right0 = east0.clone().multiplyScalar(Math.cos(hd)).addScaledVector(north0, -Math.sin(hd));
  const earthBasis = new T.Matrix4().makeBasis(right0, up0, ahead0);
  const worldBasis = new T.Matrix4().makeBasis(new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, -1));
  const q0 = new T.Quaternion().setFromRotationMatrix(worldBasis.multiply(earthBasis.transpose()));
  // The ground drifts right to left: the planet turns about the axis pointing back at us.
  const spinAxis = new T.Vector3(0, 0, 1);
  const qSpin = new T.Quaternion();
  const qEarth = new T.Quaternion();
  const m4 = new T.Matrix4();

  // ---- Satellite pass -----------------------------------------------------------------
  const satCam = new T.PerspectiveCamera(46, 1, 0.02, 80);
  const satScene = new T.Scene();
  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  const sat = buildCubeSat(T, { anisotropy });
  satScene.add(sat.root);
  sat.root.visible = false;

  const sunLight = new T.DirectionalLight(0xfff0dc, 4.2);
  sunLight.position.copy(sun).multiplyScalar(10);
  satScene.add(sunLight);
  // Earthshine: soft blue from below.
  const earthLight = new T.HemisphereLight(0x0b0f18, 0x4a6fa3, 1.9);
  satScene.add(earthLight);

  // Reflections for the metal: black space above, the planet below, the sun to the side.
  const pmrem = new T.PMREMGenerator(renderer);
  const envScene = new T.Scene();
  const dip = Math.asin(1 / (1 + ALT));
  const envMat = new T.ShaderMaterial({
    side: T.BackSide,
    uniforms: { uSun: { value: sun }, uRim: { value: -Math.cos(dip) } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform float uRim;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float planet = smoothstep(uRim + 0.02, uRim - 0.02, d.y);
        float sunSide = smoothstep(-0.4, 0.8, dot(normalize(d.xz + vec2(1e-4)), normalize(uSun.xz)));
        vec3 ground = mix(vec3(0.01, 0.015, 0.03), vec3(0.16, 0.22, 0.32), sunSide);
        float limb = exp(-abs(d.y - uRim) * 60.0) * (0.2 + 0.8 * sunSide);
        vec3 c = ground * planet + vec3(0.35, 0.6, 1.0) * limb;
        c += vec3(1.0, 0.92, 0.8) * pow(max(dot(d, uSun), 0.0), 900.0) * 40.0;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const envSphere = new T.Mesh(new T.SphereGeometry(1, 48, 24), envMat);
  envScene.add(envSphere);
  const envTarget = pmrem.fromScene(envScene, 0);
  satScene.environment = envTarget.texture;
  envSphere.geometry.dispose();
  envMat.dispose();

  // The camera's line of sight: a faint narrow frustum from the lens toward the ground.
  const coneLen = 1.5;
  const coneHalf = 0.05;
  const lens = new T.Vector3();
  sat.root.updateMatrixWorld(true);
  sat.lensTip.getWorldPosition(lens);
  const corners = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].map(([a, b]) => new T.Vector3(a * coneHalf * coneLen, lens.y - coneLen, b * coneHalf * coneLen));
  const linePos: number[] = [];
  const lineT: number[] = [];
  const fillPos: number[] = [];
  const fillT: number[] = [];
  corners.forEach((c, i) => {
    linePos.push(lens.x, lens.y, lens.z, c.x, c.y, c.z);
    lineT.push(0, 1);
    const n = corners[(i + 1) % 4];
    fillPos.push(lens.x, lens.y, lens.z, c.x, c.y, c.z, n.x, n.y, n.z);
    fillT.push(0, 1, 1);
  });
  const coneVert = /* glsl */ `
    attribute float aT;
    varying float vT;
    void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `;
  const coneFrag = /* glsl */ `
    uniform float uOpacity;
    varying float vT;
    void main() {
      float a = uOpacity * pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.03, vT);
      gl_FragColor = vec4(vec3(0.72, 0.86, 1.0) * a, a);
    }
  `;
  const coneOpacity = { value: 0 };
  const fillOpacity = { value: 0 };
  const makeConeMat = (u: { value: number }) =>
    new T.ShaderMaterial({
      vertexShader: coneVert,
      fragmentShader: coneFrag,
      uniforms: { uOpacity: u },
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
      toneMapped: false,
    });
  const coneLineGeo = new T.BufferGeometry();
  coneLineGeo.setAttribute("position", new T.Float32BufferAttribute(linePos, 3));
  coneLineGeo.setAttribute("aT", new T.Float32BufferAttribute(lineT, 1));
  const coneFillGeo = new T.BufferGeometry();
  coneFillGeo.setAttribute("position", new T.Float32BufferAttribute(fillPos, 3));
  coneFillGeo.setAttribute("aT", new T.Float32BufferAttribute(fillT, 1));
  const coneLineMat = makeConeMat(coneOpacity);
  const coneFillMat = makeConeMat(fillOpacity);
  const coneLines = new T.LineSegments(coneLineGeo, coneLineMat);
  const coneFill = new T.Mesh(coneFillGeo, coneFillMat);
  coneLines.raycast = () => {};
  coneFill.raycast = () => {};
  sat.root.add(coneLines, coneFill);

  // Hover target: a slightly enlarged invisible box.
  const hitGeo = new T.BoxGeometry(0.62, 0.48, 0.2);
  const hitMat = new T.MeshBasicMaterial({ visible: false });
  const hitBox = new T.Mesh(hitGeo, hitMat);
  sat.root.add(hitBox);
  const raycaster = new T.Raycaster();
  const ndc = new T.Vector2();

  // ---- Attitude control ---------------------------------------------------------------
  // A rigid body with a PD controller: free tumble, then a rate-limited detumble and slew
  // to the target, with a slightly underdamped settle. Fixed 1/120 s steps, so the motion
  // is the same at any frame rate.
  const STEP = 1 / 120;
  const KP = 1.25 * 1.25;
  const KD = 2 * 0.6 * 1.25;
  const MAX_ACC = 1.3;
  const q = new T.Quaternion().setFromEuler(new T.Euler(0.7, 2.2, -0.5));
  const w = new T.Vector3(0.62, -0.88, 0.42);
  let simT = T_ENTER;
  const qTarget = new T.Quaternion();
  const qGoal = new T.Quaternion();
  const qErr = new T.Quaternion();
  const qWob = new T.Quaternion();
  const eWob = new T.Euler();
  const tau = new T.Vector3();
  const err = new T.Vector3();
  const qDot = new T.Quaternion();

  function stepAttitude(t: number) {
    // Residual drift at the hold: the target itself wanders by about half a degree.
    eWob.set(0.009 * Math.sin(0.61 * t), 0.011 * Math.sin(0.47 * t + 1.3), 0.008 * Math.sin(0.83 * t + 2.1));
    qGoal.copy(qTarget).multiply(qWob.setFromEuler(eWob));
    const gain = smooth(T_DETUMBLE, T_DETUMBLE + 0.8, t);
    if (gain > 0) {
      qErr.copy(qGoal).multiply(qDot.copy(q).invert());
      if (qErr.w < 0) qErr.set(-qErr.x, -qErr.y, -qErr.z, -qErr.w);
      const s = Math.sqrt(1 - Math.min(1, qErr.w * qErr.w));
      const angle = 2 * Math.acos(Math.min(1, qErr.w));
      if (s > 1e-6) err.set(qErr.x / s, qErr.y / s, qErr.z / s).multiplyScalar(angle);
      else err.set(0, 0, 0);
      tau.copy(err).multiplyScalar(KP).addScaledVector(w, -KD).multiplyScalar(gain);
      const mag = tau.length();
      if (mag > MAX_ACC) tau.multiplyScalar(MAX_ACC / mag);
      w.addScaledVector(tau, STEP);
    }
    qDot.set(w.x, w.y, w.z, 0).multiply(q);
    q.set(q.x + 0.5 * qDot.x * STEP, q.y + 0.5 * qDot.y * STEP, q.z + 0.5 * qDot.z * STEP, q.w + 0.5 * qDot.w * STEP).normalize();
  }

  // ---- Layout (depends on the viewport) ----------------------------------------------
  let width = 1;
  let height = 1;
  let dist = 2.4;
  const holdPos = new T.Vector3();
  const startPos = new T.Vector3();
  const tmp = new T.Vector3();
  const tmp2 = new T.Vector3();

  function cameraPoint(x: number, y: number, d: number, out: THREE.Vector3) {
    const ty = Math.tan((satCam.fov * Math.PI) / 360);
    return out.set(x * d * ty * satCam.aspect, y * d * ty, -d).applyQuaternion(satCam.quaternion);
  }

  function aimAt(pos: THREE.Vector3, out: THREE.Quaternion) {
    // Lens (-Y) toward the look point; cells (+Z) turned toward the camera and the sun.
    const y = tmp.set(LOOK_DIR[0], LOOK_DIR[1], LOOK_DIR[2]).normalize().negate();
    const toward = tmp2.copy(pos).negate().normalize().addScaledVector(sun, 0.55);
    const z0 = toward.addScaledVector(y, -toward.dot(y)).normalize();
    // Turned a little about the long axis, so the body's side and the wings' depth show.
    const x0 = new T.Vector3().crossVectors(y, z0);
    const z = z0.clone().multiplyScalar(Math.cos(ROLL)).addScaledVector(x0, Math.sin(ROLL));
    const x = new T.Vector3().crossVectors(y, z);
    return out.setFromRotationMatrix(m4.makeBasis(x, y, z));
  }

  const kp = sat.keypoints.map((p) => p.clone());
  const kpTmp = new T.Vector3();
  function extent(pos: THREE.Vector3, rot: THREE.Quaternion) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of kp) {
      kpTmp.copy(p).applyQuaternion(rot).add(pos).project(satCam);
      x0 = Math.min(x0, kpTmp.x);
      x1 = Math.max(x1, kpTmp.x);
      y0 = Math.min(y0, kpTmp.y);
      y1 = Math.max(y1, kpTmp.y);
    }
    return { x0, x1, y0, y1 };
  }

  const MAX_PIXELS = 5_000_000;
  function resize() {
    const w0 = canvas.clientWidth;
    const h0 = canvas.clientHeight;
    if (!w0 || !h0) return;
    width = w0;
    height = h0;
    const base = Math.min(window.devicePixelRatio || 1, w0 < 700 ? 1.5 : 2);
    renderer.setPixelRatio(Math.min(base, Math.sqrt(MAX_PIXELS / (w0 * h0))));
    renderer.setSize(w0, h0, false);
    const aspect = w0 / h0;
    const fov = fovFor(aspect);
    // Portrait screens see a narrow slice, so the camera climbs (less magnified ground, more
    // curve) and turns a little right to keep the terminator and city lights in frame.
    const narrow = Math.min(1, Math.max(0, (1.2 - aspect) / 0.74));
    const alt = ALT + 0.22 * narrow;
    const yaw = -0.2 * narrow;
    earthCam.position.set(0, 1 + alt, 0);
    const dipAngle = Math.acos(1 / (1 + alt));
    const pitch = dipAngle + Math.atan(HORIZON_Y * Math.tan((fov * Math.PI) / 360));
    for (const cam of [earthCam, satCam]) {
      cam.fov = fov;
      cam.aspect = aspect;
      cam.rotation.set(-pitch, yaw, 0, "YXZ");
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    }
    const buffer = renderer.getDrawingBufferSize(new T.Vector2());
    earthMat.uniforms.uPixel.value = (2 * Math.tan((fov * Math.PI) / 360)) / buffer.y;

    // Distance so the satellite at the hold fills SIZE of the height (and no more than
    // MAX_WIDTH of the width on narrow screens).
    let d = 2.4;
    for (let k = 0; k < 3; k++) {
      cameraPoint(HOLD_NDC[0], HOLD_NDC[1], d, holdPos);
      const e = extent(holdPos, aimAt(holdPos, qTarget));
      const hShare = (e.y1 - e.y0) / 2;
      const wShare = (e.x1 - e.x0) / 2;
      d *= Math.max(hShare / SIZE, wShare / MAX_WIDTH);
    }
    dist = d;
    cameraPoint(HOLD_NDC[0], HOLD_NDC[1], dist, holdPos);
    cameraPoint(START_NDC[0], START_NDC[1], dist, startPos);
    aimAt(holdPos, qTarget);
  }

  // ---- Textures ------------------------------------------------------------------------
  const maxTex = renderer.capabilities.maxTextureSize;
  // Phones and small windows start on the 2k set and move up to 4k; desktops start on 4k
  // and move up to the 8k day and lights maps once the first frame is on screen.
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const phone = coarse && Math.min(window.screen.width, window.screen.height) < 600;
  const smallView = Math.max(window.innerWidth, window.innerHeight) < 1000;
  const firstTier: Tier = phone || smallView || maxTex < 4096 ? "2k" : "4k";
  const upgradeTier: Tier | null =
    firstTier === "2k" ? (maxTex >= 4096 ? "4k" : null) : maxTex >= 8192 && !coarse ? "8k" : null;
  const textures: THREE.Texture[] = [];
  const abort = new AbortController();

  async function loadSet(tier: Tier) {
    const urls = TEXTURES[tier];
    const withWater = !earthMat.uniforms.uWater.value && !!urls.water;
    const jobs = [loadImage(urls.day, abort.signal), loadImage(urls.lights, abort.signal)];
    if (withWater) jobs.push(loadImage(urls.water!, abort.signal));
    const [day, lights, water] = await Promise.all(jobs);
    if (disposed) return;
    // Read the size before the bitmap is closed below (a closed bitmap reports 0).
    const daySize = (day as { width: number }).width;
    const set = [makeTexture(T, day, "color", anisotropy), makeTexture(T, lights, "data", anisotropy)];
    if (water) set.push(makeTexture(T, water, "data", 4));
    set.forEach((t) => {
      renderer.initTexture(t);
      const img = t.image as unknown;
      if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) img.close();
    });
    const old = [earthMat.uniforms.uDay.value, earthMat.uniforms.uLights.value] as (THREE.Texture | null)[];
    earthMat.uniforms.uDay.value = set[0];
    earthMat.uniforms.uLights.value = set[1];
    earthMat.uniforms.uDaySize.value = daySize;
    if (set[2]) earthMat.uniforms.uWater.value = set[2];
    textures.push(...set);
    old.forEach((t) => {
      if (!t) return;
      t.dispose();
      textures.splice(textures.indexOf(t), 1);
    });
  }

  // ---- Frame -----------------------------------------------------------------------------
  let disposed = false;
  let wanted = false;
  let running = false;
  let ready = false;
  let raf = 0;
  let last = 0;
  let time = 0;
  let hover = 0;
  let hoverTo = 0;
  let statT = 0;
  let statN = 0;
  let avgMs = 0;
  const satPos = new T.Vector3();
  const out: SatFrame = { left: 0, right: 0, top: 0, bottom: 0, cy: 0, shown: false, settled: false };

  function draw(dt: number) {
    // Planet.
    qSpin.setFromAxisAngle(spinAxis, SPIN * time);
    qEarth.copy(qSpin).multiply(q0).invert();
    toEarth.setFromMatrix4(m4.makeRotationFromQuaternion(qEarth));

    // Satellite.
    const shown = time >= T_ENTER;
    sat.root.visible = shown;
    if (shown) {
      while (simT + STEP <= time) {
        stepAttitude(simT);
        simT += STEP;
      }
      const s = Math.min(1, (time - T_ENTER) / T_CROSS);
      const ease = 1 - Math.pow(1 - s, 1.9);
      satPos.lerpVectors(startPos, holdPos, ease);
      // A slight arc on the way in, then a few millimetres of drift at the hold.
      cameraPoint(0, 0.07 * Math.sin(Math.PI * ease), dist, tmp).sub(cameraPoint(0, 0, dist, tmp2));
      satPos.add(tmp);
      satPos.x += 0.004 * Math.sin(time * 0.37);
      satPos.y += 0.003 * Math.sin(time * 0.29 + 1);
      sat.root.position.copy(satPos);
      sat.root.quaternion.copy(q);
      const sight = smooth(T_SETTLED - 0.6, T_SETTLED + 1.8, time);
      coneOpacity.value = 0.6 * sight;
      fillOpacity.value = 0.1 * sight;
    }
    hover += (hoverTo - hover) * (1 - Math.exp(-dt * 10));
    sunLight.intensity = 4.2 * (1 + 0.3 * hover);
    earthLight.intensity = 1.9 * (1 + 1.2 * hover);
    satScene.environmentIntensity = 1 + 0.9 * hover;

    renderer.clear();
    renderer.render(earthScene, earthCam);
    if (shown) {
      renderer.clearDepth();
      renderer.render(satScene, satCam);
    }

    if (onFrame) {
      const e = extent(satPos, q);
      out.left = ((e.x0 + 1) / 2) * width;
      out.right = ((e.x1 + 1) / 2) * width;
      out.top = ((1 - e.y1) / 2) * height;
      out.bottom = ((1 - e.y0) / 2) * height;
      out.cy = (out.top + out.bottom) / 2;
      out.shown = shown;
      out.settled = time >= T_SETTLED;
      onFrame(out);
    }
  }

  function frame(now: number) {
    raf = 0;
    if (!running || disposed) return;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    if (last) {
      statT += now - last;
      statN++;
      if (statT > 1000) {
        avgMs = statT / statN;
        statT = 0;
        statN = 0;
      }
    }
    last = now;
    time += dt;
    draw(dt);
    raf = requestAnimationFrame(frame);
  }

  function setActive(next: boolean) {
    wanted = next;
    running = next && ready && !disposed && !failed;
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

  (async () => {
    try {
      await loadSet(firstTier);
      if (disposed || failed) return;
      draw(0);
      ready = true;
      setActive(wanted);
      // One frame so the canvas has painted before the poster fades.
      requestAnimationFrame(() => {
        if (!disposed && !failed) onReady?.();
      });
    } catch (err) {
      if (!disposed && !abort.signal.aborted) {
        console.warn("Orbit textures failed to load", err);
        fail();
      }
      return;
    }
    if (!upgradeTier) return;
    try {
      await loadSet(upgradeTier);
      if (!running && ready && !disposed) draw(0);
    } catch {
      // The first set is already on screen, so a failed upgrade changes nothing visible.
    }
  })();

  return {
    setActive,
    resize() {
      resize();
      if (ready && !running && !failed) draw(0);
    },
    hitTest(clientX, clientY) {
      if (!ready || !sat.root.visible) return false;
      const r = canvas.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, satCam);
      return raycaster.intersectObject(hitBox, false).length > 0;
    },
    setHover(on) {
      hoverTo = on ? 1 : 0;
    },
    frameMs: () => avgMs,
    dispose() {
      disposed = true;
      abort.abort();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      canvas.removeEventListener("webglcontextlost", onLost);
      textures.forEach((t) => t.dispose());
      tri.dispose();
      earthMat.dispose();
      sat.dispose();
      coneLineGeo.dispose();
      coneFillGeo.dispose();
      coneLineMat.dispose();
      coneFillMat.dispose();
      hitGeo.dispose();
      hitMat.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
