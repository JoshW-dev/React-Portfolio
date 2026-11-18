"use client";

import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";
import { whenShown } from "@/lib/handoff";
import { MotionFade, motionAllowed } from "@/components/film/movingStill";
import { firstState, useSketchReveal } from "@/components/film/sketchReveal";
import sketchStyles from "@/components/film/HeroSketch.module.css";
import { RingsEngine } from "./ringsEngine";
import styles from "./RingsBackdrop.module.css";

/*
  The Accretion Rings scene as a backdrop. On a fresh visit it opens on a vector sketch of its
  picture (components/film/HeroSketch.tsx) that draws in while the picture loads. Then it
  shows as a plain picture: a still of the scene at its first moment, framed by the same rules
  (object-fit: cover at `position`). Once the page has settled, the live scene builds its dots, tests the machine
  unseen (MotionFade, shared with the film), then fades in over the picture and lets the
  rings start turning, slowly at first. A slow machine keeps the picture.
*/

type Props = {
  poster: string;
  alt: string;
  /** Like CSS object-position, as fractions. */
  position?: [number, number];
  /** Sizes the box; by default it fills the screen's height from the top of its parent. */
  className?: string;
  preload?: boolean;
  /** A vector sketch of the poster, shown until the poster has loaded. */
  sketch?: ReactNode;
};

const SETTLE_MS = 700;
const later = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export default function RingsBackdrop({ poster, alt, position = [0.5, 0.5], className, preload, sketch }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [px, py] = position;
  // The swap from the sketch to the poster.
  const { fromHtml, settled } = useSketchReveal(boxRef, imgRef, { settleMs: SETTLE_MS });

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas || !motionAllowed()) return;
    let disposed = false;
    let engine: RingsEngine | null = null;
    const fade = new MotionFade();
    let raf = 0;
    let prev = 0;
    let t = 0;
    let inView = true;

    const frame = (now: number) => {
      raf = 0;
      if (!engine) return;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0;
      prev = now;
      const want = engine.ready && inView && !document.hidden;
      fade.step(dt, want, true);
      if (fade.drawNow) {
        // Held at the poster's moment until it shows, then the turning eases in.
        if (fade.opacity > 0) t += dt * fade.strength;
        engine.draw(t);
      }
      const state = fade.off ? "off" : engine.ready ? "ready" : "loading";
      if (canvas.dataset.state !== state) canvas.dataset.state = state;
      canvas.style.opacity = fade.opacity.toFixed(3);
      canvas.style.visibility = fade.opacity > 0 ? "visible" : "hidden";
      if (!fade.off && (want || fade.opacity > 0)) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf && engine && !disposed && !document.hidden) {
        prev = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      kick();
    });
    io.observe(box);
    const ro = new ResizeObserver(() => {
      engine?.resize();
      kick();
    });
    ro.observe(box);
    document.addEventListener("visibilitychange", kick);

    (async () => {
      await whenShown();
      await later(await settled());
      if (disposed) return;
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      engine = new RingsEngine(canvas, { position: [px, py], density: coarse ? 0.55 : 1, onReady: kick });
      if (!engine.ok) {
        engine = null;
        canvas.dataset.state = "off";
      }
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", kick);
      engine?.dispose();
    };
  }, [px, py]);

  return (
    <div
      ref={boxRef}
      className={className ?? styles.box}
      data-sketch={sketch ? firstState(fromHtml) : undefined}
      // The sketch's script may set data-sketch and data-js before the page hydrates.
      suppressHydrationWarning
    >
      {sketch}
      <Image
        ref={imgRef}
        src={poster}
        alt={alt}
        fill
        preload={preload}
        sizes="100vw"
        className={`${styles.image} ${sketchStyles.photo}`}
        style={{ objectPosition: `${px * 100}% ${py * 100}%` }}
      />
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
    </div>
  );
}
