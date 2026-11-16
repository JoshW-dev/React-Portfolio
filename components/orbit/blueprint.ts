/*
  The CubeSat page's switch from space to a drawing.

  The breakdown opens on the satellite in orbit: a dark page, stars, Earth's picture under the
  limb. Scrolling on from the first step turns the whole page into an engineering drawing: a
  white sheet with a grid, Earth as a globe's grid of latitude and longitude, and the satellite
  in its line-drawing look, where the edges and the parts each step is about read clearly.

  CubeSatBreakdown sets the switch from the step position and marks the article
  data-blueprint="on" or "off"; globals.css eases the page's colour tokens over BLUEPRINT_MS.
  The scene reads blueprintAt() every frame, on the same clock and curve, for the canvas and
  the ground under it.
*/

export const BLUEPRINT_MS = 900;
/** Step positions where the drawing comes on and goes off. The gap stops it flickering. */
const ON_AT = 0.3;
const OFF_AT = 0.15;

export type Blueprint = { on: boolean; from: number; at: number; ms: number; reduced: boolean };

export function createBlueprint(): Blueprint {
  return { on: false, from: 0, at: -Infinity, ms: BLUEPRINT_MS, reduced: false };
}

/** Sets the switch from the step position. Returns true when it changed. */
export function steerBlueprint(b: Blueprint, p: number, now: number): boolean {
  const want = b.on ? p > OFF_AT : p >= ON_AT;
  if (want === b.on) return false;
  b.from = blueprintAt(b, now);
  b.on = want;
  b.at = now;
  // A reversal part way through takes the part of the time it has to undo, as CSS does.
  b.ms = BLUEPRINT_MS * Math.max(0.15, Math.abs((want ? 1 : 0) - b.from));
  return true;
}

/** How far the page is into the drawing: 0 in space, 1 in the drawing. */
export function blueprintAt(b: Blueprint, now: number): number {
  const goal = b.on ? 1 : 0;
  if (b.reduced) return goal;
  const t = Math.min(1, Math.max(0, (now - b.at) / b.ms));
  return b.from + (goal - b.from) * t * t * (3 - 2 * t);
}
