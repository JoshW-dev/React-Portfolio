"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useRef } from "react";
import { takeDive, whenShown, type Dive } from "@/lib/dive";
import type { Loop } from "@/lib/film";
import FilmLoop, { loopFile, startLoop } from "./FilmLoop";
import { MotionFade, MovingStill, motionAllowed, type Motion } from "./movingStill";
import styles from "./HeroFrame.module.css";

/*
  A project page's hero frame: the film's picture for the project, full-bleed.

  It always shows as a plain picture first. Once the page has opened and settled, a moving
  still (movingStill.ts) tests the machine unseen, then fades in over the picture and lets one
  thing in it move, the same way the film does at that stop. A frame with a cinemagraph loop
  (FilmLoop.tsx) plays that loop the same way.

  Opened from a ring in the film, it starts zoomed into the ring's point and eases back out
  while the title comes up (lib/dive.ts).
*/

type Props = { src: string; alt: string; motion?: Motion; loop?: Loop };

/** The frames are 16:9 near enough (1344 x 752 and 1600 x 906). */
const ASPECT = 16 / 9;
const OUT_MS = 1300; // the ease back out of a dive
const SETTLE_MS = 700; // the page settles this long before the moving still may start
const DRAW_MS = 30;

const later = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export default function HeroFrame({ src, alt, motion, loop }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<HTMLVideoElement>(null);
  const dived = useRef(false);
  // Taken once per mount and kept, because React may run the effect below twice.
  const diveRef = useRef<Dive | null | undefined>(undefined);

  // The dive: zoomed into the ring's point before the first paint, eased out once the page shows.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || typeof box.animate !== "function") return;
    if (diveRef.current === undefined) diveRef.current = takeDive();
    const d = diveRef.current;
    if (!d) return;
    dived.current = true;
    const r = box.getBoundingClientRect();
    const w = Math.max(r.width, r.height * ASPECT);
    const h = w / ASPECT;
    const px = (r.width - w) / 2 + d.x * w;
    const py = (r.height - h) / 2 + d.y * h;
    const from = Math.max(1.2, d.scale * 0.8);
    box.style.transformOrigin = `${px.toFixed(1)}px ${py.toFixed(1)}px`;
    box.style.transform = `scale(${from})`;
    const words = box.parentElement?.querySelector<HTMLElement>("[data-hero-text]");
    if (words) words.style.opacity = "0";
    let gone = false;
    whenShown().then(() => {
      if (gone) return;
      box.style.transform = "";
      box.animate([{ transform: `scale(${from})` }, { transform: "scale(1)" }], {
        duration: OUT_MS,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      });
      if (words) {
        words.style.opacity = "";
        words.animate(
          [
            { opacity: 0, transform: "translateY(14px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 700, delay: 380, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards" },
        );
      }
    });
    return () => {
      gone = true;
      box.style.transform = "";
      if (words) words.style.opacity = "";
    };
  }, []);

  // The moving still, once the page has settled, if the machine can keep up.
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!motion || !canvas || !box || !motionAllowed()) return;
    let disposed = false;
    let still: MovingStill | null = null;
    const fade = new MotionFade();
    let raf = 0;
    let prev = 0;
    let lastDraw = 0;
    let t0 = 0;
    let inView = true;

    const frame = (now: number) => {
      raf = 0;
      if (!still) return;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0;
      prev = now;
      const ready = still.prepare(src, null, motion.map);
      const want = ready && inView && !document.hidden;
      const was = fade.opacity;
      fade.step(dt, want, true);
      if (fade.drawNow && (was === 0 || now - lastDraw >= DRAW_MS)) {
        if (still.draw({ a: src, b: null, map: motion.map, mix: 0, amp: fade.strength, time: (now - t0) / 1000, motion })) lastDraw = now;
      }
      canvas.style.opacity = fade.opacity.toFixed(3);
      canvas.style.visibility = fade.opacity > 0 ? "visible" : "hidden";
      if (!fade.off && (want || fade.opacity > 0 || (!ready && still.live))) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf && still && !disposed && !document.hidden) {
        prev = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      kick();
    });
    io.observe(box);
    document.addEventListener("visibilitychange", kick);

    (async () => {
      await whenShown();
      await later(dived.current ? OUT_MS : SETTLE_MS);
      if (disposed) return;
      still = new MovingStill(canvas);
      if (!still.ok) return;
      t0 = performance.now();
      kick();
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", kick);
      still?.dispose();
    };
  }, [src, motion]);

  // The loop, on the same terms: after the page settles, once it plays and the machine keeps up.
  useEffect(() => {
    const el = loopRef.current;
    const box = boxRef.current;
    if (!loop || !el || !box || !motionAllowed()) return;
    let disposed = false;
    let started = false;
    let starting = false;
    let playing = false;
    const fade = new MotionFade();
    let raf = 0;
    let prev = 0;
    let inView = true;
    // Phones and slow links take the half-size loop.
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    const part = ["slow-2g", "2g", "3g"].includes(conn?.effectiveType ?? "") ? "m" : "hd";

    const frame = (now: number) => {
      raf = 0;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0;
      prev = now;
      const wanted = inView && !document.hidden && !fade.off;
      if (wanted && !playing && !starting) {
        starting = true;
        void startLoop(el, loopFile(loop, part), fade.opacity === 0).then((r) => {
          starting = false;
          playing = r === "playing";
          if (r === "blocked") fade.off = true;
          kick();
        });
      }
      if (!wanted && playing) {
        el.pause();
        playing = false;
      }
      fade.step(dt, wanted && playing && el.readyState >= 3 && !el.error, true);
      el.style.opacity = fade.opacity.toFixed(3);
      el.style.visibility = fade.opacity > 0 ? "visible" : "hidden";
      if (!fade.off && (wanted || fade.opacity > 0)) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf && started && !disposed && !document.hidden) {
        prev = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      kick();
    });
    io.observe(box);
    document.addEventListener("visibilitychange", kick);

    (async () => {
      await whenShown();
      await later(dived.current ? OUT_MS : SETTLE_MS);
      if (disposed) return;
      started = true;
      kick();
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", kick);
      el.pause();
    };
  }, [loop]);

  return (
    <div ref={boxRef} className={styles.box}>
      {/* The film's own files, already sized, so a page opened from the film has them cached. */}
      <Image src={src} alt={alt} fill preload unoptimized sizes="100vw" className={styles.image} />
      {motion && <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />}
      {loop && <FilmLoop loop={loop} videoRef={loopRef} />}
    </div>
  );
}
