"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useRef } from "react";
import { sameMotion, takeHandoff, whenShown, type Handoff } from "@/lib/handoff";
import type { Loop } from "@/lib/film";
import FilmLoop, { keptLoop, loopFile, startLoop } from "./FilmLoop";
import { MotionFade, MovingStill, motionAllowed, type Motion } from "./movingStill";
import styles from "./HeroFrame.module.css";

/*
  A project page's hero frame: the film's picture for the project, framed the way the film
  frames it (the whole screen, under object-fit: cover). The hero shows the top of it.

  It always shows as a plain picture first. Once the page has opened and settled, a moving
  still (movingStill.ts) tests the machine unseen, then fades in over the picture and lets one
  thing in it move, the same way the film does at that stop. A frame with a cinemagraph loop
  (FilmLoop.tsx) plays that loop the same way.

  Opened from the film (lib/handoff.ts), it holds the film's push-in, and a loop or moving still
  that was showing there carries on at once, from the same moment and the same file.
*/

type Props = { src: string; alt: string; motion?: Motion; loop?: Loop };

const SETTLE_MS = 700; // the page settles this long before the moving still may start
/**
 * A carried-on loop or moving still that is ready by the time the wipe starts, or this soon
 * after, shows at full at once. Later than that it fades in as usual, so it never pops in on a
 * page already showing.
 */
const CARRY_MS = 250;
const DRAW_MS = 30;

const later = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export default function HeroFrame({ src, alt, motion, loop }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<HTMLVideoElement>(null);
  // Taken once per mount and kept, because React may run the effects below twice.
  const handRef = useRef<Handoff | null | undefined>(undefined);
  const hand = () => {
    if (handRef.current === undefined) handRef.current = takeHandoff();
    return handRef.current;
  };

  // The film's push-in, set before the first paint, so the wipe shows the picture where it was.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const h = hand();
    if (!box || !h || Math.abs(h.scale - 1) < 1e-4) return;
    box.style.transform = `scale(${h.scale.toFixed(4)})`;
    return () => {
      box.style.transform = "";
    };
  }, []);

  // The moving still, once the page has settled, if the machine can keep up.
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!motion || !canvas || !box || !motionAllowed()) return;
    const h = hand();
    // The film showed this motion in full a moment ago: carry it on, on the film's clock.
    const carried = h?.motion && sameMotion(h.motion.map, motion.map) ? h.motion : null;
    let resume = !!carried;
    let shownAt = 0;
    void whenShown().then(() => (shownAt = performance.now()));
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
      // For checks: where the moving still is (loading its pictures, ready, or turned off).
      const state = fade.off ? "off" : ready ? "ready" : "loading";
      if (canvas.dataset.state !== state) canvas.dataset.state = state;
      if (resume && ready) {
        if (!shownAt || now - shownAt < CARRY_MS) fade.resume();
        resume = false;
      }
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
      if (!carried) {
        await whenShown();
        await later(SETTLE_MS);
      }
      if (disposed) return;
      still = new MovingStill(canvas);
      if (!still.ok) return;
      t0 = carried && h ? h.at - carried.time * 1000 : performance.now();
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
    const h = hand();
    // The film showed this loop in full a moment ago: play its file on from the same moment.
    const carried = h?.loop?.src === loop.src ? h.loop : null;
    let resume = !!carried;
    let shownAt = 0;
    void whenShown().then(() => (shownAt = performance.now()));
    let disposed = false;
    let started = false;
    let starting = false;
    let playing = false;
    const fade = new MotionFade();
    let raf = 0;
    let prev = 0;
    let inView = true;
    const rate = loop.rate ?? 1;
    // Phones and slow links take the half-size loop, unless the film has a file in memory.
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    const part = ["slow-2g", "2g", "3g"].includes(conn?.effectiveType ?? "") ? "m" : "hd";
    const file = carried?.url ?? keptLoop(loop) ?? loopFile(loop, part);
    const onMeta = () => {
      if (!carried || !h || !(el.duration > 0)) return;
      el.currentTime = (carried.time + ((performance.now() - h.at) / 1000) * rate) % el.duration;
    };
    if (carried) {
      el.src = carried.url;
      el.addEventListener("loadedmetadata", onMeta, { once: true });
    }

    const frame = (now: number) => {
      raf = 0;
      const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0;
      prev = now;
      const wanted = inView && !document.hidden && !fade.off;
      if (wanted && !playing && !starting) {
        starting = true;
        void startLoop(el, file, fade.opacity === 0 && !resume, rate).then((r) => {
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
      if (resume && playing && el.readyState >= 2) {
        if (!shownAt || now - shownAt < CARRY_MS) fade.resume();
        resume = false;
      }
      const flowing = el.readyState >= 3 || fade.opacity > 0;
      fade.step(dt, wanted && playing && flowing && !el.error, true);
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
      if (!carried) {
        await whenShown();
        await later(SETTLE_MS);
      }
      if (disposed) return;
      started = true;
      kick();
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", kick);
      el.removeEventListener("loadedmetadata", onMeta);
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
