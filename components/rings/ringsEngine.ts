/*
  Accretion Rings: rings of light sweeping round a funnel, drawn live from one formula.
  The standalone version is ~/Documents/Code/accretion-rings; this is the same scene.

  Geometry. One family of ellipses describes every ring, from the top of the funnel to the
  red outer band. "a" is the ring's half-width in design px (the design frame is 2000 x 1000):
    centre x          XC
    centre y          yc(a), which rises into the funnel as a shrinks
    near half-height  bNear(a), the lower arc, seen from slightly above
    far half-height   bNear(a) * farRatio(a), taller, so the back of the disc looks bent up
  The same formulas are repeated in the vertex shader.

  Speed. Each ring turns at omega * (1 + surge * sin(rate * t + phase)). omega falls off with
  radius like an orbit (a^-1.5), lanes of rings run faster or slower than that, each ring has
  its own offset, and the surges roll across the disc as a slow wave.

  The canvas frames the design frame like CSS object-fit: cover with an object-position, so a
  poster picture of the same frame under the same rules lines up with it exactly.
*/

const XC = 200, YA = 565, A0 = 400, L = 171, A_OCC = 640;
const yc = (a: number) => YA * (1 - Math.exp(-(a - A0) / L));

// Radial profile, matched to the reference by eye.
//   a, colour (r g b), intensity, ring spacing (px), dot spacing on the near arc (px),
//   dot size (px), far-side brightness, chance a dot is a coloured speck
const KEYS: number[][] = [
  [225, .78, .84, 1.0, 1.2, 13, 9, 2.2, 1, .14],
  [520, .78, .84, 1.0, 1.3, 12, 8, 2.3, 1, .16],
  [600, .60, .70, .98, 1.1, 7, 7, 2.4, 1, .22],
  [760, .60, .70, .98, 1.0, 6, 6.5, 2.4, 1, .22],
  [860, .64, .72, .95, 0.9, 4.5, 5, 2.5, 1, .12],
  [940, .76, .82, .98, 1.0, 3.5, 3.2, 2.7, 1, .05],
  [985, .92, .94, 1.0, 1.5, 3, 2.6, 2.9, 1, .02],
  [1010, 1.0, 1.0, 1.0, 1.8, 2.6, 2.4, 3.0, 1, .005],
  [1100, 1.0, 1.0, 1.0, 1.8, 2.6, 2.4, 3.0, .9, .005],
  [1150, .85, .90, 1.0, 1.3, 2.8, 2.6, 2.9, .65, .01],
  [1210, .45, .64, 1.0, 1.0, 3, 3.4, 2.7, .5, .02],
  [1300, .36, .52, .98, .75, 3.2, 3.6, 2.6, .45, .03],
  [1350, .55, .50, .75, .45, 3.6, 3.8, 2.4, .4, .04],
  [1410, .20, .26, .45, .15, 7, 5, 2.0, .35, .04],
  [1470, .30, .48, .95, .55, 4, 3.8, 2.3, .35, .04],
  [1570, .28, .44, .92, .50, 4, 3.8, 2.3, .3, .04],
  [1608, .58, .76, 1.0, 1.2, 2.4, 3, 2.4, .3, .02],
  [1630, .32, .45, .85, .30, 5, 4.5, 2.0, .25, .04],
  [1720, .15, .18, .32, .10, 9, 6, 1.8, .2, .05],
  [1830, .40, .08, .06, .25, 5, 4, 2.2, .005, .03],
  [1950, .88, .14, .09, .70, 3.2, 3.2, 2.6, .005, .02],
  [2050, .95, .16, .10, .85, 2.8, 3, 2.8, .005, .02],
  [2120, .70, .11, .07, .50, 3.2, 3.2, 2.6, .005, .02],
  [2200, .25, .04, .03, .10, 6, 5, 2.2, .005, .02],
];
const A_MIN = KEYS[0][0];
const A_MAX = KEYS[KEYS.length - 1][0];

type Profile = { col: number[]; I: number; ringSp: number; nearSp: number; size: number; far: number; speck: number };
function profile(a: number): Profile {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] < a) i++;
  const k0 = KEYS[i], k1 = KEYS[i + 1];
  const t = Math.min(Math.max((a - k0[0]) / (k1[0] - k0[0]), 0), 1);
  const m = (j: number) => k0[j] + (k1[j] - k0[j]) * t;
  return { col: [m(1), m(2), m(3)], I: m(4), ringSp: m(5), nearSp: m(6), size: m(7), far: m(8), speck: m(9) };
}

// Accent rings: a few rings in each zone take another colour, as in the reference.
const ACCENTS = [
  { from: 560, to: 1000, list: [[1.0, .55, .45, .06], [.9, .3, .25, .03], [.95, .97, 1.0, .12]] },
  { from: 1150, to: 1400, list: [[.95, .50, .50, .05], [.35, .55, 1.0, .18]] },
  { from: 1400, to: 1720, list: [[.35, .55, 1.0, .20], [.9, .3, .25, .06]] },
  { from: 1830, to: 2200, list: [[1.0, .4, .15, .15]] },
];
const SPECKS = [[1, .35, .3], [1, .85, .4], [.45, .6, 1], [1, .55, .8], [1, 1, 1]];

/** Seeded random numbers, so every load draws the same rings. */
function mulberry32(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

type Ring = {
  a: number; n: number; col: number[]; p: Profile; grain: number; I: number;
  omega: number; surge: number; rate: number; sphase: number; drop: number;
  k1: number; p1: number; m1: number; k2: number; p2: number; m2: number; k3: number; p3: number; g3: number;
};

// Per dot: a, omega, far, surge | theta0, intensity, size, phase | rate, surge phase | rgba8
const STRIDE = 44;
const F = STRIDE / 4;

/**
 * Builds every dot. Yields between rings once a slice of work has run, so the page stays
 * responsive while about 900k dots are laid out.
 */
async function buildDots(seed: number, density: number, alive: () => boolean) {
  const rnd = mulberry32(seed);
  // Smooth speed lanes across the disc: about 0.6x to 1.65x the orbital rate.
  const lane = (a: number) => Math.exp(0.5 * (0.6 * Math.sin(a / 41 + 1.3) + 0.4 * Math.sin(a / 113 + 4.1)));
  const rings: Ring[] = [];
  let a = A_MIN;
  while (a < A_MAX) {
    const pr = profile(a);
    // Space rings evenly along the curve their right-hand tips trace.
    const slope = (YA / L) * Math.exp(-(a - A0) / L);
    a += (pr.ringSp / Math.hypot(1, slope)) * (0.55 + 0.9 * rnd());
    if (a >= A_MAX) break;
    const p = profile(a);
    let col = p.col.map((v) => v * (0.92 + 0.16 * rnd()));
    for (const z of ACCENTS) {
      if (a < z.from || a > z.to) continue;
      let r = rnd();
      for (const c of z.list) {
        if (r < c[3]) { col = c.slice(0, 3); break; }
        r -= c[3];
      }
    }
    const n = Math.max(24, Math.floor((6.283185 * a) / (p.nearSp / density)));
    const gappy = rnd() < 0.45;
    rings.push({
      a, n, col, p, grain: 1 - smooth(900, 1000, a),
      I: (p.I / density) * (a < 940 ? 0.45 + 0.9 * rnd() : 0.3 + 1.1 * Math.pow(rnd(), 1.4)),
      omega: 0.025 * Math.pow(a / 1052, -1.5) * lane(a) * (0.8 + 0.4 * rnd()) * (rnd() < 0.05 ? 1.8 : 1),
      surge: 0.2 + 0.3 * rnd(),
      rate: 6.283185 / (14 + 22 * (0.5 + 0.5 * Math.sin(a / 97 + 2)) + 4 * rnd()),
      sphase: a / 55 + 0.6 * rnd(),
      drop: 0.25 * rnd() * rnd(),
      // Smooth brightness along the ring, so trails have bright runs and gaps that travel.
      k1: 1 + Math.floor(rnd() * 3), p1: rnd() * 6.283, m1: 0.45 * rnd(),
      k2: 2 + Math.floor(rnd() * 6), p2: rnd() * 6.283, m2: 0.3 * rnd(),
      k3: gappy ? 1 + Math.floor(rnd() * 5) : 0, p3: rnd() * 6.283, g3: 0.6 + 0.35 * rnd(),
    });
  }
  let total = 0;
  for (const r of rings) total += r.n;
  const buf = new ArrayBuffer(total * STRIDE);
  const f32 = new Float32Array(buf);
  const u8 = new Uint8Array(buf);
  let count = 0;
  let sliceStart = performance.now();
  for (const r of rings) {
    if (performance.now() - sliceStart > 8) {
      await new Promise((res) => setTimeout(res, 0));
      if (!alive()) return null;
      sliceStart = performance.now();
    }
    const step = 6.283185307 / r.n;
    for (let i = 0; i < r.n; i++) {
      if (rnd() < r.drop) continue;
      const th = (i + (rnd() - 0.5) * 0.5) * step;
      let mod = (1 - r.m1 + r.m1 * Math.sin(r.k1 * th + r.p1)) * (1 - r.m2 + r.m2 * Math.sin(r.k2 * th + r.p2));
      if (r.k3) mod *= 1 - smooth(r.g3 - 0.2, r.g3, Math.sin(r.k3 * th + r.p3));
      if (mod < 0.02) continue;
      let c = r.col;
      let speck = 1;
      if (rnd() < r.p.speck) {
        c = SPECKS[Math.floor(rnd() * SPECKS.length)];
        speck = 1.6;
      }
      const o = count * F;
      f32[o] = r.a; f32[o + 1] = r.omega; f32[o + 2] = r.p.far; f32[o + 3] = r.surge;
      f32[o + 4] = th;
      // Inner rings get a wider spread of dot brightness, so their near arcs read as dotted trails.
      const rr = rnd();
      f32[o + 5] = r.I * mod * speck * (r.grain * (0.5 + rr) + (1 - r.grain) * (0.85 + 0.3 * rr));
      f32[o + 6] = r.p.size * (0.85 + 0.3 * rnd());
      f32[o + 7] = rnd();
      f32[o + 8] = r.rate; f32[o + 9] = r.sphase;
      const ob = o * 4 + 40;
      u8[ob] = Math.min(255, c[0] * 255 * (0.9 + 0.2 * rnd()));
      u8[ob + 1] = Math.min(255, c[1] * 255 * (0.9 + 0.2 * rnd()));
      u8[ob + 2] = Math.min(255, c[2] * 255 * (0.9 + 0.2 * rnd()));
      u8[ob + 3] = 255;
      count++;
    }
  }
  return { buf, count };
}

function buildStars(seed: number) {
  const rnd = mulberry32(seed + 101);
  const N = 4200, stride = 24;
  const buf = new ArrayBuffer(N * stride);
  const f32 = new Float32Array(buf);
  const u8 = new Uint8Array(buf);
  const tints = [[1, 1, 1], [.75, .82, 1], [1, .85, .9], [.85, .9, 1], [1, .95, .8]];
  for (let i = 0; i < N; i++) {
    const o = i * 6;
    f32[o] = -150 + 2300 * rnd();
    f32[o + 1] = -950 + 2700 * rnd();
    const big = rnd() < 0.04;
    f32[o + 2] = big ? 1.6 + rnd() * 1.2 : 0.9 + rnd() * 0.8;
    f32[o + 3] = big ? 2.2 : 0.6 + 1.4 * Math.pow(rnd(), 2);
    f32[o + 4] = rnd();
    const t = tints[Math.floor(rnd() * tints.length)];
    const ob = o * 4 + 20;
    u8[ob] = t[0] * 255; u8[ob + 1] = t[1] * 255; u8[ob + 2] = t[2] * 255; u8[ob + 3] = 255;
  }
  return { buf, count: N, stride };
}

const GEOM_GLSL = `
const float XC = ${XC.toFixed(1)}, YA = ${YA.toFixed(1)}, A0 = ${A0.toFixed(1)}, L = ${L.toFixed(1)}, A_OCC = ${A_OCC.toFixed(1)};
float yc(float a) { return YA * (1.0 - exp(-(a - A0) / L)); }
float softplus(float x) { return x > 30.0 ? x : log(1.0 + exp(x)); }
float bNear(float a) { return 0.233 * a - 0.167 * 60.0 * softplus((a - 1052.0) / 60.0); }
float farRatio(float a) { return 1.24 + 0.14 * clamp((a - 1052.0) / 1000.0, 0.0, 1.2); }
// Far arc profile: a little boxier than an ellipse, with a finite slope at the tips.
float farShape(float u) { return (pow(u + 0.25, 0.8) - 0.3299) / 0.8651; }
// Inside the opaque funnel: left of the silhouette traced by the rings' right-hand tips,
// or inside the near arc of the funnel's base ring.
bool inFunnel(vec2 p) {
  float yo = yc(A_OCC);
  float dx = abs(p.x - XC);
  if (p.y < yo) return dx < A0 - L * log((YA - p.y) / YA);
  float t = dx / A_OCC;
  if (t >= 1.0) return false;
  return p.y < yo + bNear(A_OCC) * sqrt(1.0 - t * t);
}
// Inside the disc: under the red band's near arc, or under the outer blue ring's far arc.
// Stars only show outside this and the funnel.
bool inDisc(vec2 p) {
  const float A_NEAR = 2230.0, A_FAR = 1700.0;
  float dx = p.x - XC;
  if (p.y >= yc(A_NEAR)) {
    float t = dx / A_NEAR;
    return abs(t) < 1.0 && p.y < yc(A_NEAR) + bNear(A_NEAR) * sqrt(1.0 - t * t);
  }
  float t = dx / A_FAR;
  return abs(t) < 1.0 && p.y > yc(A_FAR) - bNear(A_FAR) * farRatio(A_FAR) * farShape(sqrt(1.0 - t * t));
}
uniform vec4 uView;   // visible window: centre x, centre y, 2/width, 2/height (design px)
uniform float uPx;    // device px per design px
vec4 toClip(vec2 p) { return vec4((p.x - uView.x) * uView.z, -(p.y - uView.y) * uView.w, 0.0, 1.0); }
`;

const DOT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aRing;   // a, omega, far-side brightness, surge
layout(location = 1) in vec4 aDot;    // theta0, intensity, size, phase
layout(location = 2) in vec2 aWave;   // surge rate, surge phase
layout(location = 3) in vec4 aCol;
uniform float uTime, uTwinkle;
out vec3 vCol;
${GEOM_GLSL}
void main() {
  float a = aRing.x;
  // Angle turned so far: the integral of omega * (1 + surge * sin(rate * t + phase)).
  float turned = uTime + aRing.w / aWave.x * (cos(aWave.y) - cos(aWave.x * uTime + aWave.y));
  float th = aDot.x - aRing.y * turned;
  float c = cos(th), s = sin(th);
  float b = bNear(a);
  vec2 p = vec2(XC + a * c, yc(a));
  float bright = aDot.y;
  if (s >= 0.0) {
    p.y += b * s;
  } else {
    p.y -= b * farRatio(a) * farShape(-s);
    // Rings with a dim far side (the red band) fade out sooner past their tips.
    bright *= mix(1.0, aRing.z, smoothstep(0.0, mix(0.25, 0.7, aRing.z), -s));
    if (inFunnel(p)) bright = 0.0;
  }
  bright *= 1.0 + uTwinkle * sin(uTime * (0.8 + 2.2 * aDot.w) + aDot.w * 60.0);
  float sz = aDot.z * uPx;
  float szc = max(sz, 1.0);
  bright *= (sz * sz) / (szc * szc);
  gl_PointSize = szc;
  gl_Position = bright > 0.0 ? toClip(p) : vec4(2.0, 2.0, 2.0, 1.0);
  vCol = aCol.rgb * bright;
}`;

const STAR_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aStar;  // x, y, size, brightness
layout(location = 1) in float aPhase;
layout(location = 2) in vec4 aCol;
uniform float uTime;
out vec3 vCol;
${GEOM_GLSL}
void main() {
  vec2 p = aStar.xy;
  float bright = aStar.w * (0.75 + 0.25 * sin(uTime * (0.5 + aPhase) + aPhase * 40.0));
  if (inFunnel(p) || inDisc(p)) bright = 0.0;
  float sz = aStar.z * uPx;
  float szc = max(sz, 1.0);
  bright *= (sz * sz) / (szc * szc);
  gl_PointSize = szc;
  gl_Position = bright > 0.0 ? toClip(p) : vec4(2.0, 2.0, 2.0, 1.0);
  vCol = aCol.rgb * bright;
}`;

const POINT_FS = `#version 300 es
precision mediump float;
in vec3 vCol;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float f = exp(-dot(d, d) * 5.5);
  o = vec4(vCol * f, 1.0);
}`;

const QUAD_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const DOWN_FS = `#version 300 es
precision mediump float;
uniform sampler2D uSrc; uniform vec2 uTexel;
in vec2 vUv; out vec4 o;
void main() {
  vec3 c = texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  o = vec4(c * 0.25, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision mediump float;
uniform sampler2D uSrc; uniform vec2 uDir;
in vec2 vUv; out vec4 o;
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 0.2270270270;
  c += (texture(uSrc, vUv + uDir * 1.3846153846).rgb + texture(uSrc, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
  c += (texture(uSrc, vUv + uDir * 3.2307692308).rgb + texture(uSrc, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
  o = vec4(c, 1.0);
}`;

const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene, uB1, uB2;
uniform float uBloom, uExposure;
in vec2 vUv; out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  c += uBloom * (0.55 * texture(uB1, vUv).rgb + 0.45 * texture(uB2, vUv).rgb);
  c = 1.0 - exp(-c * uExposure);
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

type Program = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
type Target = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number };

export type RingsOptions = {
  /** Like CSS object-position, as fractions: where the crop sits when the frame is cut. */
  position?: [number, number];
  /** Dots per ring, 1 = full. Brightness is kept the same. */
  density?: number;
  seed?: number;
  bloom?: number;
  exposure?: number;
  twinkle?: number;
  /** Keep the drawing buffer, for reading frames back (tests and posters). */
  keepFrames?: boolean;
  /** Called once the dots are built and uploaded. */
  onReady?: () => void;
};

export class RingsEngine {
  readonly ok: boolean;
  ready = false;
  private gl!: WebGL2RenderingContext;
  private hdr = false;
  private progs!: Record<"dots" | "stars" | "down" | "blur" | "comp", Program>;
  private vaoDots: WebGLVertexArrayObject | null = null;
  private vaoStars: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private dotCount = 0;
  private starCount = 0;
  private T: Record<"scene" | "h2" | "q4" | "q4b" | "e8" | "e8b", Target> | null = null;
  private view = { cx: 1000, cy: 500, w: 2000, h: 1000, k: 1, dpr: 1 };
  private opts: Required<Omit<RingsOptions, "onReady">> & Pick<RingsOptions, "onReady">;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, options: RingsOptions = {}) {
    this.opts = {
      position: [0.5, 0.5], density: 1, seed: 7, bloom: 1.3, exposure: 1, twinkle: 0.12, keepFrames: false,
      ...options,
    };
    const gl = canvas.getContext("webgl2", {
      antialias: false, alpha: false, depth: false, premultipliedAlpha: false,
      preserveDrawingBuffer: this.opts.keepFrames, powerPreference: "high-performance",
    });
    if (!gl) {
      this.ok = false;
      return;
    }
    this.gl = gl;
    this.hdr = !!gl.getExtension("EXT_color_buffer_float");
    try {
      this.progs = {
        dots: this.program(DOT_VS, POINT_FS),
        stars: this.program(STAR_VS, POINT_FS),
        down: this.program(QUAD_VS, DOWN_FS),
        blur: this.program(QUAD_VS, BLUR_FS),
        comp: this.program(QUAD_VS, COMP_FS),
      };
    } catch {
      this.ok = false;
      return;
    }
    this.ok = true;

    const stars = buildStars(this.opts.seed);
    this.vaoStars = gl.createVertexArray();
    gl.bindVertexArray(this.vaoStars);
    this.upload(stars.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stars.stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stars.stride, 16);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, stars.stride, 20);
    gl.bindVertexArray(null);
    this.starCount = stars.count;

    this.resize();
    void buildDots(this.opts.seed, this.opts.density, () => !this.disposed).then((d) => {
      if (!d || this.disposed) return;
      this.vaoDots = gl.createVertexArray();
      gl.bindVertexArray(this.vaoDots);
      this.upload(d.buf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, STRIDE, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE, 16);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 32);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, STRIDE, 40);
      gl.bindVertexArray(null);
      this.dotCount = d.count;
      this.ready = true;
      this.opts.onReady?.();
    });
  }

  private upload(data: ArrayBuffer) {
    const gl = this.gl;
    const b = gl.createBuffer();
    if (!b) return;
    this.buffers.push(b);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }

  private program(vs: string, fs: string): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error("shader");
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram();
    if (!p) throw new Error("program");
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    const u: Program["u"] = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      if (info) u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }

  private freeTargets() {
    if (!this.T) return;
    for (const t of Object.values(this.T)) {
      this.gl.deleteTexture(t.tex);
      this.gl.deleteFramebuffer(t.fb);
    }
    this.T = null;
  }

  /** Match the canvas to its box. Frames the design frame like object-fit: cover. */
  resize() {
    if (!this.ok) return;
    const W = Math.max(1, this.canvas.clientWidth), H = Math.max(1, this.canvas.clientHeight);
    const k = Math.max(W / 2000, H / 1000);
    const w = W / k, h = H / k;
    const [px, py] = this.opts.position;
    const v = this.view;
    v.k = k; v.w = w; v.h = h;
    v.cx = w / 2 + (2000 - w) * px;
    v.cy = h / 2 + (1000 - h) * py;
    v.dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(9e6 / (W * H)));
    const cw = Math.round(W * v.dpr), ch = Math.round(H * v.dpr);
    if (this.canvas.width === cw && this.canvas.height === ch && this.T) return;
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.freeTargets();
    const at = (shift: number) => this.target(Math.max(1, cw >> shift), Math.max(1, ch >> shift));
    this.T = { scene: at(0), h2: at(1), q4: at(2), q4b: at(2), e8: at(3), e8b: at(3) };
  }

  private pass(prog: Program, dst: Target | null, setup: (u: Program["u"]) => void) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, dst ? dst.w : this.canvas.width, dst ? dst.h : this.canvas.height);
    gl.useProgram(prog.p);
    setup(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bindTex(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  /** Draws the scene at time t, in seconds. */
  draw(t: number) {
    if (!this.ok || !this.T || this.disposed) return;
    const gl = this.gl;
    const { scene: S, h2, q4, q4b, e8, e8b } = this.T;
    const { dots, stars, down, blur, comp } = this.progs;
    const v = this.view;
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
    gl.viewport(0, 0, S.w, S.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    const setView = (u: Program["u"]) => {
      gl.uniform4f(u.uView, v.cx, v.cy, 2 / v.w, 2 / v.h);
      gl.uniform1f(u.uPx, v.k * v.dpr);
      gl.uniform1f(u.uTime, t);
    };
    gl.useProgram(stars.p);
    setView(stars.u);
    gl.bindVertexArray(this.vaoStars);
    gl.drawArrays(gl.POINTS, 0, this.starCount);

    if (this.vaoDots) {
      gl.useProgram(dots.p);
      setView(dots.u);
      gl.uniform1f(dots.u.uTwinkle, this.opts.twinkle);
      gl.bindVertexArray(this.vaoDots);
      gl.drawArrays(gl.POINTS, 0, this.dotCount);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    // Bloom: scene -> 1/2 -> 1/4 (blur) -> 1/8 (blur)
    this.pass(down, h2, (u) => { this.bindTex(0, S.tex, u.uSrc); gl.uniform2f(u.uTexel, 0.5 / S.w, 0.5 / S.h); });
    this.pass(down, q4, (u) => { this.bindTex(0, h2.tex, u.uSrc); gl.uniform2f(u.uTexel, 0.5 / h2.w, 0.5 / h2.h); });
    this.pass(blur, q4b, (u) => { this.bindTex(0, q4.tex, u.uSrc); gl.uniform2f(u.uDir, 1 / q4.w, 0); });
    this.pass(blur, q4, (u) => { this.bindTex(0, q4b.tex, u.uSrc); gl.uniform2f(u.uDir, 0, 1 / q4.h); });
    this.pass(down, e8, (u) => { this.bindTex(0, q4.tex, u.uSrc); gl.uniform2f(u.uTexel, 0.5 / q4.w, 0.5 / q4.h); });
    this.pass(blur, e8b, (u) => { this.bindTex(0, e8.tex, u.uSrc); gl.uniform2f(u.uDir, 1.5 / e8.w, 0); });
    this.pass(blur, e8, (u) => { this.bindTex(0, e8b.tex, u.uSrc); gl.uniform2f(u.uDir, 0, 1.5 / e8.h); });

    this.pass(comp, null, (u) => {
      this.bindTex(0, S.tex, u.uScene);
      this.bindTex(1, q4.tex, u.uB1);
      this.bindTex(2, e8.tex, u.uB2);
      gl.uniform1f(u.uBloom, this.opts.bloom);
      gl.uniform1f(u.uExposure, this.opts.exposure);
    });
  }

  dispose() {
    this.disposed = true;
    if (!this.ok) return;
    const gl = this.gl;
    this.freeTargets();
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.vaoDots) gl.deleteVertexArray(this.vaoDots);
    if (this.vaoStars) gl.deleteVertexArray(this.vaoStars);
    for (const p of Object.values(this.progs)) gl.deleteProgram(p.p);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
