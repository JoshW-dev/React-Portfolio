"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import TransitionLink from "@/components/TransitionLink";
import type { OrbitScene, SatFrame } from "./orbitScene";
import styles from "./OrbitIntro.module.css";

/** What the film can do to the live scene while it runs. */
export type OrbitControl = {
  /** 0 to 1: rolls the planet from its own clock into the pose the first clip starts from. */
  setHandover(h: number): void;
};

type Props = {
  /** False pauses the render loop (the film hides this layer after the first stop). */
  active?: boolean;
  className?: string;
  /**
   * False draws only the CubeSat on a transparent canvas, with no poster behind it, so it
   * sits over whatever is under this layer. Read once, at mount.
   */
  earth?: boolean;
  /** Shown when WebGL can't run, with reduced motion, or when the planet is slow to load. */
  poster?: string;
  /** Filled with the scene's controls once it exists. */
  control?: { current: OrbitControl | null };
  /** Called once, when the planet (or the poster standing in for it) is first on screen. */
  onShown?: (live: boolean) => void;
};

type Mode = "loading" | "live" | "fallback";

const HREF = "/projects/cubesat";
/** After this long without a planet, the poster stands in and the planet joins it later. */
const LATE_MS = 2600;
/** Gap between the ring and the leader line, the leader's length, and the gap to the label. */
const GAP = 6;
const LEADER = 30;
const LABEL_GAP = 8;
const EDGE = 14;

/**
 * The film's opening shot: Earth from low orbit with Josh's CubeSat drifting in. three.js
 * loads inside the effect, so it stays out of the first bundle.
 */
export default function OrbitIntro({ active = true, className, earth = true, poster = "/film/00-orbit-live.webp", control, onShown }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLAnchorElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const leaderRef = useRef<HTMLSpanElement>(null);
  const activeRef = useRef(active);
  const syncRef = useRef<() => void>(() => {});
  const shownRef = useRef(onShown);
  const [mode, setMode] = useState<Mode>("loading");
  const [late, setLate] = useState(false);
  const [settled, setSettled] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    shownRef.current = onShown;
  }, [onShown]);

  useEffect(() => {
    activeRef.current = active;
    syncRef.current();
  }, [active]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let told = false;
    const tell = (live: boolean) => {
      if (told) return;
      told = true;
      shownRef.current?.(live);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMode("fallback");
      tell(false);
      return;
    }

    let cancelled = false;
    let scene: OrbitScene | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let io: IntersectionObserver | null = null;
    let ro: ResizeObserver | null = null;
    let hoverFrame = 0;
    let labelW = 0;
    let labelH = 0;
    let wasSettled = false;
    let side: "right" | "left" | "below" = "right";
    let isLate = false;
    let isLive = false;
    const last = { cx: 0, cy: 0, radius: 0, settled: false };
    const cleanups: (() => void)[] = [];

    const lateTimer = window.setTimeout(() => {
      if (cancelled || isLive) return;
      // The planet is slow: show the poster now, and start the planet on the poster's pose
      // when it comes, so it joins without a jump.
      isLate = true;
      setLate(true);
      scene?.holdCapture();
      tell(false);
    }, LATE_MS);
    cleanups.push(() => clearTimeout(lateTimer));

    const toFallback = () => {
      if (cancelled) return;
      setMode("fallback");
      const label = labelRef.current;
      if (label) label.style.transform = "";
      if (canvas) canvas.style.cursor = "";
      scene?.setActive(false);
      if (control) control.current = null;
      tell(false);
    };

    // The ring sits on the satellite, with the label beside it on a short leader: to the
    // right, to the left when the right is too close to the edge, or below on narrow screens.
    const place = (f: SatFrame) => {
      const label = labelRef.current;
      const ring = ringRef.current;
      const leader = leaderRef.current;
      if (!label || !ring || !leader) return;
      if (!labelW) {
        labelW = label.offsetWidth;
        labelH = label.offsetHeight;
      }
      last.cx = f.cx;
      last.cy = f.cy;
      last.radius = f.radius;
      last.settled = f.settled;
      const W = wrap.clientWidth;
      const r = f.radius;
      const reach = r + GAP + LEADER + LABEL_GAP;
      const fitsRight = f.cx + reach + labelW <= W - EDGE;
      const fitsLeft = f.cx - reach - labelW >= EDGE;
      if (!(side === "right" && fitsRight) && !(side === "left" && fitsLeft)) {
        side = fitsRight ? "right" : fitsLeft ? "left" : "below";
      }
      ring.style.transform = `translate3d(${(f.cx - r).toFixed(1)}px, ${(f.cy - r).toFixed(1)}px, 0)`;
      const d = `${(2 * r).toFixed(1)}px`;
      if (ring.style.width !== d) {
        ring.style.width = d;
        ring.style.height = d;
      }
      let lx: number;
      let ly: number;
      if (side === "below") {
        lx = Math.min(Math.max(f.cx - labelW / 2, EDGE), W - EDGE - labelW);
        ly = f.cy + r + GAP + LEADER * 0.75 + LABEL_GAP * 0.5;
        leader.style.transform = `translate3d(${f.cx.toFixed(1)}px, ${(f.cy + r + GAP).toFixed(1)}px, 0) rotate(90deg) scaleX(${(LEADER * 0.75).toFixed(1)})`;
      } else {
        const dir = side === "right" ? 1 : -1;
        const start = f.cx + dir * (r + GAP);
        lx = side === "right" ? f.cx + reach : f.cx - reach - labelW;
        ly = f.cy - labelH / 2;
        leader.style.transform = `translate3d(${start.toFixed(1)}px, ${f.cy.toFixed(1)}px, 0) rotate(${dir > 0 ? 0 : 180}deg) scaleX(${LEADER})`;
      }
      label.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0)`;
      if (f.settled && !wasSettled) {
        wasSettled = true;
        setSettled(true);
      }
    };

    (async () => {
      let T: typeof import("three");
      let mod: typeof import("./orbitScene");
      try {
        [T, mod] = await Promise.all([import("three"), import("./orbitScene")]);
      } catch (err) {
        console.warn("Orbit scene failed to load", err);
        toFallback();
        return;
      }
      if (cancelled) return;

      canvas = document.createElement("canvas");
      canvas.className = styles.canvas;
      canvas.setAttribute("aria-hidden", "true");
      wrap.insertBefore(canvas, wrap.firstChild);

      try {
        scene = mod.createOrbitScene(T, {
          canvas,
          earth,
          lead: !isLate,
          onReady: () => {
            if (cancelled) return;
            isLive = true;
            setMode("live");
            tell(true);
          },
          onFail: toFallback,
          onFrame: place,
        });
      } catch (err) {
        if (!(err instanceof mod.OrbitUnsupportedError)) console.warn("Orbit scene unavailable", err);
        canvas.remove();
        canvas = null;
        toFallback();
        return;
      }
      const s = scene;
      const c = canvas;
      if (control) control.current = { setHandover: (h) => s.setHandover(h) };

      let onScreen = true;
      let shown = document.visibilityState === "visible";
      const sync = () => s.setActive(activeRef.current && onScreen && shown);
      syncRef.current = sync;
      io = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      });
      io.observe(wrap);
      const onVisibility = () => {
        shown = document.visibilityState === "visible";
        sync();
      };
      document.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
      ro = new ResizeObserver(() => {
        labelW = 0;
        s.resize();
      });
      ro.observe(wrap);
      sync();

      // Over the satellite, or inside its ring once it has settled.
      const hit = (x: number, y: number) => {
        if (s.hitTest(x, y)) return true;
        if (!last.settled) return false;
        const r = c.getBoundingClientRect();
        return Math.hypot(x - r.left - last.cx, y - r.top - last.cy) < last.radius;
      };

      // Hover brightens the satellite and its ring; a click opens the project through the
      // label's own link, so the page transition is the same.
      let px = 0;
      let py = 0;
      let over = false;
      const onMove = (e: PointerEvent) => {
        px = e.clientX;
        py = e.clientY;
        if (hoverFrame) return;
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = 0;
          const on = hit(px, py);
          if (on === over) return;
          over = on;
          s.setHover(on);
          setHover(on);
          c.style.cursor = on ? "pointer" : "";
        });
      };
      const onLeave = () => {
        over = false;
        s.setHover(false);
        setHover(false);
        c.style.cursor = "";
      };
      const onClick = (e: MouseEvent) => {
        if (hit(e.clientX, e.clientY)) labelRef.current?.click();
      };
      c.addEventListener("pointermove", onMove);
      c.addEventListener("pointerleave", onLeave);
      c.addEventListener("click", onClick);
      cleanups.push(() => {
        c.removeEventListener("pointermove", onMove);
        c.removeEventListener("pointerleave", onLeave);
        c.removeEventListener("click", onClick);
      });

      if (process.env.NODE_ENV !== "production") {
        const w = window as unknown as { __orbitFrameMs?: () => number; __orbit?: unknown };
        w.__orbitFrameMs = () => s.frameMs();
        w.__orbit = { ...s.debug, setHandover: s.setHandover, canvas: c, last };
        cleanups.push(() => {
          delete w.__orbit;
          delete w.__orbitFrameMs;
        });
      }
    })();

    return () => {
      cancelled = true;
      syncRef.current = () => {};
      if (control) control.current = null;
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      io?.disconnect();
      ro?.disconnect();
      cleanups.forEach((f) => f());
      scene?.dispose();
      canvas?.remove();
    };
    // earth, poster and control are read once, at mount.
  }, []);

  return (
    <div
      ref={wrapRef}
      className={className ? `${styles.wrap} ${className}` : styles.wrap}
      style={earth ? ({ "--poster": `url(${poster})` } as CSSProperties) : undefined}
      data-earth={earth ? undefined : "false"}
      data-mode={mode}
      data-late={late ? "true" : undefined}
      data-settled={settled ? "true" : "false"}
      data-hover={hover ? "true" : undefined}
    >
      <span ref={ringRef} className={styles.ring} aria-hidden="true">
        <span className={styles.pulse} />
      </span>
      <span ref={leaderRef} className={styles.leader} aria-hidden="true" />
      <TransitionLink ref={labelRef} href={HREF} className={styles.label}>
        <span className={styles.name}>Queen&rsquo;s CubeSat</span>
        <span className={styles.open}>Open the project</span>
      </TransitionLink>
    </div>
  );
}
