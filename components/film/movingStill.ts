/*
  Moving stills. While the film rests on a stop, a WebGL canvas over the picture draws the
  same frame with one thing in it moving: clouds, steam, fog, traffic, water.

  Each stop has a motion map (public/film/motion/<name>.png, from scripts/film-motion.py) that
  lines up with the frame the stop rests on. Red and green carry a flow, which slides the
  picture along it in two phases that cross-fade, so the motion loops without drifting away.
  Blue carries a shimmer: a small ripple and a twinkle on bright pixels.

  At strength 0 the canvas draws the frame exactly as the picture under it, so the picture
  always shows first. MotionFade then draws a few frames unseen to test the machine, fades
  the canvas in with the strength at 0, and raises the strength after. A machine that drops
  frames, in the test or later, never sees it, or loses it and keeps the plain picture.

  Two pages use it: the film (FilmScroll), whose hold blends the clip that arrived into the
  clip that leaves, so the canvas blends the same two frames by the same amount; and a
  project page's hero (HeroFrame), which draws the stop's own still.
*/

export type Motion = {
  /** The stop's motion map. */
  map: string;
  /** How far full flow moves the picture in one cycle, in shares of its width. */
  flow?: number;
  /** Seconds per flow cycle. */
  period?: number;
  /**
   * A slow, broad warp where the flow is, in shares of the width: clouds, steam and fog
   * billow with it. A long slide doubles soft edges, so these keep the flow small.
   */
  billow?: number;
  /**
   * How far the flow's phase wanders from place to place, 0 to 1 (default 1). Rigid things
   * like a belt take 0, so their lines stay straight.
   */
  jitter?: number;
  /** How far the ripple moves the picture where the shimmer is full, in shares of its width. */
  ripple?: number;
  /** How much bright pixels brighten and dim where the shimmer is full. */
  twinkle?: number;
  /**
   * For water: where the horizon is, as a share of the picture's height. The ripples then
   * lie on the water's plane, small near the horizon and large near the viewer.
   */
  horizon?: number;
};

type Tex = { tex: WebGLTexture; w: number; h: number };

/**
 * A picture to draw: an image's URL, or a video paused on the frame the film shows, so the
 * canvas draws exactly what is under it. The key names the video's frame.
 */
export type Source = string | { key: string; video: HTMLVideoElement };
const keyOf = (s: Source) => (typeof s === "string" ? s : s.key);

/**
 * Whether this visit should try moving stills at all: motion allowed, no data saver, and
 * not a machine that says it is small. MotionFade's test decides the rest.
 */
export function motionAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if ((nav.hardwareConcurrency ?? 8) < 4) return false;
  if ((nav.deviceMemory ?? 8) < 4) return false;
  return true;
}

// Timing for MotionFade.
const FADE_IN = 0.9; // s to fade in
const FADE_OUT = 0.15; // s to fade out
const RAMP = 1.8; // s for the motion to grow from none to full
const PROBE_FRAMES = 24; // frames drawn unseen before it may show
const PROBE_MAX = 1 / 40; // s: the test fails above this average frame time
const SLOW = 1 / 24; // s: frames slower than this on average...
const SLOW_FOR = 2; // ...for this long turn it off
const SETTLE = 1.5; // s after it shows before frame times count

/** One machine test per page load, shared by the film and the hero. */
let probed: "unknown" | "pass" | "fail" = "unknown";

/**
 * The opacity and strength of a moving still, frame by frame. step() takes the frame time
 * and whether the still is wanted now; draw while drawNow is true, show at opacity.
 */
export class MotionFade {
  opacity = 0;
  amp = 0;
  /** Off for the rest of the page load: the machine could not keep up. */
  off = probed === "fail";
  private probeFrames = 0;
  private probeSum = 0;
  private avg = 1 / 60;
  private slowFor = 0;
  private shownFor = 0;

  /** Draw this frame: during the unseen test, and while it shows. */
  get drawNow() {
    return !this.off && (this.opacity > 0 || this.probing);
  }

  get probing() {
    return probed === "unknown" && this.probeFrames > 0;
  }

  /** dt: seconds since the last frame. want: the still is wanted. steady: nothing else is busy. */
  step(dt: number, want: boolean, steady: boolean) {
    if (probed === "fail") this.off = true;
    if (this.off) want = false;
    if (want && probed === "unknown") {
      // The test: draw unseen, and count only the frames after the first.
      if (this.probeFrames > 0) this.probeSum += dt;
      this.probeFrames++;
      if (this.probeFrames > PROBE_FRAMES) {
        probed = this.probeSum / PROBE_FRAMES <= PROBE_MAX ? "pass" : "fail";
        if (probed === "fail") this.off = true;
      }
      return;
    }
    if (!want) {
      this.probeFrames = 0;
      this.probeSum = 0;
    }
    this.opacity = want ? Math.min(1, this.opacity + dt / FADE_IN) : Math.max(0, this.opacity - dt / FADE_OUT);
    if (this.opacity === 0) {
      this.amp = 0;
      this.shownFor = 0;
    } else if (want) this.amp = Math.min(1, this.amp + dt / RAMP);
    if (this.opacity === 1 && steady) {
      this.shownFor += dt;
      if (this.shownFor > SETTLE) {
        this.avg = this.avg * 0.94 + dt * 0.06;
        this.slowFor = this.avg > SLOW ? this.slowFor + dt : 0;
        if (this.slowFor > SLOW_FOR) {
          this.off = true;
          probed = "fail";
        }
      }
    }
  }

  /** The motion's strength for the shader, eased. */
  get strength() {
    const t = this.amp;
    return t * t * (3 - 2 * t);
  }

  get frameMs() {
    return this.avg * 1000;
  }
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uMap;
uniform sampler2D uNoise;
uniform vec4 uCoverA;
uniform vec4 uCoverB;
uniform float uAspect;
uniform float uMix;
uniform float uAmp;
uniform float uTime;
uniform float uFlow;
uniform float uPeriod;
uniform float uRipple;
uniform float uTwinkle;
uniform float uBillow;
uniform float uJitter;
uniform float uHorizon;

void main() {
  vec2 ua = vUv * uCoverA.xy + uCoverA.zw;
  vec2 ub = vUv * uCoverB.xy + uCoverB.zw;
  vec3 m = texture2D(uMap, ua).rgb;
  vec2 dir0 = (m.rg * 255.0 - 128.0) / 127.0;
  float cover = clamp(max(length(dir0), m.b) * 6.0, 0.0, 1.0);
  if (cover < 0.004) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // The flow, in shares of the width on both axes, as texture coordinates.
  vec2 dir = (m.rg * 255.0 - 128.0) / 127.0;
  vec2 f = dir * (uFlow * uAmp);
  vec2 fuv = vec2(f.x, f.y * uAspect);
  float s = m.b * uAmp;

  // Billow: two broad noises drifting apart, so the warp keeps changing shape.
  // The noise has 128 cells a tile, so 0.09 tiles across puts about 11 cells on the picture.
  vec2 buv = ua * vec2(0.09, 0.06);
  vec2 bn = texture2D(uNoise, buv + vec2(uTime * 0.0056, -uTime * 0.008)).rg - 0.5;
  bn += 0.6 * (texture2D(uNoise, buv * 2.1 + vec2(-uTime * 0.007, -uTime * 0.0044)).ba - 0.5);
  vec2 billow = bn * (length(dir) * uBillow * uAmp) * vec2(1.0, uAspect);

  // Ripple: a soft displacement, finer across than down, drifting toward the viewer.
  vec2 nuv = ua * vec2(0.32, 0.9) + vec2(0.0, -uTime * 0.02);
  float lean = 0.6;
  if (uHorizon > 0.0) {
    // On the water's plane: across is x over depth, along is one over depth.
    float d = max(ua.y - uHorizon, 0.02);
    nuv = vec2((ua.x - 0.5) / d * 0.047, 0.037 / d) + vec2(0.0, uTime * 0.035);
    lean = 0.35;
  }
  vec2 n = texture2D(uNoise, nuv).rg - 0.5;
  n += 0.5 * (texture2D(uNoise, nuv * 2.3 + vec2(uTime * 0.015, -uTime * 0.028)).rg - 0.5);
  vec2 rip = n * (s * uRipple) * vec2(1.0, uAspect * lean) + billow;

  // Two phases of the flow, half a cycle apart, each reset while its weight is zero. A slow
  // noise offsets the phase from place to place, so the resets never line up.
  float t = uTime / uPeriod + texture2D(uNoise, ua * 0.05).b * uJitter;
  float p0 = fract(t);
  float p1 = fract(t + 0.5);
  float w0 = 1.0 - abs(1.0 - 2.0 * p0);
  vec2 o0 = rip - fuv * (p0 - 0.5);
  vec2 o1 = rip - fuv * (p1 - 0.5);

  vec3 c = texture2D(uA, ua + o0).rgb * w0 + texture2D(uA, ua + o1).rgb * (1.0 - w0);
  if (uMix > 0.0) {
    vec2 k = uCoverB.xy / uCoverA.xy;
    vec3 b = texture2D(uB, ub + o0 * k).rgb * w0 + texture2D(uB, ub + o1 * k).rgb * (1.0 - w0);
    c = mix(c, b, uMix);
  }

  // Twinkle: small bright things brighten and dim, each on its own beat.
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec2 tuv = ua * vec2(3.2, 1.8);
  float tw = texture2D(uNoise, tuv + vec2(uTime * 0.034, uTime * 0.021)).a;
  tw *= texture2D(uNoise, tuv * 1.37 - vec2(uTime * 0.027, uTime * 0.018)).g;
  c *= 1.0 + (tw - 0.25) * 2.4 * uTwinkle * s * smoothstep(0.3, 0.8, lum);

  // Only the parts that move are drawn; the rest is left clear, so the picture under the
  // canvas shows there untouched (the film's video can't be matched exactly in WebGL).
  gl_FragColor = vec4(c * cover, cover);
}`;

/** Texture coordinates of a picture drawn like CSS background-size: cover, centred. */
function cover(screen: number, image: number): [number, number, number, number] {
  if (screen > image) {
    const sy = image / screen;
    return [1, sy, 0, (1 - sy) / 2];
  }
  const sx = screen / image;
  return [sx, 1, (1 - sx) / 2, 0];
}

export class MovingStill {
  readonly ok: boolean;
  private gl: WebGLRenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private noise: WebGLTexture | null = null;
  private textures = new Map<string, Tex | "loading" | "failed">();
  private lost = false;

  constructor(private canvas: HTMLCanvasElement) {
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: "low-power",
      });
    } catch {
      gl = null;
    }
    // A software renderer can't keep up, so it gets the plain picture.
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    const software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
    this.ok = !!gl && !software && this.setup(gl);
    canvas.addEventListener("webglcontextlost", this.onLost);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  get live() {
    return this.ok && !this.lost;
  }

  private setup(gl: WebGLRenderingContext) {
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = shader(gl.VERTEX_SHADER, VERT);
    const fs = shader(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    for (const name of ["uA", "uB", "uMap", "uNoise", "uCoverA", "uCoverB", "uAspect", "uMix", "uAmp", "uTime", "uFlow", "uPeriod", "uRipple", "uTwinkle", "uBillow", "uJitter", "uHorizon"]) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
    gl.uniform1i(this.u.uA, 0);
    gl.uniform1i(this.u.uB, 1);
    gl.uniform1i(this.u.uMap, 2);
    gl.uniform1i(this.u.uNoise, 3);

    // A tiling noise: random bytes, filtered smooth by the texture unit.
    const N = 128;
    const bytes = new Uint8Array(N * N * 4);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    this.noise = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.noise);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.gl = gl;
    this.prog = prog;
    return true;
  }

  private upload(key: string, el: TexImageSource, w: number, h: number) {
    const gl = this.gl;
    if (!gl || this.lost) return;
    const tex = gl.createTexture();
    if (!tex) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, el);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(key, { tex, w, h });
  }

  /** Starts loading a picture. True once it is on the GPU. */
  private want(src: Source): boolean {
    const key = keyOf(src);
    const have = this.textures.get(key);
    if (have === "loading" || have === "failed") return false;
    if (have) return true;
    if (typeof src !== "string") {
      // A video's frame is taken once it has settled on it.
      const v = src.video;
      if (v.readyState < 2 || v.seeking || !v.videoWidth) return false;
      this.upload(key, v, v.videoWidth, v.videoHeight);
      return this.textures.has(key);
    }
    this.textures.set(key, "loading");
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    img
      .decode()
      .then(() => this.upload(key, img, img.naturalWidth, img.naturalHeight))
      .catch(() => this.textures.set(key, "failed"));
    return false;
  }

  /** Loads what a stop needs. True once all of it is ready to draw. */
  prepare(a: Source, b: Source | null, map: string): boolean {
    if (!this.live) return false;
    const ra = this.want(a);
    const rb = b ? this.want(b) : true;
    const rm = this.want(map);
    return ra && rb && rm;
  }

  /** Frees pictures nothing near the playhead needs. */
  keepOnly(keep: Source[]) {
    const gl = this.gl;
    const keys = new Set(keep.map(keyOf));
    for (const [key, t] of this.textures) {
      if (keys.has(key) || typeof t !== "object") continue;
      gl?.deleteTexture(t.tex);
      this.textures.delete(key);
    }
  }

  /** Matches the canvas to its box. */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Draws the frame. mix blends a into b, amp scales the motion, time is in seconds. */
  draw(o: { a: Source; b: Source | null; map: string; mix: number; amp: number; time: number; motion: Motion }) {
    const gl = this.gl;
    if (!gl || !this.live) return false;
    const a = this.textures.get(keyOf(o.a));
    const b = o.b ? this.textures.get(keyOf(o.b)) : null;
    const m = this.textures.get(o.map);
    if (typeof a !== "object" || typeof m !== "object" || (o.b && typeof b !== "object")) return false;
    this.resize();
    const W = this.canvas.width;
    const H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const bt = typeof b === "object" && b ? b : a;
    gl.uniform4fv(this.u.uCoverA, cover(W / H, a.w / a.h));
    gl.uniform4fv(this.u.uCoverB, cover(W / H, bt.w / bt.h));
    gl.uniform1f(this.u.uAspect, a.w / a.h);
    gl.uniform1f(this.u.uMix, b ? o.mix : 0);
    gl.uniform1f(this.u.uAmp, o.amp);
    gl.uniform1f(this.u.uTime, o.time);
    gl.uniform1f(this.u.uFlow, o.motion.flow ?? 0.012);
    gl.uniform1f(this.u.uPeriod, o.motion.period ?? 8);
    gl.uniform1f(this.u.uRipple, o.motion.ripple ?? 0);
    gl.uniform1f(this.u.uTwinkle, o.motion.twinkle ?? 0);
    gl.uniform1f(this.u.uBillow, o.motion.billow ?? 0);
    gl.uniform1f(this.u.uJitter, o.motion.jitter ?? 1);
    gl.uniform1f(this.u.uHorizon, o.motion.horizon ?? -1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bt.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, m.tex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.noise);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  dispose() {
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    const gl = this.gl;
    if (gl) {
      for (const t of this.textures.values()) if (typeof t === "object") gl.deleteTexture(t.tex);
      if (this.noise) gl.deleteTexture(this.noise);
      if (this.prog) gl.deleteProgram(this.prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.textures.clear();
    this.gl = null;
  }
}
