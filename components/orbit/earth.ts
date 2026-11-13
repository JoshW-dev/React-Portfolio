import type * as THREE from "three";

/*
  Earth seen from low orbit, ported from the McCarthy's orbit globe (same NASA maps, same
  off-thread decoding, no post-processing). The globe drew a sphere mesh from far away;
  this one ray-casts the planet per pixel on a full-screen triangle, because from 1,000 km
  up the horizon is the whole shot and a tessellated sphere would show facets on it.

  Texture sources (NASA, public domain; the page credits them):
  - Day colour: NASA Blue Marble Next Generation, August 2004, topography and bathymetry,
    Reto Stöckli, NASA Earth Observatory. Oceans mixed halfway toward deep navy.
  - Water mask: made from the map above and the topography-only map of the same month.
  - City lights: NASA Black Marble 2016, grayscale (Joshua Stevens, NASA Earth
    Observatory, from Suomi NPP VIIRS data by Miguel Román, NASA GSFC).
*/

type Three = typeof THREE;

export type Tier = "2k" | "4k" | "8k";

const BASE = "/film/earth";
export const TEXTURES: Record<Tier, { day: string; lights: string; water?: string }> = {
  "2k": { day: `${BASE}/earth-day-2k.jpg`, lights: `${BASE}/earth-lights-2k.jpg`, water: `${BASE}/earth-water-2k.jpg` },
  "4k": { day: `${BASE}/earth-day-4k.jpg`, lights: `${BASE}/earth-lights-4k.jpg`, water: `${BASE}/earth-water-4k.jpg` },
  "8k": { day: `${BASE}/earth-day-8k.jpg`, lights: `${BASE}/earth-lights-8k.jpg` },
};

export async function loadImage(url: string, signal: AbortSignal): Promise<ImageBitmap | HTMLImageElement> {
  // Decoding off the main thread keeps the 8k swap from dropping frames.
  if (typeof createImageBitmap === "function") {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const blob = await res.blob();
      return await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    } catch (err) {
      if (signal.aborted) throw err;
    }
  }
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

export function makeTexture(
  T: Three,
  image: ImageBitmap | HTMLImageElement,
  kind: "color" | "data",
  anisotropy: number,
): THREE.Texture {
  const tex = new T.Texture(image as HTMLImageElement);
  // Uploaded unflipped; the shader reads row 0 as the north pole.
  tex.flipY = false;
  tex.wrapS = T.RepeatWrapping;
  tex.wrapT = T.ClampToEdgeWrapping;
  tex.minFilter = T.LinearMipmapLinearFilter;
  tex.magFilter = T.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  if (kind === "color") {
    tex.colorSpace = T.SRGBColorSpace;
  } else {
    // Single channel: a quarter of the GPU memory of RGBA.
    tex.colorSpace = T.NoColorSpace;
    tex.format = T.RedFormat;
  }
  tex.needsUpdate = true;
  return tex;
}

/** Earth-fixed unit vector for a latitude and longitude in degrees (three's sphere UVs). */
export function latLon(T: Three, lat: number, lon: number): THREE.Vector3 {
  const a = ((lon + 180) / 360) * Math.PI * 2;
  const p = (lat * Math.PI) / 180;
  return new T.Vector3(-Math.cos(a) * Math.cos(p), Math.sin(p), Math.sin(a) * Math.cos(p));
}

export const earthVertex = /* glsl */ `
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  varying vec3 vRay;
  void main() {
    vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
    vRay = mat3(uCamWorld) * (v.xyz / v.w);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const earthFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uDay;
  uniform sampler2D uLights;
  uniform sampler2D uWater;
  uniform float uDaySize;
  uniform vec3 uSun;
  uniform vec3 uCamPos;
  uniform mat3 uToEarth;
  uniform float uPixel;
  varying vec3 vRay;

  const float PI = 3.14159265359;
  const float TAU = 6.28318530718;
  // Atmosphere: scale height about 11 km, in Earth radii. CH is sqrt(2H / pi), the
  // Chapman term that keeps air mass finite at the horizon.
  const float H = 0.0017;
  const float CH = 0.0329;
  // Vertical optical depth: Rayleigh (red, green, blue) and a neutral haze.
  const vec3 BR = vec3(0.042, 0.1, 0.235);
  const float BM = 0.03;
  const vec3 BT = BR + BM;
  // Sunlight on the ground, light scattered by the air.
  const float K_SUN = 3.0;
  const float K_AIR = 0.5;

  float airMass(float mu) { return 1.0 / (max(mu, 0.0) + CH); }

  // Sunlight left after crossing the air to a point whose sun cosine is mu. Reddened at
  // about half the physical rate, the way a camera's white balance would hold it golden.
  vec3 sunThrough(float mu) {
    return exp(-BT * 0.5 * airMass(mu)) * smoothstep(-0.03, 0.02, mu);
  }

  // Colour weights for light scattered by the air at angle mu to the sun.
  vec3 phase(float mu) {
    float pr = 0.75 * (1.0 + mu * mu);
    float g = 0.72;
    float pm = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
    return (BR * pr + BM * pm) / BT;
  }

  void main() {
    vec3 rd = normalize(vRay);
    vec3 ro = uCamPos;
    vec3 L = normalize(uSun);
    float tc = -dot(ro, rd);
    vec3 pc = ro + rd * max(tc, 0.0);
    float rc = length(pc);
    float hc = rc - 1.0;

    // The ground point: the hit, or the nearest point on the limb for rays that miss.
    // Defined for every pixel so texture gradients stay continuous across the horizon.
    float tHit = tc - sqrt(max(1.0 - rc * rc, 0.0));
    vec3 p = rc < 1.0 ? ro + rd * tHit : pc / max(rc, 1e-5);
    vec3 e = normalize(uToEarth * p);
    float phi = atan(e.z, -e.x);
    float u1 = fract(phi / TAU);
    float u2 = phi / TAU;
    float v = acos(clamp(e.y, -1.0, 1.0)) / PI;
    vec2 uv = vec2(u1, v);
    float ux1 = dFdx(u1), uy1 = dFdy(u1), ux2 = dFdx(u2), uy2 = dFdy(u2);
    vec2 gx = vec2(abs(ux1) < abs(ux2) ? ux1 : ux2, dFdx(v));
    vec2 gy = vec2(abs(uy1) < abs(uy2) ? uy1 : uy2, dFdy(v));

    // Planet coverage of this pixel, for an antialiased horizon.
    float cover = tc > 0.0 ? clamp(0.5 - hc / (max(tc, 1e-4) * uPixel), 0.0, 1.0) : 0.0;
    float muLook = dot(rd, L);
    vec3 ph = phase(muLook);

    vec3 color = vec3(0.0);

    if (cover < 1.0 && tc > 0.0) {
      // Air seen edge-on against space: a full pass through the shell above the limb.
      float h = max(hc, 0.0);
      vec3 tau = BT * (2.0 / CH) * exp(-h / H);
      vec3 n = pc / max(rc, 1e-5);
      float muS = dot(n, L);
      // Air high above the terminator still catches the sun; reddened on the way in.
      vec3 sunAir = exp(-BT * airMass(muS + 0.06)) * smoothstep(-0.16, 0.0, muS);
      vec3 sky = (1.0 - exp(-tau)) * sunAir * ph * K_AIR;
      color = sky;
    }

    if (cover > 0.0) {
      vec3 N = p;
      vec3 V = -rd;
      float muS = dot(N, L);
      float muV = max(dot(N, V), 0.0);

      vec3 day = textureGrad(uDay, uv, gx, gy).rgb;
      float lights = textureGrad(uLights, uv, gx, gy).r;
      float halo = textureGrad(uLights, uv, gx * 7.0, gy * 7.0).r;
      float water = textureGrad(uWater, uv, gx, gy).r;

      // Relief: the map carries shaded relief. At a low sun, deepen its local contrast so
      // ridges and valleys read the way long shadows make them read.
      float texel = max(length(gx), length(gy)) * uDaySize;
      float spread = max(5.0, 3.0 / max(texel, 1e-4));
      vec3 blur = textureGrad(uDay, uv, gx * spread, gy * spread).rgb;
      float lowSun = 1.0 - smoothstep(0.15, 0.6, muS);
      // No sharpening where the map is already magnified: it would only draw the texels.
      float sharpen = (0.35 + 0.6 * lowSun) * (1.0 - water) * smoothstep(0.2, 0.7, texel);
      day = max(day + (day - blur) * sharpen, 0.0);

      // Sunlight reaching the ground, reddened near the terminator.
      vec3 sunGround = sunThrough(muS);
      float lambert = pow(max(muS, 0.0), 0.55);
      vec3 ground = day * sunGround * lambert * K_SUN;
      // Skylight: a little blue fill on the lit side.
      ground += day * vec3(0.05, 0.08, 0.14) * smoothstep(-0.05, 0.3, muS);

      // Sun glint on water, wide because of waves.
      vec3 Hv = normalize(L + V);
      float ndh = max(dot(N, Hv), 0.0);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(Hv, V), 0.0), 5.0);
      float glint = (pow(ndh, 600.0) * 3.0 + pow(ndh, 70.0) * 0.18) * fres;
      ground += sunGround * glint * water * K_SUN;

      // City lights come up as the ground turns away from the sun.
      float night = 1.0 - smoothstep(-0.11, 0.015, muS);
      vec3 warm = mix(vec3(1.0, 0.44, 0.13), vec3(1.0, 0.74, 0.44), smoothstep(0.6, 1.0, lights));
      ground += warm * (pow(lights, 1.2) * 2.0 + halo * halo * 0.8) * night;

      // Air between the camera and the ground: dims and blues it, thickest at the horizon.
      vec3 tauV = BT * airMass(muV);
      vec3 trans = exp(-tauV);
      // Thinner over the ground than on the limb, and gone soon past the terminator, so
      // the twilight band stays dark instead of turning murky.
      // Only the brightness of the light reaching the air is used here: its orange times
      // the air's blue would turn the twilight band green.
      vec3 sunAir = exp(-BT * 0.5 * airMass(muS + 0.03)) * smoothstep(-0.05, 0.12, muS);
      float sunAirL = dot(sunAir, vec3(0.3, 0.5, 0.2));
      vec3 haze = (1.0 - trans) * ph * sunAirL * K_AIR * 0.45;
      vec3 g = ground * trans + haze;
      color = mix(color, g, cover);
    }

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
