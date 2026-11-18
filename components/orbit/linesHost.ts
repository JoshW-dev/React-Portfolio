import { filmUrl } from "@/lib/filmUrl";
import { EarthLines, horizonTopFor } from "./earthLines";
import type { FromWorker, ToWorker } from "./earthLines.worker";

/*
  Runs the Earth lines (earthLines.ts) where they stay smoothest. Where the browser can draw
  WebGL in a worker, the canvas goes to earthLines.worker.ts and the lines keep their own frame
  clock, so the planet loading behind them (three.js starting, textures going up, shaders
  compiling, 50 to 250 ms each on a phone) never stalls them. Elsewhere, or if the worker
  can't start, they draw on the main thread, as before. Either way the page sees the same
  few calls. The worker's script is public/film/lines-worker.js, which
  scripts/build-lines-worker.mjs writes from earthLines.worker.ts before every build.
*/

type Options = {
  /** 1 = full dot count; phones use less. */
  density: number;
  /** The frames are too slow for this machine. */
  onSlow(): void;
  /** Neither thread could draw them. */
  onFail(): void;
};

const WORKER_URL = "/film/lines-worker.js";

const workersDraw = () => typeof Worker === "function" && typeof OffscreenCanvas === "function";

/*
  The worker starts as soon as this module loads, while React is still hydrating the page,
  so its script is fetched and running by the time the lines mount. Only the film's opening
  imports this module.
*/
let spare: Worker | null = null;
if (typeof window !== "undefined" && workersDraw() && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  try {
    spare = new Worker(filmUrl(WORKER_URL));
  } catch {
    spare = null;
  }
}

/** Frees the early worker when the lines won't run after all. */
export function releaseSpareWorker() {
  spare?.terminate();
  spare = null;
}

export class LinesHost {
  /** False when the lines can't draw at all. */
  ok = true;
  private worker: Worker | null = null;
  private lines: EarthLines | null = null;
  private running = false;
  private raf = 0;
  private t = 0;
  private prev = 0;
  private frames = 0;
  private slow = 0;
  private told = false;
  private top = 0;
  private disposed = false;

  constructor(
    /** The canvas on the page. It may be swapped for a fresh one if the worker can't draw. */
    public canvas: HTMLCanvasElement,
    private opts: Options,
  ) {
    this.top = horizonTopFor(canvas.clientWidth, canvas.clientHeight);
    if (workersDraw() && typeof canvas.transferControlToOffscreen === "function" && this.startWorker()) return;
    this.startHere();
  }

  /** Screen y (-1 bottom to 1 top) of the top of the horizon. */
  get horizonTop() {
    return this.top;
  }

  private size() {
    const c = this.canvas;
    return { w: Math.max(1, c.clientWidth), h: Math.max(1, c.clientHeight), dpr: window.devicePixelRatio || 1 };
  }

  private send(m: ToWorker, transfer?: Transferable[]) {
    this.worker?.postMessage(m, transfer ?? []);
  }

  private startWorker(): boolean {
    let worker: Worker;
    let off: OffscreenCanvas;
    try {
      // A plain script that scripts/build-lines-worker.mjs writes before every build.
      worker = spare ?? new Worker(filmUrl(WORKER_URL));
      spare = null;
      off = this.canvas.transferControlToOffscreen();
    } catch {
      return false;
    }
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      if (this.disposed) return;
      if (e.data.type === "fail") this.fallBack();
      else if (e.data.type === "slow") this.opts.onSlow();
    };
    worker.onerror = () => {
      if (!this.disposed) this.fallBack();
    };
    const { w, h, dpr } = this.size();
    this.send({ type: "init", canvas: off, density: this.opts.density, w, h, dpr }, [off]);
    return true;
  }

  /** The worker can't draw WebGL here: draw on a fresh canvas on this thread instead. */
  private fallBack() {
    this.worker?.terminate();
    this.worker = null;
    const fresh = this.canvas.cloneNode(false) as HTMLCanvasElement;
    fresh.style.cssText = this.canvas.style.cssText;
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.startHere();
    if (this.running) this.loop();
  }

  private startHere() {
    const l = new EarthLines(this.canvas, { density: this.opts.density });
    if (!l.ok) {
      this.ok = false;
      // Told on the next turn, so a caller that is still setting up sees it the same way.
      queueMicrotask(() => {
        if (!this.disposed) this.opts.onFail();
      });
      return;
    }
    this.lines = l;
    const { w, h, dpr } = this.size();
    l.resize(w, h, dpr);
  }

  private frame = (now: number) => {
    this.raf = 0;
    const l = this.lines;
    if (!l || !this.running) return;
    const dt = this.prev ? now - this.prev : 16;
    this.prev = now;
    this.t += Math.min(dt, 100) / 1000;
    this.slow = this.slow * 0.9 + (dt > 45 ? 0.1 : 0);
    if (++this.frames > 20 && this.slow > 0.6 && !this.told) {
      this.told = true;
      this.opts.onSlow();
      if (this.disposed) return;
    }
    l.draw(this.t);
    this.raf = requestAnimationFrame(this.frame);
  };

  private loop() {
    if (this.lines && !this.raf) {
      this.prev = 0;
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  /** Plays or pauses them (off screen, hidden tab). */
  run(on: boolean) {
    if (this.disposed || on === this.running) return;
    this.running = on;
    if (this.worker) this.send({ type: "run", on });
    else if (on) this.loop();
    else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  resize() {
    if (this.disposed) return;
    const { w, h, dpr } = this.size();
    this.top = horizonTopFor(w, h);
    if (this.worker) this.send({ type: "resize", w, h, dpr });
    else this.lines?.resize(w, h, dpr);
  }

  /** Where the planet's wipe has reached (screen y, -1 bottom to 1 top), and how strongly the lines glow there. */
  setWipe(y: number, strength: number) {
    if (this.worker) this.send({ type: "wipe", y, s: strength });
    else this.lines?.setWipe(y, strength);
  }

  /** Stops them, frees the GPU and removes the canvas. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.worker) {
      // The worker frees its context and closes itself; terminate is the backstop.
      this.send({ type: "dispose" });
      const w = this.worker;
      setTimeout(() => w.terminate(), 1000);
      this.worker = null;
    }
    this.lines?.dispose();
    this.lines = null;
    this.canvas.remove();
  }
}
