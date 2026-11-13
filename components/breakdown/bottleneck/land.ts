/*
  Land dots for the globe, sampled once at load from the site's 2k NASA water mask (white
  is water, black is land). The image is read on the CPU and dropped; only the dot
  positions reach the GPU.
*/

const WATER_MASK = "/film/earth/earth-water-2k.jpg";

/**
 * [lat, lng] pairs, in degrees, flattened. Rows run every `step` degrees of latitude, and
 * dots within a row every `step` degrees of arc, so the dots sit evenly over the sphere.
 * Antarctica is left out: no view looks at it.
 */
export async function loadLandDots(step = 1.05, src = WATER_MASK): Promise<Float32Array> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  const w = 1024;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return new Float32Array(0);
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  const land = (lat: number, lng: number) => {
    const x = Math.min(w - 1, Math.max(0, Math.floor(((lng + 180) / 360) * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)));
    return data[(y * w + x) * 4] < 110;
  };
  const out: number[] = [];
  const DEG = Math.PI / 180;
  for (let lat = 84 - step / 2; lat > -57; lat -= step) {
    const lngStep = step / Math.max(Math.cos(lat * DEG), 0.08);
    // Offset alternate rows by half a step, so the dots pack like a honeycomb.
    const row = Math.round((84 - lat) / step);
    for (let lng = -180 + lngStep * (row % 2 ? 0.25 : 0.75); lng < 180; lng += lngStep) {
      if (land(lat, lng)) out.push(lat, lng);
    }
  }
  return new Float32Array(out);
}
