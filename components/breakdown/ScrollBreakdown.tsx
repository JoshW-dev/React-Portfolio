"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { NoWebGLError, createLoop, watchActive } from "./kit";
import styles from "./ScrollBreakdown.module.css";

/*
  A scroll breakdown: a pinned visual on the left and the steps that explain it on the
  right. Native scroll only. Scrolling sets a continuous step position, which the visual
  reads from a ref every frame, and the active step, which is React state.

  On phones the visual pins to the top of the screen and the steps scroll under it.
*/

export type BreakdownStep = { id: string; title: ReactNode; body: ReactNode };

export type BreakdownApi = {
  /** 0 to 1 across the pinned part of the section. Updated without re-rendering. */
  progress: RefObject<number>;
  /**
   * Continuous step position: 0 while step 0's text is in the reading line, 1 at step 1,
   * 2.5 halfway between steps 2 and 3. With reduced motion it is the active step, whole.
   */
  position: RefObject<number>;
  /** The active step. React state, so it re-renders when it changes. */
  step: number;
  count: number;
  reducedMotion: boolean;
  /** Called after every scroll measurement. Returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
};

type Props = {
  steps: BreakdownStep[];
  visual: (api: BreakdownApi) => ReactNode;
  /** Short line under the visual. */
  caption?: ReactNode;
  /** Accessible name for the section. */
  label: string;
  className?: string;
};

const NARROW = "(max-width: 799px)";
const REDUCE = "(prefers-reduced-motion: reduce)";

export default function ScrollBreakdown({ steps, visual, caption, label, className }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const progress = useRef(0);
  const position = useRef(0);
  const listeners = useRef(new Set<() => void>());
  const [step, setStep] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const count = steps.length;

  const subscribe = useCallback((fn: () => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;
    const narrow = window.matchMedia(NARROW);
    const reduce = window.matchMedia(REDUCE);
    let raf = 0;
    let active = -1;
    const centres: number[] = [];

    const measure = () => {
      raf = 0;
      const vh = window.innerHeight;
      const r = root.getBoundingClientRect();
      const stageH = stage.offsetHeight;
      const span = r.height - stageH;
      progress.current = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;

      // The reading line: the middle of the screen, or of the part below the pinned
      // visual on phones.
      const focus = narrow.matches ? stageH + (vh - stageH) / 2 : vh / 2;
      centres.length = 0;
      for (const el of stepRefs.current) {
        if (!el) continue;
        const b = el.getBoundingClientRect();
        centres.push(b.top + b.height / 2);
      }
      let pos = 0;
      const n = centres.length;
      if (n > 1) {
        if (focus >= centres[n - 1]) pos = n - 1;
        else if (focus > centres[0]) {
          let i = 0;
          while (i < n - 2 && focus >= centres[i + 1]) i++;
          pos = i + (focus - centres[i]) / (centres[i + 1] - centres[i]);
        }
      }
      const now = Math.round(pos);
      position.current = reduce.matches ? now : pos;
      if (now !== active) {
        active = now;
        setStep(now);
      }
      listeners.current.forEach((fn) => fn());
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const onReduce = () => {
      setReducedMotion(reduce.matches);
      schedule();
    };
    onReduce();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    narrow.addEventListener("change", schedule);
    reduce.addEventListener("change", onReduce);
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    measure();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      narrow.removeEventListener("change", schedule);
      reduce.removeEventListener("change", onReduce);
      ro.disconnect();
    };
  }, [count]);

  const api: BreakdownApi = { progress, position, step, count, reducedMotion, subscribe };

  return (
    <section ref={rootRef} className={className ? `${styles.root} ${className}` : styles.root} aria-label={label}>
      <div ref={stageRef} className={styles.stage}>
        <div className={styles.visual}>{visual(api)}</div>
        {caption ? <p className={`small muted ${styles.caption}`}>{caption}</p> : null}
      </div>
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li
            key={s.id}
            ref={(el) => {
              stepRefs.current[i] = el;
            }}
            className={styles.step}
            data-active={i === step ? "" : undefined}
            aria-current={i === step ? "step" : undefined}
          >
            <div className={styles.copy}>
              <h2 className={`h3 ${styles.title}`}>{s.title}</h2>
              <div className={styles.body}>{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- the canvas inside the visual ---------- */

export type BreakdownScene = {
  /** Draw a frame. dt is 0 for a redraw with no time passing. */
  frame(dt: number): void;
  /** The canvas changed size. */
  resize(): void;
  dispose(): void;
};

export type SceneContext = {
  canvas: HTMLCanvasElement;
  /** The element that holds the canvas and any HTML overlays. */
  host: HTMLElement;
  progress: RefObject<number>;
  position: RefObject<number>;
  reducedMotion: boolean;
  /** Ask for one redraw (after a drag, say) when no loop is running. */
  invalidate(): void;
};

export type SceneFactory = (T: typeof import("three"), ctx: SceneContext) => BreakdownScene;

type Mode = "loading" | "live" | "fallback";

/**
 * Mounts a three.js scene in host: loads three.js and the scene module on demand, runs a
 * frame loop only while the stage is on screen and the tab is visible, redraws on scroll,
 * and disposes everything on unmount. With reduced motion there is no loop: the scene
 * draws once per scroll change.
 */
export function useBreakdownCanvas(hostRef: RefObject<HTMLElement | null>, api: BreakdownApi, load: () => Promise<SceneFactory>): Mode {
  const [mode, setMode] = useState<Mode>("loading");
  const loadRef = useRef(load);
  const apiRef = useRef(api);
  useEffect(() => {
    loadRef.current = load;
    apiRef.current = api;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { progress, position, subscribe } = apiRef.current;
    const reducedMotion = window.matchMedia(REDUCE).matches;
    let cancelled = false;
    let scene: BreakdownScene | null = null;
    let canvas: HTMLCanvasElement | null = null;
    const cleanups: (() => void)[] = [];
    const loop = createLoop((dt) => scene?.frame(dt));
    let pending = 0;
    const invalidate = () => {
      if (loop.running || pending || !scene) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        scene?.frame(0);
      });
    };
    const toFallback = () => {
      if (cancelled) return;
      loop.stop();
      setMode("fallback");
      canvas?.remove();
      canvas = null;
    };

    (async () => {
      let T: typeof import("three");
      let factory: SceneFactory;
      try {
        [T, factory] = await Promise.all([import("three"), loadRef.current()]);
      } catch (err) {
        console.warn("Breakdown scene failed to load", err);
        toFallback();
        return;
      }
      if (cancelled) return;
      canvas = document.createElement("canvas");
      canvas.className = styles.canvas;
      canvas.setAttribute("aria-hidden", "true");
      host.insertBefore(canvas, host.firstChild);
      try {
        scene = factory(T, { canvas, host, progress, position, reducedMotion, invalidate });
      } catch (err) {
        if (!(err instanceof NoWebGLError)) console.warn("Breakdown scene unavailable", err);
        toFallback();
        return;
      }
      const onLost = (e: Event) => {
        e.preventDefault();
        toFallback();
      };
      canvas.addEventListener("webglcontextlost", onLost);
      cleanups.push(() => canvas?.removeEventListener("webglcontextlost", onLost));

      scene.frame(0);
      requestAnimationFrame(() => {
        if (!cancelled && canvas) setMode("live");
      });
      cleanups.push(
        watchActive(host, (active) => {
          if (active && !reducedMotion) loop.start();
          else loop.stop();
          if (active && reducedMotion) invalidate();
        }),
      );
      cleanups.push(subscribe(invalidate));
      const ro = new ResizeObserver(() => {
        scene?.resize();
        invalidate();
      });
      ro.observe(host);
      cleanups.push(() => ro.disconnect());
    })();

    return () => {
      cancelled = true;
      loop.stop();
      if (pending) cancelAnimationFrame(pending);
      cleanups.forEach((fn) => fn());
      scene?.dispose();
      scene = null;
      canvas?.remove();
    };
  }, [hostRef]);

  return mode;
}

type CanvasProps = {
  api: BreakdownApi;
  /** Resolves to the scene factory, usually with a dynamic import of the scene module. */
  load: () => Promise<SceneFactory>;
  /** HTML and SVG overlays drawn over the canvas (labels, leader lines). */
  children?: ReactNode;
  /** Shown when WebGL can't run. */
  fallback?: ReactNode;
  hostRef?: RefObject<HTMLDivElement | null>;
  className?: string;
};

/** The canvas host for a breakdown visual: fills the stage and stacks overlays on top. */
export function BreakdownCanvas({ api, load, children, fallback, hostRef, className }: CanvasProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = hostRef ?? ownRef;
  const mode = useBreakdownCanvas(ref, api, load);
  return (
    <div ref={ref} className={className ? `${styles.host} ${className}` : styles.host} data-mode={mode}>
      {children}
      {mode === "fallback" ? <p className={styles.fallback}>{fallback ?? "This drawing needs WebGL."}</p> : null}
    </div>
  );
}
