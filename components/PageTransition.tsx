"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/*
  The route-ready signal for page transitions.

  TransitionLink starts a view transition and pushes the new route inside its update callback.
  The browser keeps showing the old page until that callback settles, so the callback awaits
  routeRendered(). This component settles it after the new pathname has committed (a passive
  effect, so Next has already reset the scroll in its layout effect) and the images on the
  first screen have decoded. A timer settles it after 1.5 s whatever happens, so a slow route
  never freezes the page.

  It also renders the 1px line that rides the edge of the wipe (styled in globals.css).
*/

const ROUTE_TIMEOUT = 1500;
const IMAGE_TIMEOUT = 400;

let settle: ((rendered: boolean) => void) | null = null;

/** Resolves true once the next route has rendered, or false if the timer ran out first. */
export function routeRendered(): Promise<boolean> {
  // A newer navigation replaces one that is still waiting.
  settle?.(false);
  return new Promise((resolve) => {
    const finish = (rendered: boolean) => {
      window.clearTimeout(timer);
      if (settle === finish) settle = null;
      resolve(rendered);
    };
    const timer = window.setTimeout(() => finish(false), ROUTE_TIMEOUT);
    settle = finish;
  });
}

/** Waits for the eagerly loaded images on the first screen to decode, up to IMAGE_TIMEOUT. */
function firstScreenImages(): Promise<unknown> {
  const height = window.innerHeight;
  const waits = Array.from(document.querySelectorAll<HTMLImageElement>("main img"))
    .filter((img) => {
      // Lazy images do not start loading while the transition holds rendering.
      if (img.loading === "lazy") return false;
      const box = img.getBoundingClientRect();
      return box.bottom > 0 && box.top < height && box.width > 0;
    })
    .map((img) => img.decode().catch(() => undefined));
  if (waits.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(waits),
    new Promise((resolve) => window.setTimeout(resolve, IMAGE_TIMEOUT)),
  ]);
}

export default function PageTransition() {
  const pathname = usePathname();

  useEffect(() => {
    const done = settle;
    if (!done) return;
    firstScreenImages().then(() => done(true));
  }, [pathname]);

  return <div className="vt-edge" aria-hidden="true" />;
}
