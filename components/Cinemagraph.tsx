"use client";

// A cinemagraph of a portrait: the person holds perfectly still while the
// defocused landscape behind them moves.
//
// Ported from the mcnicoll-light painting renderer. For the photo we
// precompute a flow field once, in two offscreen passes:
//   pass 1  Sobel gradients of luminance
//   pass 2  a Gaussian-weighted structure tensor, stored as the local
//           orientation (doubled angle), anisotropy and detail
//
// The scene pass then moves only the background: open sky and haze turn over
// on a slow swirl, cloud banks and the ridge slide along their own direction,
// and upright structure (the conifer) sways sideways. A set of ellipses marks
// the person, and the motion is held at zero inside them and ramps up outside
// slowly enough that no background pixel can ever sample the subject.

import { useEffect, useRef, useState } from "react";
import styles from "./Cinemagraph.module.css";

/** An ellipse in the photo's uv space: centre and radii as fractions of the
 *  photo's width (x, rx) and height (y, ry), with y running down. */
export type SubjectEllipse = { x: number; y: number; rx: number; ry: number };

type CinemagraphProps = {
  src: string;
  width: number;
  height: number;
  alt: string;
  className?: string;
  priority?: boolean;
  /** Up to four ellipses covering the person; everything inside holds still. */
  subject?: readonly SubjectEllipse[];
  /** 0 to 1 scale on the movement. At 0 the canvas matches the photo exactly. */
  motion?: number;
};

// Fitted to public/img/josh.webp (560x720) against a hand-traced silhouette.
// Every subject pixel lies within 5 px of the union, which the HOLD margin in
// the shader covers.
const JOSH_SUBJECT: readonly SubjectEllipse[] = [
  { x: 0.532, y: 0.278, rx: 0.287, ry: 0.2 }, // hair and crown
  { x: 0.509, y: 0.421, rx: 0.241, ry: 0.196 }, // face and ears
  { x: 0.533, y: 0.64, rx: 0.357, ry: 0.112 }, // scarf and collar
  { x: 0.449, y: 1.057, rx: 0.577, ry: 0.563 }, // shoulders
];

const MAX_ELLIPSES = 4;

const QUAD_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const GRADIENT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;

float lum(vec2 uv) {
  return dot(texture(uSrc, uv).rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 t = uTexel;
  float tl = lum(vUv + vec2(-t.x,  t.y)), tc = lum(vUv + vec2(0.0,  t.y)), tr = lum(vUv + t);
  float ml = lum(vUv + vec2(-t.x, 0.0)),                                   mr = lum(vUv + vec2(t.x, 0.0));
  float bl = lum(vUv - t),                bc = lum(vUv - vec2(0.0, t.y)),  br = lum(vUv + vec2(t.x, -t.y));

  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);

  // Sobel lands in [-4, 4]. Behind him the photo is out of focus and the
  // gradients are a few thousandths, which a linear 8-bit fold rounds to zero
  // and turns the whole sky into quantisation noise. A square root keeps them.
  vec2 g = vec2(gx, gy) * 0.25;
  outColor = vec4(sign(g) * sqrt(abs(g)) * 0.5 + 0.5, lum(vUv), 1.0);
}`;

const TENSOR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uGrad;
uniform vec2 uTexel;

vec2 gradient(vec2 uv) {
  vec2 e = texture(uGrad, uv).rg * 2.0 - 1.0;
  return sign(e) * e * e;   // undo the square root from pass 1
}

void main() {
  float Jxx = 0.0, Jyy = 0.0, Jxy = 0.0, wsum = 0.0;

  // Gaussian-weighted structure tensor over an 11x11 window. Smoothing the
  // tensor rather than the image keeps the direction coherent across a whole
  // cloud bank instead of flipping texel to texel.
  for (int y = -5; y <= 5; y++) {
    for (int x = -5; x <= 5; x++) {
      vec2 o = vec2(float(x), float(y));
      float w = exp(-dot(o, o) / 12.5);
      vec2 g = gradient(vUv + o * uTexel);
      Jxx += w * g.x * g.x;
      Jyy += w * g.y * g.y;
      Jxy += w * g.x * g.y;
      wsum += w;
    }
  }
  Jxx /= wsum; Jyy /= wsum; Jxy /= wsum;

  float tr = Jxx + Jyy;
  float disc = sqrt(0.25 * (Jxx - Jyy) * (Jxx - Jyy) + Jxy * Jxy);
  float aniso = tr > 1e-9 ? 2.0 * disc / tr : 0.0;

  // The gradient axis sits at doubled angle atan(2Jxy, Jxx - Jyy) and the
  // stroke runs at right angles to it, which in doubled angle is a sign flip.
  // Storing (cos 2a, sin 2a) instead of a tangent vector means v and -v encode
  // the same, so the mip chain averages orientations without them cancelling,
  // and the length that survives measures how far the neighbourhood agrees.
  vec2 doubled = disc > 1e-12 ? -vec2(Jxx - Jyy, 2.0 * Jxy) / (2.0 * disc) : vec2(0.0);
  float detail = clamp(sqrt(tr) * 2.2, 0.0, 1.0);

  outColor = vec4(doubled * 0.5 + 0.5, aniso, detail);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uPhoto;
uniform sampler2D uFlow;
uniform vec2  uFit;          // object-fit: cover, as a scale on (uv - 0.5)
uniform float uAspect;       // photo height / width, to measure in square units
uniform float uLod;          // photo mip level for the displayed size
uniform float uTime;
uniform float uMotion;       // 0 draws the photo untouched
uniform vec4  uSubject[${MAX_ELLIPSES}];  // (cx, cy, rx, ry) in uv, y down
uniform int   uSubjectCount;

// Distances are in photo widths. MAX_SHIFT caps how far any pixel travels.
// HOLD is a fully still margin past the ellipses that covers the few pixels
// the fit misses by. RAMP is how far motion takes to reach full strength; it
// must exceed 1.125 * MAX_SHIFT (smoothstep's steepest slope) so that a pixel
// at distance d from the subject is always displaced by less than d. Without
// that, background near his shoulder samples the jacket and smears it into
// the sky.
const float MAX_SHIFT = 0.016;
const float HOLD = 0.012;
const float RAMP = 0.024;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; }
  return s;
}

// Newton estimate of the distance to an ellipse (negative inside). Outside it
// never overestimates, which is the direction the hold needs to be safe in.
float ellipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

float subjectDistance(vec2 w) {
  vec2 sq = vec2(1.0, uAspect);
  float d = 1e3;
  for (int i = 0; i < ${MAX_ELLIPSES}; i++) {
    if (i >= uSubjectCount) break;
    vec4 e = uSubject[i];
    d = min(d, ellipse(w - e.xy * sq, e.zw * sq));
  }
  return d;
}

// What the photo itself says is subject: skin, or anything in focus. On this
// photo neither fires anywhere in the bokeh behind him (sky and snow run red
// minus green below -0.01, the face at +0.11; background detail tops out
// near 0.075), so they only matter if the ellipses are moved or mistuned.
float subjectHint(vec2 uv) {
  vec3 c = textureLod(uPhoto, uv, 3.0).rgb;
  float skin = smoothstep(0.03, 0.07, c.r - c.g) * smoothstep(0.02, 0.06, c.r - c.b);
  float sharp = smoothstep(0.10, 0.16, textureLod(uFlow, uv, 3.0).a);
  return max(skin, sharp);
}

void main() {
  // Canvas rows run bottom-up and the texture's top-down. Flipping here rather
  // than at upload sidesteps browsers that ignore UNPACK_FLIP_Y for some sources.
  vec2 uv = (vec2(vUv.x, 1.0 - vUv.y) - 0.5) * uFit + 0.5;
  vec2 sq = vec2(1.0, uAspect);
  vec2 w = uv * sq;

  vec2 shift = vec2(0.0);
  float free = smoothstep(HOLD, HOLD + RAMP, subjectDistance(w))
             * (1.0 - subjectHint(uv)) * clamp(uMotion, 0.0, 1.0);

  if (free > 0.0) {
    float t = uTime;
    float n1 = fbm(w * 1.6 + vec2(t * 0.05, -t * 0.03));
    float n2 = fbm(w * 0.8 + vec2(5.2 - t * 0.02, 1.7));

    // The gust: one long breath, about 28 s from lean to lean, that swells the
    // faster motion and carries the whole background a little to one side.
    float gust = 0.75 + 0.25 * sin(t * 0.22 + n2 * 3.0);
    vec2 lean = vec2(0.003 * sin(t * 0.22 + 1.3), 0.0);

    // Orientation one mip up, as in the painting renderer: the averaging is
    // what turns per-texel noise into a field that agrees over a region.
    vec2 orient = textureLod(uFlow, uv, 1.0).rg * 2.0 - 1.0;
    float coherence = smoothstep(0.3, 0.8, length(orient));
    float level = orient.x / max(length(orient), 1e-4);   // +1 lying flat, -1 upright
    float ang = 0.5 * atan(orient.y, orient.x);
    vec2 tangent = vec2(cos(ang), sin(ang));
    // Open sky reads about 0.007 here, the ridge 0.024, the conifer 0.036 and
    // the bright cloud on the right 0.05.
    float edge = smoothstep(0.012, 0.04, textureLod(uFlow, uv, 2.0).a) * coherence;

    // Swirl: two transverse waves at right angles, each moving pixels across
    // its own direction of travel. Shear waves carry no divergence, so the sky
    // turns over without breathing in and out, and n1 bends their crests so
    // they never line up into stripes. Wavelength about one photo width,
    // period about 3.5 s. The first tuning (0.9% at 4.2 s) measured a median
    // of 5 px/s on the 560 px photo, under 4 css px/s at the size it's shown,
    // which is the slow drift that went unnoticed. On a flat ridge the
    // vertical half is eased off so the mountains drift rather than ripple.
    vec2 swirl = vec2(
      sin(dot(w, vec2(0.7, 4.8)) - t * 1.85 + n1 * 2.4),
      cos(dot(w, vec2(5.2, -0.9)) - t * 1.70 + n1 * 2.4) * (1.0 - 0.5 * edge * max(level, 0.0))
    ) * 0.0115;

    // Cloud banks and the ridge slide along themselves.
    float slide = sin(dot(w, vec2(2.6, 1.3)) - t * 1.5 + n1 * 2.0);
    vec2 stroke = tangent * slide * 0.007 * edge * smoothstep(0.1, 0.6, level);

    // Upright structure (the conifer on the left) sways across itself. This
    // is sideways by construction, so the sign ambiguity of a vertical
    // tangent never matters.
    float bend = sin(t * 1.6 + w.y * 2.5 + n1 * 1.5);
    vec2 sway = vec2(bend * 0.009 * edge * smoothstep(0.1, 0.6, -level), 0.0);

    shift = (swirl + stroke + sway) * gust + lean;
    float len = length(shift);
    if (len > MAX_SHIFT) shift *= MAX_SHIFT / len;
    shift *= free;

    // The hints are not distances, so also check where the sample lands.
    shift *= 1.0 - subjectHint(uv + shift / sq);
  }

  vec2 src = clamp(uv + shift / sq, 0.0, 1.0);
  outColor = vec4(textureLod(uPhoto, src, uLod).rgb, 1.0);
}`;

type Renderer = {
  /** Set the drawing buffer size in device pixels. */
  resize(width: number, height: number): void;
  draw(time: number, motion: number): void;
  dispose(): void;
};

type Program = { handle: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> };

// Builds the GL side for one photo. Returns null instead of throwing when
// WebGL2 is missing or a shader fails, so the caller can fall back to the img.
function createRenderer(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  subject: readonly SubjectEllipse[],
): Renderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  });
  if (!gl || gl.isContextLost()) return null;

  const shaders: WebGLShader[] = [];
  const programs: WebGLProgram[] = [];
  const textures: WebGLTexture[] = [];
  const buffers: WebGLBuffer[] = [];
  const framebuffers: WebGLFramebuffer[] = [];
  let vao: WebGLVertexArrayObject | null = null;

  const release = () => {
    if (gl.isContextLost()) return;
    programs.forEach((p) => gl.deleteProgram(p));
    shaders.forEach((s) => gl.deleteShader(s));
    textures.forEach((t) => gl.deleteTexture(t));
    buffers.forEach((b) => gl.deleteBuffer(b));
    framebuffers.forEach((f) => gl.deleteFramebuffer(f));
    if (vao) gl.deleteVertexArray(vao);
    programs.length = shaders.length = textures.length = buffers.length = framebuffers.length = 0;
    vao = null;
  };

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("createShader failed");
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "shader compile failed");
    }
    return shader;
  };

  const link = (fs: string, names: string[]): Program => {
    const handle = gl.createProgram();
    if (!handle) throw new Error("createProgram failed");
    programs.push(handle);
    gl.attachShader(handle, compile(gl.VERTEX_SHADER, QUAD_VS));
    gl.attachShader(handle, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(handle, 0, "aPos");
    gl.linkProgram(handle);
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(handle) || "program link failed");
    }
    const uniforms: Program["uniforms"] = {};
    for (const name of names) uniforms[name] = gl.getUniformLocation(handle, name);
    return { handle, uniforms };
  };

  const texture = (w: number, h: number, mip: boolean, source?: HTMLImageElement) => {
    const tex = gl.createTexture();
    if (!tex) throw new Error("createTexture failed");
    textures.push(tex);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (source) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  };

  try {
    const iw = image.naturalWidth;
    const ih = image.naturalHeight;
    if (!iw || !ih) return null;

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    if (!buf) throw new Error("createBuffer failed");
    buffers.push(buf);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // One triangle that covers the viewport.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const gradient = link(GRADIENT_FS, ["uSrc", "uTexel"]);
    const tensor = link(TENSOR_FS, ["uGrad", "uTexel"]);
    const scene = link(SCENE_FS, [
      "uPhoto", "uFlow", "uFit", "uAspect", "uLod", "uTime", "uMotion", "uSubject", "uSubjectCount",
    ]);

    const photo = texture(iw, ih, true, image);

    // Gradients at the photo's own resolution (capped), tensor at half that.
    const cap = Math.min(1, 1024 / Math.max(iw, ih));
    const gw = Math.max(2, Math.round(iw * cap));
    const gh = Math.max(2, Math.round(ih * cap));
    const fw = Math.max(2, Math.round(gw / 2));
    const fh = Math.max(2, Math.round(gh / 2));
    const gradTex = texture(gw, gh, false);
    const flow = texture(fw, fh, true);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error("createFramebuffer failed");
    framebuffers.push(fbo);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

    // pass 1: gradients
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gradTex, 0);
    gl.viewport(0, 0, gw, gh);
    gl.useProgram(gradient.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, photo);
    gl.uniform1i(gradient.uniforms.uSrc, 0);
    gl.uniform2f(gradient.uniforms.uTexel, 1 / gw, 1 / gh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 2: structure tensor
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, flow, 0);
    gl.viewport(0, 0, fw, fh);
    gl.useProgram(tensor.handle);
    gl.bindTexture(gl.TEXTURE_2D, gradTex);
    gl.uniform1i(tensor.uniforms.uGrad, 0);
    gl.uniform2f(tensor.uniforms.uTexel, 1 / gw, 1 / gh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, flow);
    gl.generateMipmap(gl.TEXTURE_2D);

    // The gradient texture and the framebuffer are done with.
    gl.deleteTexture(gradTex);
    textures.splice(textures.indexOf(gradTex), 1);
    gl.deleteFramebuffer(fbo);
    framebuffers.length = 0;

    // Scene uniforms that never change.
    const ellipses = new Float32Array(MAX_ELLIPSES * 4);
    const count = Math.min(subject.length, MAX_ELLIPSES);
    subject.slice(0, count).forEach((e, i) => ellipses.set([e.x, e.y, e.rx, e.ry], i * 4));
    gl.useProgram(scene.handle);
    gl.uniform1i(scene.uniforms.uPhoto, 0);
    gl.uniform1i(scene.uniforms.uFlow, 1);
    gl.uniform1f(scene.uniforms.uAspect, ih / iw);
    gl.uniform4fv(scene.uniforms.uSubject, ellipses);
    gl.uniform1i(scene.uniforms.uSubjectCount, count);
    gl.uniform2f(scene.uniforms.uFit, 1, 1);
    gl.uniform1f(scene.uniforms.uLod, 0);

    const failed = gl.getError();
    if (failed !== gl.NO_ERROR) throw new Error(`GL error ${failed}`);

    return {
      resize(width, height) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        if (gl.isContextLost()) return;
        // object-fit: cover, centred, to match the img underneath.
        const box = width / height;
        const img = iw / ih;
        const fx = box > img ? 1 : box / img;
        const fy = box > img ? img / box : 1;
        // Stay on the sharp side of the mip chain so the canvas never looks
        // softer than the browser's own downscale of the img.
        const lod = Math.max(0, Math.log2((iw * fx) / width) - 0.5);
        gl.useProgram(scene.handle);
        gl.uniform2f(scene.uniforms.uFit, fx, fy);
        gl.uniform1f(scene.uniforms.uLod, lod);
      },
      draw(time, motion) {
        if (gl.isContextLost()) return;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(scene.handle);
        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, photo);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, flow);
        gl.uniform1f(scene.uniforms.uTime, time);
        gl.uniform1f(scene.uniforms.uMotion, motion);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose: release,
    };
  } catch {
    release();
    return null;
  }
}

export default function Cinemagraph({
  src,
  width,
  height,
  alt,
  className,
  priority = false,
  subject = JOSH_SUBJECT,
  motion = 1,
}: CinemagraphProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motionRef = useRef(motion);
  const [calm, setCalm] = useState(true); // assume reduced motion until the client says otherwise
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);

  // Compared by value so a parent passing a fresh array literal doesn't restart WebGL.
  const subjectKey = JSON.stringify(subject);

  useEffect(() => {
    motionRef.current = motion;
  }, [motion]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setCalm(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (calm || failed || !wrap || !canvas) return;
    if (typeof IntersectionObserver === "undefined" || typeof ResizeObserver === "undefined") return;

    const ellipses = JSON.parse(subjectKey) as SubjectEllipse[];
    let disposed = false;
    let renderer: Renderer | null = null;
    let image: HTMLImageElement | null = null;
    let raf = 0;
    let near = false;
    let shown = false;
    let clock = 0; // seconds of motion shown so far; paused time doesn't count
    let last = 0;
    let ratio = 0;

    const fit = () => {
      if (!renderer) return;
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(wrap.clientWidth * ratio));
      const h = Math.max(1, Math.round(wrap.clientHeight * ratio));
      renderer.resize(w, h);
    };

    const paint = () => {
      if (!renderer) return;
      renderer.draw(clock, motionRef.current);
      if (!shown) {
        shown = true;
        setDrawn(true);
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // About 60 fps is plenty for motion this slow; skip extras on 120 Hz screens.
      if (last && now - last < 15) return;
      clock += last ? Math.min(now - last, 100) / 1000 : 0;
      last = now;
      if (Math.min(window.devicePixelRatio || 1, 2) !== ratio) fit();
      paint();
    };

    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const sync = () => {
      if (renderer && near && !document.hidden) {
        if (!raf) {
          last = 0;
          raf = requestAnimationFrame(frame);
        }
      } else {
        stop();
      }
    };

    const fail = () => {
      if (disposed) return;
      stop();
      setDrawn(false);
      setFailed(true);
    };

    const start = () => {
      if (image) return;
      const img = new Image();
      image = img;
      img.decoding = "async";
      img.onload = () => {
        if (disposed || image !== img) return;
        renderer = createRenderer(canvas, img, ellipses);
        if (!renderer) return fail();
        fit();
        sync();
      };
      img.onerror = fail;
      img.src = src;
    };

    const io = new IntersectionObserver(
      (entries) => {
        near = entries[entries.length - 1].isIntersecting;
        if (near) start();
        sync();
      },
      { rootMargin: "200px" },
    );
    io.observe(wrap);

    const ro = new ResizeObserver(() => {
      fit();
      // Resizing clears the canvas; redraw now so it never flashes before the next frame.
      if (shown) paint();
    });
    ro.observe(wrap);

    const onLost = () => fail();
    canvas.addEventListener("webglcontextlost", onLost);
    document.addEventListener("visibilitychange", sync);

    return () => {
      disposed = true;
      stop();
      io.disconnect();
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      document.removeEventListener("visibilitychange", sync);
      if (image) {
        image.onload = null;
        image.onerror = null;
        image = null;
      }
      renderer?.dispose();
      renderer = null;
      setDrawn(false);
    };
  }, [src, subjectKey, calm, failed]);

  return (
    <div
      ref={wrapRef}
      className={className ? `${styles.frame} ${className}` : styles.frame}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the real img is the LCP element and the no-JS fallback */}
      <img
        className={styles.photo}
        src={src}
        alt={alt}
        width={width}
        height={height}
        decoding="async"
        {...(priority ? { fetchPriority: "high" as const } : { loading: "lazy" as const })}
      />
      {!failed && (
        <canvas
          ref={canvasRef}
          className={drawn ? `${styles.motion} ${styles.drawn}` : styles.motion}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
