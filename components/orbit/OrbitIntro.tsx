"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { OrbitScene, SatFrame } from "./orbitScene";
import styles from "./OrbitIntro.module.css";

type Props = {
  /** False pauses the render loop (the film hides this layer after the first stop). */
  active?: boolean;
  className?: string;
  /** Shown until the first real frame, and kept when WebGL can't run. */
  poster?: string;
};

type Mode = "loading" | "live" | "fallback";

const HREF = "/projects/cubesat";

/**
 * The film's opening shot: Earth from low orbit with Josh's CubeSat drifting in. three.js
 * loads inside the effect, so it stays out of the first bundle.
 */
export default function OrbitIntro({ active = true, className, poster = "/film/01-orbit.webp" }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLAnchorElement>(null);
  const sceneRef = useRef<OrbitScene | null>(null);
  const activeRef = useRef(active);
  const syncRef = useRef<() => void>(() => {});
  const router = useRouter();
  const routerRef = useRef(router);
  const [mode, setMode] = useState<Mode>("loading");
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    activeRef.current = active;
    syncRef.current();
  }, [active]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMode("fallback");
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
    const cleanups: (() => void)[] = [];

    const toFallback = () => {
      if (cancelled) return;
      setMode("fallback");
      const label = labelRef.current;
      if (label) label.style.transform = "";
      if (canvas) canvas.style.cursor = "";
      scene?.setActive(false);
    };

    // The label follows the satellite: beside it on the right, or on the left when the
    // right edge is too close.
    const place = (f: SatFrame) => {
      const label = labelRef.current;
      if (!label) return;
      if (!labelW) {
        labelW = label.offsetWidth;
        labelH = label.offsetHeight;
      }
      const gap = 10;
      let x = f.right + gap;
      if (x + labelW > wrap.clientWidth - 12) x = f.left - gap - labelW;
      const y = Math.min(Math.max(f.cy - labelH / 2, 8), wrap.clientHeight - labelH - 8);
      label.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
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
          onReady: () => {
            if (!cancelled) setMode("live");
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
      sceneRef.current = scene;
      const s = scene;
      const c = canvas;

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

      // Hover brightens the satellite; a click on it opens the project.
      let px = 0;
      let py = 0;
      const onMove = (e: PointerEvent) => {
        px = e.clientX;
        py = e.clientY;
        if (hoverFrame) return;
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = 0;
          const hit = s.hitTest(px, py);
          s.setHover(hit);
          c.style.cursor = hit ? "pointer" : "";
        });
      };
      const onLeave = () => {
        s.setHover(false);
        c.style.cursor = "";
      };
      const onClick = (e: MouseEvent) => {
        if (s.hitTest(e.clientX, e.clientY)) routerRef.current.push(HREF);
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
        (window as unknown as { __orbitFrameMs?: () => number }).__orbitFrameMs = () => s.frameMs();
      }
    })();

    return () => {
      cancelled = true;
      syncRef.current = () => {};
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      io?.disconnect();
      ro?.disconnect();
      cleanups.forEach((f) => f());
      scene?.dispose();
      sceneRef.current = null;
      canvas?.remove();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className={className ? `${styles.wrap} ${className}` : styles.wrap}
      style={{ backgroundImage: `url(${poster})` }}
      data-mode={mode}
    >
      <Link ref={labelRef} href={HREF} className={styles.label} data-settled={settled ? "true" : "false"}>
        <span className={styles.name}>Queen&rsquo;s CubeSat</span>
        <span className={styles.open}>Open the project</span>
      </Link>
    </div>
  );
}
