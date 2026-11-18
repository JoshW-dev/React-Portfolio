import { ALT, CAPTURE, HORIZON_Y, SUN_AZ, SUN_EL, captureView } from "./orbitFrame";

/*
  Earth's curvature drawn in lines, shown while the live planet (orbitScene.ts) loads.

  The planet needs three.js and a few MB of textures, which take seconds on a cold load. This
  draws the same planet first from nothing but maths, through the same camera, so the horizon
  sits exactly where the planet's will and the planet can fade up over it.

  Lines. Each line is a circle of "latitude" about the planet's spin axis, the axis the film's
  planet turns about, which points back at the camera. Seen from orbit these circles are the
  arcs that stack up toward the horizon and bend down at the sides: the curvature itself. The
  lines are even steps of that latitude, so perspective packs them tighter toward the horizon.
  Only the part of each circle that faces the camera gets dots, as many as its length needs.

  Motion. Dots run along their circles right to left, the way the ground drifts. Each line has
  its own pace (bands, a per-line offset and a slow surge), as the rings on the Eigenvirtue
  page do. They are on and moving from the first frame.

  Light. The sun is the planet's own (low, to the left): blue and white on the day side, a warm
  band along the line between day and night, and the lights of towns on the night side. A thin
  atmosphere glows along the horizon.

  Cost. No vertex buffers and no textures: every dot's place comes from its index
  (gl_VertexID). The first frame costs a shader compile.

  Thread. The class takes a canvas or an OffscreenCanvas and reads nothing from the page, so
  earthLines.worker.ts can run it off the main thread (see linesHost.ts). Then the planet's
  loading (three.js, its textures, its shaders) can't stall the lines while they show.
*/

const DOT_VS = `#version 300 es
precision highp float;
uniform int uDots;        // dots on the longest line; shorter lines use fewer
uniform int uLines;
uniform vec2 uBeta;       // latitude of the farthest (horizon) and nearest line, radians
uniform float uTime, uPx, uOmega, uGain, uStreak;
uniform vec2 uViewPx;     // canvas size, device px
uniform mat3 uToCam;      // world to camera
uniform vec3 uCam;        // camera position, Earth radii
uniform vec4 uProj;       // camera space to screen: x scale, y scale, y offset, unused
uniform vec3 uSun;
uniform vec2 uWipe;      // the real planet's wipe: front y on screen, glow strength
out vec3 vCol;
flat out vec2 vDir;       // streak direction on screen
flat out float vLen, vSz; // streak length and dot size, device px

const float PI = 3.14159265;
float hash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }

void cull() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0;
  vCol = vec3(0.0); vDir = vec2(1.0, 0.0); vLen = 0.0; vSz = 1.0;
}
vec2 toScreen(vec3 P, out float w) {
  vec3 v = uToCam * (P - uCam);
  w = -v.z;
  return vec2(v.x / w * uProj.x, v.y / w * uProj.y + uProj.z);
}

void main() {
  int line = gl_VertexID / uDots;
  int k = gl_VertexID - line * uDots;
  float fl = float(line);
  float u = (fl + 0.5) / float(uLines);           // 0 at the horizon, 1 nearest
  float beta = mix(uBeta.x, uBeta.y, u + (hash(fl) - 0.5) * 0.6 / float(uLines));
  float r = cos(beta), z = sin(beta);

  // The part of the circle on the near side of the planet: P.C > 1, so r sin(phi) > 1 / C.y.
  float phiA = asin(clamp(1.0 / (uCam.y * r), 0.0, 1.0));
  float span = PI - 2.0 * phiA;
  float n = max(6.0, floor(float(uDots) * span * r / (PI - 2.0 * asin(1.0 / uCam.y))));
  if (float(k) >= n) { cull(); return; }

  // Pace: bands of faster and slower lines, an offset per line, a slow surge.
  float h1 = hash(fl * 1.7 + 3.1), h2 = hash(fl * 2.3 + 7.7), h3 = hash(fl * 3.9 + 1.3);
  float lane = exp(0.5 * (0.6 * sin(beta * 31.0 + 1.3) + 0.4 * sin(beta * 83.0 + 4.1)));
  float omega = uOmega * lane * (0.85 + 0.3 * h1);
  float rate = 2.0 * PI / mix(14.0, 40.0, h2);
  float ph = beta * 18.0 + 2.0 * PI * h3;
  float surge = 0.35;
  float turned = omega * (uTime + surge / rate * (cos(ph) - cos(rate * uTime + ph)));
  float f = fract((float(k) + 0.5) / n + h3 + turned / span);
  float phi = phiA + span * f;
  vec3 P = vec3(r * cos(phi), r * sin(phi), z);

  float facing = dot(P, uCam) - 1.0;
  float w;
  vec2 ndc = toScreen(P, w);
  if (facing <= 0.0 || w < 1e-4) { cull(); return; }

  // A short streak along the way the dot is going (where it will be uStreak seconds on), so
  // fast dots read as motion and never flicker between frames.
  float speed = omega * (1.0 + surge * sin(rate * uTime + ph));
  float w2;
  vec2 ndc2 = toScreen(vec3(r * cos(phi + speed * uStreak), r * sin(phi + speed * uStreak), z), w2);
  vec2 dpx = (ndc2 - ndc) * 0.5 * uViewPx;
  float dl = length(dpx);
  float len = min(dl, 30.0 * uPx);

  // Dots fade as they reach the horizon, where they wrap round.
  float bright = smoothstep(0.0, 0.012, facing);
  // As the real planet wipes up over the lines, the lines just ahead of its edge light up.
  bright *= 1.0 + 2.4 * uWipe.y * exp(-pow((ndc.y - uWipe.x - 0.04) / 0.07, 2.0));
  // A few bright lines among many faint ones, in loose bands, so each line reads on its own.
  float band = 0.6 + 0.4 * sin(beta * 47.0 + 2.0) * sin(beta * 13.0 + 0.7);
  bright *= (0.18 + 2.6 * pow(hash(fl * 5.3 + 9.1), 3.0)) * band;
  // Brighter runs along each line travel with its dots, so the turning shows even where the
  // dots blur into one line, and each dot varies a little on its own.
  float runs = floor(mix(4.0, 12.0, h2));
  float g = 0.5 + 0.5 * sin(2.0 * PI * (runs * (float(k) + 0.5) / n + h1));
  bright *= (0.2 + 1.7 * g * g * g) * (0.6 + 0.8 * hash(fl * 3.7 + float(k) * 0.731));

  // Light from the planet's own sun.
  float l = dot(P, uSun);
  float day = smoothstep(-0.03, 0.45, l);
  vec3 col = mix(vec3(0.34, 0.54, 1.0), vec3(0.95, 0.97, 1.0), smoothstep(0.1, 0.55, l)) * (0.12 + 1.5 * day);
  col += vec3(1.0, 0.42, 0.18) * 1.1 * exp(-pow((l - 0.015) / 0.055, 2.0));
  float hs = hash(fl * 7.13 + float(k) * 1.618);
  float night = smoothstep(0.0, -0.06, l);
  col += vec3(0.07, 0.09, 0.2) * night;
  if (hs < 0.07) col += vec3(1.0, 0.68, 0.34) * 1.3 * night;
  else col *= mix(1.0, 0.45, night);
  // Coloured specks on the day side, as on the Eigenvirtue rings.
  if (hs > 0.975) col = mix(col, (hs > 0.99 ? vec3(1.0, 0.45, 0.4) : vec3(0.45, 0.7, 1.0)) * 1.6, day);

  float dist = length(P - uCam);
  float sz = uPx * 2.1 * clamp(0.42 / dist, 0.8, 1.8);
  float szc = max(sz, 1.0);
  // The same light whether a dot is still or drawn out into a streak.
  bright *= (sz * sz) / (szc * szc) * szc / (szc + len);
  gl_PointSize = szc + len;
  gl_Position = vec4(ndc, 0.0, 1.0);
  vCol = col * bright * uGain;
  vDir = dl > 1e-3 ? dpx / dl : vec2(1.0, 0.0);
  vLen = len;
  vSz = szc;
}`;

const POINT_FS = `#version 300 es
precision mediump float;
in vec3 vCol;
flat in vec2 vDir;
flat in float vLen, vSz;
out vec4 o;
void main() {
  // Distance from the streak's centre line, in dot widths (point coords run down the screen).
  vec2 p = (gl_PointCoord - 0.5) * (vSz + vLen) * vec2(1.0, -1.0);
  float a = clamp(dot(p, vDir), -0.5 * vLen, 0.5 * vLen);
  vec2 d = (p - a * vDir) / vSz;
  o = vec4(vCol * exp(-dot(d, d) * 5.5), 1.0);
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

// The atmosphere is worked out per pixel from the ray's closest pass to the planet's centre.
const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene, uBloom;
uniform mat3 uToWorld;    // camera to world
uniform vec3 uCam, uSun;
uniform vec4 uInv;        // screen to camera: x scale, y scale, y offset, unused
in vec2 vUv; out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture(uScene, vUv).rgb + 1.1 * texture(uBloom, vUv).rgb;

  vec2 s = vUv * 2.0 - 1.0;
  vec3 d = normalize(uToWorld * vec3(s.x * uInv.x, s.y * uInv.y + uInv.z, -1.0));
  float b = dot(uCam, d);
  if (b < 0.0) {
    float miss = sqrt(max(dot(uCam, uCam) - b * b, 0.0)) - 1.0;
    vec3 q = normalize(uCam - d * b);
    float l = dot(q, uSun);
    vec3 tint = mix(vec3(1.0, 0.62, 0.28), vec3(0.55, 0.75, 1.0), smoothstep(0.02, 0.3, l));
    tint *= smoothstep(-0.14, 0.03, l) * (0.55 + 0.45 * smoothstep(0.0, 0.4, l));
    float glow = miss > 0.0
      ? exp(-miss / 0.004) * 1.1 + exp(-miss / 0.03) * 0.22
      : exp(miss / 0.003) * 0.7;
    c += tint * glow;
  }

  c = 1.0 - exp(-c * 1.15);
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

type Program = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
type Target = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number };

export type EarthLinesOptions = {
  /** 1 = full dot count; phones use less. */
  density?: number;
  /** Keep the drawing buffer, for reading frames back in tests. */
  keepFrames?: boolean;
};

/** Screen y (-1 bottom to 1 top) of the top of the horizon on a screen of this size. */
export function horizonTopFor(cssW: number, cssH: number) {
  const { viewH } = captureView(Math.max(1, cssW) / Math.max(1, cssH));
  return HORIZON_Y * (CAPTURE.height / viewH) - (CAPTURE.height - CAPTURE.clipRows) / viewH;
}

const LINES = 240;
const DOTS = 900;
/** Base pace along the circles, radians a second (the live planet drifts at 0.007). */
const OMEGA = 0.045;
/** Streak length, as seconds of each dot's own motion. */
const STREAK = 0.03;

export class EarthLines {
  readonly ok: boolean;
  private gl!: WebGL2RenderingContext;
  private hdr = false;
  private progs!: Record<"dots" | "down" | "blur" | "comp", Program>;
  private vao: WebGLVertexArrayObject | null = null;
  private T: Record<"scene" | "h2" | "q4" | "q4b", Target> | null = null;
  private dots: number;
  private dpr = 1;
  private disposed = false;
  // Camera, recomputed on resize.
  private toCam = new Float32Array(9);
  private toWorld = new Float32Array(9);
  private proj = new Float32Array(4);
  private inv = new Float32Array(4);
  private beta = new Float32Array(2);
  private top = 0;
  private wipe = new Float32Array([-2, 0]);
  private readonly cam = new Float32Array([0, 1 + ALT, 0]);
  private readonly sun: Float32Array;

  constructor(private canvas: HTMLCanvasElement | OffscreenCanvas, options: EarthLinesOptions = {}) {
    this.dots = Math.max(200, Math.round(DOTS * (options.density ?? 1)));
    const az = (SUN_AZ * Math.PI) / 180;
    const el = (SUN_EL * Math.PI) / 180;
    // World frame at the start point: up +Y, north -Z, east +X (as orbitScene.ts).
    this.sun = new Float32Array([Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]);
    // Both kinds of canvas take the same call; the cast only picks one of TypeScript's overloads.
    const gl = (canvas as OffscreenCanvas).getContext("webgl2", {
      antialias: false, alpha: false, depth: false, premultipliedAlpha: false,
      preserveDrawingBuffer: !!options.keepFrames, powerPreference: "high-performance",
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      this.ok = false;
      return;
    }
    this.gl = gl;
    this.hdr = !!gl.getExtension("EXT_color_buffer_float");
    try {
      this.progs = {
        dots: this.program(DOT_VS, POINT_FS),
        down: this.program(QUAD_VS, DOWN_FS),
        blur: this.program(QUAD_VS, BLUR_FS),
        comp: this.program(QUAD_VS, COMP_FS),
      };
    } catch {
      this.ok = false;
      return;
    }
    // WebGL 2 draws with no attributes at all; an empty vertex array keeps drivers happy.
    this.vao = gl.createVertexArray();
    this.ok = true;
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

  /**
   * Match the canvas to its box (CSS pixels, and the screen's pixel ratio), and frame the
   * planet as the live scene frames it. Call it before the first draw.
   */
  resize(cssW: number, cssH: number, pixelRatio: number) {
    if (!this.ok) return;
    const W = Math.max(1, cssW), H = Math.max(1, cssH);
    const aspect = W / H;
    const { viewW, viewH, pitch } = captureView(aspect);
    const ty = Math.tan((CAPTURE.fov * Math.PI) / 360);
    const capAspect = CAPTURE.width / CAPTURE.height;
    // Camera space to the capture frame's NDC, then to this screen's crop of it.
    const sx = CAPTURE.width / viewW, sy = CAPTURE.height / viewH;
    const oy = -(CAPTURE.height - CAPTURE.clipRows) / viewH;
    this.proj.set([sx / (ty * capAspect), sy / ty, oy, 0]);
    this.inv.set([(ty * capAspect) / sx, ty / sy, (-oy * ty) / sy, 0]);
    // Pitched down about x: world = Rx(-pitch) * camera. Column-major for uniformMatrix3fv.
    const c = Math.cos(pitch), s = Math.sin(pitch);
    this.toWorld.set([1, 0, 0, 0, c, -s, 0, s, c]);
    this.toCam.set([1, 0, 0, 0, c, s, 0, -s, c]);
    // Lines run from the horizon to just past the bottom of the screen on the centre line:
    // cast the ray through the bottom edge and find where it meets the planet.
    const cy = 1 + ALT;
    const yCam = -this.inv[1] + this.inv[2] - 0.02;
    const len = Math.hypot(yCam, 1);
    const ry = (c * yCam - s) / len;
    const rz = (-s * yCam - c) / len;
    const b = cy * ry;
    const hit = -b - Math.sqrt(Math.max(b * b - (cy * cy - 1), 0));
    this.beta.set([-Math.acos(1 / cy), Math.asin(Math.max(-1, Math.min(1, hit * rz)))]);
    this.top = horizonTopFor(W, H);

    const v = this.canvas;
    this.dpr = Math.min(pixelRatio || 1, 2, Math.sqrt(4.5e6 / (W * H)));
    const cw = Math.round(W * this.dpr), ch = Math.round(H * this.dpr);
    if (v.width === cw && v.height === ch && this.T) return;
    v.width = cw;
    v.height = ch;
    this.freeTargets();
    const at = (shift: number) => this.target(Math.max(1, cw >> shift), Math.max(1, ch >> shift));
    this.T = { scene: at(0), h2: at(1), q4: at(2), q4b: at(2) };
  }

  private pass(prog: Program, dst: Target | null, setup: (u: Program["u"]) => void) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, dst ? dst.w : this.canvas.width, dst ? dst.h : this.canvas.height);
    gl.useProgram(prog.p);
    setup(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Draw the frame at t seconds from the start. */
  draw(t: number) {
    if (!this.ok || this.disposed || !this.T) return;
    const gl = this.gl;
    const T = this.T;
    const D = this.progs.dots;

    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fb);
    gl.viewport(0, 0, T.scene.w, T.scene.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(D.p);
    gl.uniform1i(D.u.uDots, this.dots);
    gl.uniform1i(D.u.uLines, LINES);
    gl.uniform2fv(D.u.uBeta, this.beta);
    gl.uniform1f(D.u.uTime, t);
    gl.uniform1f(D.u.uPx, this.dpr);
    gl.uniform1f(D.u.uOmega, OMEGA);
    gl.uniform1f(D.u.uStreak, STREAK);
    gl.uniform2fv(D.u.uWipe, this.wipe);
    gl.uniform2f(D.u.uViewPx, T.scene.w, T.scene.h);
    gl.uniform1f(D.u.uGain, (0.95 * DOTS) / this.dots);
    gl.uniformMatrix3fv(D.u.uToCam, false, this.toCam);
    gl.uniform3fv(D.u.uCam, this.cam);
    gl.uniform4fv(D.u.uProj, this.proj);
    gl.uniform3fv(D.u.uSun, this.sun);
    gl.drawArrays(gl.POINTS, 0, LINES * this.dots);
    gl.disable(gl.BLEND);

    const tex = (unit: number, t2: Target) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t2.tex);
    };
    // Bloom: half, then quarter size, blurred both ways.
    this.pass(this.progs.down, T.h2, (u) => {
      tex(0, T.scene);
      gl.uniform1i(u.uSrc, 0);
      gl.uniform2f(u.uTexel, 0.5 / T.scene.w, 0.5 / T.scene.h);
    });
    this.pass(this.progs.down, T.q4, (u) => {
      tex(0, T.h2);
      gl.uniform1i(u.uSrc, 0);
      gl.uniform2f(u.uTexel, 0.5 / T.h2.w, 0.5 / T.h2.h);
    });
    this.pass(this.progs.blur, T.q4b, (u) => {
      tex(0, T.q4);
      gl.uniform1i(u.uSrc, 0);
      gl.uniform2f(u.uDir, 1 / T.q4.w, 0);
    });
    this.pass(this.progs.blur, T.q4, (u) => {
      tex(0, T.q4b);
      gl.uniform1i(u.uSrc, 0);
      gl.uniform2f(u.uDir, 0, 1 / T.q4.h);
    });
    this.pass(this.progs.comp, null, (u) => {
      tex(0, T.scene);
      tex(1, T.q4);
      gl.uniform1i(u.uScene, 0);
      gl.uniform1i(u.uBloom, 1);
      gl.uniformMatrix3fv(u.uToWorld, false, this.toWorld);
      gl.uniform3fv(u.uCam, this.cam);
      gl.uniform3fv(u.uSun, this.sun);
      gl.uniform4fv(u.uInv, this.inv);
    });
  }

  /** Screen y (-1 bottom to 1 top) of the top of the horizon on this screen. */
  get horizonTop() {
    return this.top;
  }

  /** Where the real planet's wipe has reached (screen y, -1 bottom to 1 top), and how strongly the lines glow there. */
  setWipe(y: number, strength: number) {
    this.wipe[0] = y;
    this.wipe[1] = strength;
  }

  dispose() {
    if (this.disposed || !this.ok) return;
    this.disposed = true;
    this.freeTargets();
    const gl = this.gl;
    for (const p of Object.values(this.progs)) gl.deleteProgram(p.p);
    if (this.vao) gl.deleteVertexArray(this.vao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
