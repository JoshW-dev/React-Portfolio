"use client";

import { useEffect } from "react";

/*
  On a project page that opens on a full-screen film frame, the animation under it is out of
  sight, so the page reads as one picture. A moment after the page opens, this scrolls down
  to the start of the animation. It does nothing if the visitor has already scrolled or
  touched the page, if the page did not open at the top, or with reduced motion on.
*/

const DELAY_MS = 900; // after the page transition has finished
const SCROLL_MS = 1100;
const INPUTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export default function HeroNudge() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.scrollY > 4) return;
    let stopped = false;
    let timer = 0;
    let raf = 0;
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
    INPUTS.forEach((t) => window.addEventListener(t, stop, { passive: true, once: true }));

    const run = () => {
      if (stopped || window.scrollY > 4) return;
      const hero = document.querySelector<HTMLElement>("article > header[data-film]");
      const next = hero?.nextElementSibling as HTMLElement | null;
      if (!hero || !next) return;
      const to = next.getBoundingClientRect().top + window.scrollY;
      const from = window.scrollY;
      const t0 = performance.now();
      const step = (now: number) => {
        if (stopped) return;
        const t = Math.min(1, (now - t0) / SCROLL_MS);
        window.scrollTo({ top: from + (to - from) * ease(t), behavior: "instant" });
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    // Waits out the page transition (TransitionLink marks <html> while it runs).
    const start = performance.now();
    const wait = () => {
      if (stopped) return;
      if (document.documentElement.dataset.vt && performance.now() - start < 3000) {
        timer = window.setTimeout(wait, 100);
        return;
      }
      timer = window.setTimeout(run, DELAY_MS);
    };
    wait();

    return () => {
      stop();
      INPUTS.forEach((t) => window.removeEventListener(t, stop));
    };
  }, []);

  return null;
}
