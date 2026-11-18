"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import TransitionLink from "@/components/TransitionLink";
import { filmUrl } from "@/lib/filmUrl";
import { LinesHost, releaseSpareWorker } from "./linesHost";
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
  /** Called once, when the planet (or the lines or poster standing in for it) is first on screen. */
  onShown?: (live: boolean) => void;
};

type Mode = "loading" | "live" | "fallback";

const HREF = "/projects/cubesat";
/** After this long without a planet, the poster stands in and the planet joins it later. */
const LATE_MS = 2600;
/** Over the lines, the planet waits this long from their start, so they have time to turn. */
const LINES_MIN_MS = 4500;
/** The planet comes up over the lines from the bottom of the screen: a wipe this long... */
const WIPE_MS = 2400;
/** ...with a soft edge this tall, in percent of the height (the same in OrbitIntro.module.css). */
const WIPE_FEATHER = 28;
/** Gap between the ring and the leader line, the leader's length, and the gap to the label. */
const GAP = 6;
const LEADER = 30;
const LABEL_GAP = 8;
const EDGE = 14;

/**
 * The film's opening shot: Earth from low orbit with Josh's CubeSat drifting in. three.js
 * loads inside the effect, so it stays out of the first bundle.
 */
/**
 * Lens-flare ghosts: t is how far along the line from the sun through the middle of the frame
 * (1 is the middle, 2 the mirror of the sun), size in vmin, a tint and an opacity. Faint, so
 * they read as glass catching the light rather than as shapes.
 */
const GHOSTS: { t: number; size: number; tint: string; o: number; ring?: boolean }[] = [
  { t: 0.38, size: 2.4, tint: "255 214 170", o: 0.14 },
  { t: 0.66, size: 7, tint: "150 200 255", o: 0.035, ring: true },
  { t: 1.16, size: 3.6, tint: "190 255 220", o: 0.06 },
  { t: 1.46, size: 12, tint: "170 150 255", o: 0.025, ring: true },
  { t: 1.74, size: 1.7, tint: "255 236 200", o: 0.12 },
];

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
      releaseSpareWorker();
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

    // ---- The lines ------------------------------------------------------------------------
    // Earth's curvature in lines (earthLines.ts), drawn at once while three.js and the
    // planet's textures load. When it is ready, and not before the lines have had time to
    // turn, the planet wipes up over them from the bottom of the screen.
    let lines: LinesHost | null = null;
    let linesRaf = 0;
    let linesAt = 0;
    let wipeAt = 0;
    let planetSync: () => void = () => {};
    let sceneHandover: ((h: number) => void) | null = null;
    const stopLines = () => {
      if (linesRaf) cancelAnimationFrame(linesRaf);
      linesRaf = 0;
      lines?.dispose();
      lines = null;
      delete wrap.dataset.lines;
    };
    // The lines draw themselves, off the main thread where the browser allows (linesHost.ts).
    // This loop only runs the wipe: the planet wipes up from the bottom and fades in as it
    // goes, the lines glow just ahead of its edge, and they are freed once it has passed the
    // top. The whole wipe runs over the planet: it ends once the soft edge has cleared the
    // atmosphere above the horizon (the sky is black in both pictures).
    const wipeFrame = (now: number) => {
      linesRaf = 0;
      if (!lines || !wipeAt) return;
      const k = Math.min(1, (now - wipeAt) / WIPE_MS);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * k);
      const top = Math.min(100, (lines.horizonTop + 1) * 50 + 14) + WIPE_FEATHER;
      const front = k >= 1 ? 100 + WIPE_FEATHER : e * top;
      wrap.style.setProperty("--wipe", front.toFixed(2));
      wrap.style.setProperty("--planet", Math.min(1, 0.15 + k * 1.5).toFixed(3));
      lines.setWipe(-1 + front / 50, 1 - k);
      if (k >= 1) {
        stopLines();
        return;
      }
      if (activeRef.current && document.visibilityState === "visible") linesRaf = requestAnimationFrame(wipeFrame);
    };
    const linesSync = () => {
      if (!lines) return;
      const on = !!activeRef.current && document.visibilityState === "visible";
      lines.run(on);
      if (on && wipeAt && !linesRaf) linesRaf = requestAnimationFrame(wipeFrame);
    };
    // As the film starts its first flight, the lines go with the sun.
    const handover = (h: number) => {
      sceneHandover?.(h);
      wrap.style.setProperty("--sun", (1 - h).toFixed(3));
      if (lines) lines.canvas.style.opacity = (1 - h).toFixed(3);
    };
    if (earth) {
      const c = document.createElement("canvas");
      c.className = styles.lines;
      c.setAttribute("aria-hidden", "true");
      wrap.insertBefore(c, wrap.firstChild);
      const phone = window.matchMedia("(pointer: coarse)").matches || wrap.clientWidth < 700;
      const l = new LinesHost(c, {
        density: phone ? 0.7 : 1,
        // A machine that can't keep up gets the poster instead.
        onSlow: () => {
          if (isLive) return;
          stopLines();
          isLate = true;
          setLate(true);
          scene?.holdCapture();
        },
        onFail: () => {
          if (!isLive) stopLines();
        },
      });
      if (l.ok) {
        lines = l;
        linesAt = performance.now();
        wrap.dataset.lines = "on";
        if (control) control.current = { setHandover: handover };
        const lro = new ResizeObserver(() => lines?.resize());
        lro.observe(wrap);
        cleanups.push(() => lro.disconnect());
        document.addEventListener("visibilitychange", linesSync);
        cleanups.push(() => document.removeEventListener("visibilitychange", linesSync));
        linesSync();
        tell(false);
      } else {
        l.dispose();
      }
    }
    if (!lines) releaseSpareWorker();
    syncRef.current = () => {
      linesSync();
      planetSync();
    };
    cleanups.push(stopLines);

    const lateTimer = window.setTimeout(() => {
      // The lines stand in for the planet for as long as it takes.
      if (cancelled || isLive || lines) return;
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
      // The lines, if they run, stay on in front of the poster.
      sceneHandover = null;
      if (control) control.current = lines ? { setHandover: handover } : null;
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
      // Above the lines, so the planet fades up over them.
      wrap.insertBefore(canvas, lines ? lines.canvas.nextSibling : wrap.firstChild);

      try {
        scene = mod.createOrbitScene(T, {
          canvas,
          earth,
          lead: !isLate,
          onReady: () => {
            if (cancelled) return;
            const wait = lines ? Math.max(0, linesAt + LINES_MIN_MS - performance.now()) : 0;
            window.setTimeout(() => {
              if (cancelled) return;
              isLive = true;
              if (lines) {
                // The planet ran unseen under the lines: bring the satellite in from the start.
                scene?.rewind();
                wasSettled = false;
                setSettled(false);
                wrap.style.setProperty("--wipe", "0");
                wrap.style.setProperty("--planet", "0");
                wipeAt = performance.now();
                linesSync();
              }
              setMode("live");
              tell(true);
            }, wait);
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
      // The sun goes as the planet rolls into the film's first frame, which has none.
      sceneHandover = (h) => s.setHandover(h);
      if (control) control.current = { setHandover: handover };

      let onScreen = true;
      let shown = document.visibilityState === "visible";
      const sync = () => s.setActive(activeRef.current && onScreen && shown);
      planetSync = sync;
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
      style={earth ? ({ "--poster": `url(${filmUrl(poster)})` } as CSSProperties) : undefined}
      data-earth={earth ? undefined : "false"}
      data-mode={mode}
      data-late={late ? "true" : undefined}
      data-settled={settled ? "true" : "false"}
      data-hover={hover ? "true" : undefined}
    >
      {/* The sun, low and to the left, where the planet's light comes from, with the faint
          flare a lens makes of it: a streak through it and ghosts along the line from it
          through the middle of the frame. */}
      {earth ? (
        <span className={styles.sky} aria-hidden="true">
          <span className={styles.streak} />
          <span className={styles.sun} />
          {GHOSTS.map((g, i) => (
            <span
              key={i}
              className={g.ring ? `${styles.ghost} ${styles.ghostRing}` : styles.ghost}
              style={{ "--t": g.t, "--size": `${g.size}vmin`, "--tint": g.tint, "--o": g.o } as CSSProperties}
            />
          ))}
        </span>
      ) : null}
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
