"use client";

import { SKETCH_SCRIPT, useFromHtml } from "./sketchReveal";

/**
 * The sketch's swap script (sketchReveal.ts), in the page's HTML only. A page rendered here,
 * opened from another page of the site, runs the swap from HeroFrame instead.
 */
export default function SketchScript() {
  const fromHtml = useFromHtml();
  return fromHtml ? <script dangerouslySetInnerHTML={{ __html: SKETCH_SCRIPT }} /> : null;
}
