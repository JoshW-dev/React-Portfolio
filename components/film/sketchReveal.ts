"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { whenShown } from "@/lib/handoff";

/*
  The swap from a hero's vector sketch (HeroSketch.tsx) to its real picture.

  On a fresh visit the page's HTML arrives with the sketch drawing in (data-sketch="draw"). Once
  the lines are drawn and the picture has loaded and decoded, the picture fades in over the
  sketch, and then the sketch goes. A small script in the HTML (SKETCH_SCRIPT) runs this as the
  page loads, so the picture does not wait for the page's scripts.

  A page opened from another page of the site does not draw in. If its picture is ready (the
  usual case: the page transition waits a moment for it), it shows at once. If not, the sketch
  shows already drawn, and the picture fades in over it when it arrives. A page opened from the
  film (lib/handoff.ts) shows its picture at once.
*/

export type SketchState = "draw" | "still" | "photo" | "none";

/** How long the picture takes to fade in over the sketch. HeroSketch.module.css has it too. */
const PHOTO_FADE_MS = 900;
/** After the picture has faded in, the page waits this long before any motion starts on it. */
const AFTER_FADE_MS = 250;

/**
 * The fresh-visit swap, run inline as the HTML is read. It waits for the picture to load and
 * decode and for the draw-in's animations to end, then fades the picture in. A picture that
 * fails to load leaves the sketch.
 */
export const SKETCH_SCRIPT = `(function(){
var s=document.currentScript,b=s&&s.closest("[data-sketch]");
if(!b||b.dataset.sketch!=="draw")return;
b.dataset.js="";
var art=s.parentNode,go=0;
function drawn(){try{return Promise.all(art.getAnimations({subtree:true}).map(function(a){return a.finished})).catch(function(){})}catch(e){return new Promise(function(r){setTimeout(r,1300)})}}
function show(i){if(go)return;go=1;Promise.all([i.decode().catch(function(){}),drawn()]).then(function(){
if(b.dataset.sketch!=="draw")return;b.dataset.sketch="photo";
setTimeout(function(){if(b.dataset.sketch==="photo")b.dataset.sketch="none"},${PHOTO_FADE_MS + 100})})}
b.addEventListener("load",function(e){var i=e.target;if(i.tagName==="IMG"&&i.parentNode===b)show(i)},true);
addEventListener("DOMContentLoaded",function(){var i=b.querySelector(":scope>img");if(i&&i.complete&&i.naturalWidth)show(i)});
})()`;

const noop = () => () => {};

/**
 * True when this component came with the page's HTML (a fresh visit or a reload), false when
 * it was rendered here (a page opened from another page of the site). Fixed for its lifetime.
 */
export function useFromHtml(): boolean {
  // React reads the server value while it hydrates the page's HTML, and the client value after.
  const hydrating = useSyncExternalStore(noop, () => false, () => true);
  return useState(hydrating)[0];
}

/** The state the box renders with, before any script has run. */
export const firstState = (fromHtml: boolean): SketchState => (fromHtml ? "draw" : "still");

type Reveal = {
  /** Settles once the picture shows in full: true if it faded in, false if it showed at once. */
  shown: Promise<boolean>;
  stop: () => void;
};

/**
 * Runs the swap for a box holding a sketch and its picture, or follows SKETCH_SCRIPT when that
 * already runs it. Call it in a layout effect, so a picture that is ready shows before the
 * first paint. `now` shows the picture at once.
 */
function revealPicture(box: HTMLElement, img: HTMLImageElement, o: { fromHtml: boolean; now?: boolean }): Reveal {
  let stopped = false;
  const undo: (() => void)[] = [];
  const stop = () => {
    stopped = true;
    undo.forEach((f) => f());
  };
  const set = (s: SketchState) => {
    if (!stopped) box.dataset.sketch = s;
  };
  const scripted = o.fromHtml && box.dataset.js !== undefined;
  box.dataset.js = "";

  const art = box.querySelector<HTMLElement>(":scope > [data-sketch-art]");
  const ready = () => img.complete && img.naturalWidth > 0;
  const state = box.dataset.sketch as SketchState | undefined;
  if (!art || !state || state === "none" || o.now || (!o.fromHtml && ready())) {
    set("none");
    // Faded in only if the script in the HTML had already run the whole swap.
    return { shown: Promise.resolve(scripted && state === "none"), stop };
  }

  // The script in the HTML is running the swap: wait for it to finish.
  if (scripted) {
    const shown = new Promise<boolean>((resolve) => {
      const mo = new MutationObserver(() => {
        if (box.dataset.sketch !== "none") return;
        mo.disconnect();
        resolve(true);
      });
      mo.observe(box, { attributes: true, attributeFilter: ["data-sketch"] });
      undo.push(() => mo.disconnect());
    });
    return { shown, stop };
  }

  // The script came so late that the fallback in the CSS has already shown the picture.
  if (state === "draw" && parseFloat(getComputedStyle(img).opacity) > 0.01) {
    set("none");
    return { shown: Promise.resolve(false), stop };
  }

  const loaded = new Promise<boolean>((resolve) => {
    const done = () => img.decode().then(() => resolve(true), () => resolve(ready()));
    if (ready()) return void done();
    const onLoad = () => done();
    const onError = () => resolve(false);
    img.addEventListener("load", onLoad, { once: true });
    img.addEventListener("error", onError, { once: true });
    undo.push(() => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    });
  });
  // The draw-in's own animations, so the picture waits for the last line.
  const drawn =
    state === "draw" ? Promise.all(art.getAnimations({ subtree: true }).map((a) => a.finished)).catch(() => undefined) : Promise.resolve();
  // A page opened from another page shows a picture that arrives before the wipe at once.
  let onScreen = state === "draw";
  if (!onScreen) void whenShown().then(() => (onScreen = true));

  const shown = (async () => {
    const [ok] = await Promise.all([loaded, drawn]);
    // A picture that fails to load leaves the sketch in its place.
    if (!ok || stopped) return new Promise<boolean>(() => {});
    if (!onScreen) {
      set("none");
      return false;
    }
    set("photo");
    await new Promise<void>((resolve) => {
      const t = window.setTimeout(end, PHOTO_FADE_MS + 100);
      function end() {
        window.clearTimeout(t);
        resolve();
      }
      undo.push(end);
    });
    set("none");
    return true;
  })();

  return { shown, stop };
}

/**
 * Runs the swap for a hero's box (a sketch, then its picture: `img`) and says when motion may
 * start on the picture. `settled()` gives how long to wait once the picture shows in full:
 * a moment after a fade-in, or `settleMs` when it showed at once. `now()` asks for the picture
 * at once (a page opened from the film).
 */
export function useSketchReveal(
  boxRef: RefObject<HTMLElement | null>,
  imgRef: RefObject<HTMLImageElement | null>,
  o: { settleMs: number; now?: () => boolean },
) {
  const fromHtml = useFromHtml();
  const ready = useRef<{ promise: Promise<number>; resolve: (ms: number) => void } | null>(null);
  const settle = () => {
    if (!ready.current) {
      let resolve!: (ms: number) => void;
      const promise = new Promise<number>((r) => (resolve = r));
      ready.current = { promise, resolve };
    }
    return ready.current;
  };

  useLayoutEffect(() => {
    const box = boxRef.current;
    const img = imgRef.current;
    if (!box || !img) return;
    const r = revealPicture(box, img, { fromHtml, now: o.now?.() });
    void r.shown.then((faded) => settle().resolve(faded ? AFTER_FADE_MS : o.settleMs));
    return r.stop;
    // Runs once: the box, the picture and how the page opened don't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { fromHtml, settled: () => settle().promise };
}
