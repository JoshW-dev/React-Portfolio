/*
  The Earth lines (earthLines.ts) on their own thread. The page hands over an OffscreenCanvas
  and the worker draws on its own frame clock, so nothing the main thread does (three.js
  starting, the planet's textures going up, React) can hold a frame back. linesHost.ts is
  the page's side of it.
*/

import { EarthLines } from "./earthLines";

export type ToWorker =
  | { type: "init"; canvas: OffscreenCanvas; density: number; w: number; h: number; dpr: number }
  | { type: "resize"; w: number; h: number; dpr: number }
  | { type: "wipe"; y: number; s: number }
  | { type: "run"; on: boolean }
  | { type: "dispose" };

export type FromWorker = { type: "ok" } | { type: "fail" } | { type: "frame" } | { type: "slow" };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(m: FromWorker): void;
  requestAnimationFrame?: (cb: (t: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
  close(): void;
};

// Workers with an OffscreenCanvas have their own requestAnimationFrame in current browsers.
const raf = scope.requestAnimationFrame
  ? (cb: (t: number) => void) => scope.requestAnimationFrame!(cb)
  : (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
const caf = scope.cancelAnimationFrame ? (id: number) => scope.cancelAnimationFrame!(id) : (id: number) => clearTimeout(id);

let lines: EarthLines | null = null;
let running = false;
let handle = 0;
let t = 0;
let prev = 0;
let frames = 0;
let slow = 0;
let told = false;

function frame(now: number) {
  handle = 0;
  if (!lines || !running) return;
  const dt = prev ? now - prev : 16;
  prev = now;
  t += Math.min(dt, 100) / 1000;
  // A machine that can't keep up gets the poster instead (the page decides).
  slow = slow * 0.9 + (dt > 45 ? 0.1 : 0);
  if (++frames > 20 && slow > 0.6 && !told) {
    told = true;
    scope.postMessage({ type: "slow" });
  }
  lines.draw(t);
  if (frames === 1) scope.postMessage({ type: "frame" });
  handle = raf(frame);
}

scope.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case "init": {
      const l = new EarthLines(m.canvas, { density: m.density });
      if (!l.ok) {
        scope.postMessage({ type: "fail" });
        return;
      }
      lines = l;
      l.resize(m.w, m.h, m.dpr);
      scope.postMessage({ type: "ok" });
      break;
    }
    case "resize":
      lines?.resize(m.w, m.h, m.dpr);
      break;
    case "wipe":
      lines?.setWipe(m.y, m.s);
      break;
    case "run":
      running = m.on;
      if (running && !handle) {
        prev = 0;
        handle = raf(frame);
      } else if (!running && handle) {
        caf(handle);
        handle = 0;
      }
      break;
    case "dispose":
      running = false;
      if (handle) caf(handle);
      handle = 0;
      lines?.dispose();
      lines = null;
      scope.close();
      break;
  }
};
