"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./FilmStoryboard.module.css";

/*
  The film as a storyboard you can scroll. Each stop is one still frame, and the
  scroll position moves between them the way the finished film will: a slow push
  forward, then a pass through something (cloud, steam, fog, dark water) into
  the next place. When the video exists, each still becomes a run of frames and
  everything else here stays.
*/

type Via = "start" | "cloud" | "fade" | "steam" | "wipe" | "fog" | "dark";

type Stop = {
  src: string;
  place: string;
  text: string;
  /** What the camera passes through to get here. */
  via: Via;
  how: string;
};

const STOPS: Stop[] = [
  {
    src: "/film/01-orbit.webp",
    place: "Low Earth orbit",
    text: "Hi, I’m Josh. I’m an AI engineer, and I’ve built things in a lot of places. Scroll and I’ll take you to them.",
    via: "start",
    how: "",
  },
  {
    src: "/film/02-rockies.webp",
    place: "Alberta Rockies",
    text: "After school I moved to Alberta and spent two years as an engineering consultant.",
    via: "cloud",
    how: "Down through the cloud deck, onto the ridge.",
  },
  {
    src: "/film/03-plant.webp",
    place: "Hydrogen plant, Alberta",
    text: "On a clean hydrogen plant, the design sessions I led cut more than $300M from the capital budget.",
    via: "fade",
    how: "Down the valley and out onto the prairie as the sun comes up.",
  },
  {
    src: "/film/04-line.webp",
    place: "Production lines, Texas and California",
    text: "On two production lines we cut downtime 35% in 8 weeks.",
    via: "steam",
    how: "Along the pipe rack, into the steam, and out onto the line.",
  },
  {
    src: "/film/05-twin.webp",
    place: "The same line, as software",
    text: "Then I moved to the software side. At Disco I built AI features and the automation behind sales and marketing, across more than 80,000 contacts.",
    via: "wipe",
    how: "The real line turns into its model as you scroll.",
  },
  {
    src: "/film/06-sf.webp",
    place: "San Francisco Bay",
    text: "Now I work at Alltus, which makes AI for local government.",
    via: "fog",
    how: "The model’s lines stretch out, the fog rolls in, and they become the bridge.",
  },
  {
    src: "/film/07-towns.webp",
    place: "Counties across the U.S.",
    text: "Our agents answer phone lines that take more than 100,000 calls a year, and one deployment helped run elections in North Carolina.",
    via: "fade",
    how: "East over the city as dusk turns to night.",
  },
  {
    src: "/film/08-nyc.webp",
    place: "New York, at night",
    text: "Nights are for my own projects: products, research, games and art.",
    via: "fade",
    how: "The town lights thicken into a grid, and the camera drops between the towers.",
  },
  {
    src: "/film/09-doha.webp",
    place: "Doha, November 2026",
    text: "I’m writing this from Doha. I’m based in Toronto and usually somewhere else.",
    via: "dark",
    how: "Out over dark water until the sun comes up on the far side.",
  },
];

const VEIL: Record<Via, string | null> = {
  start: null,
  fade: null,
  wipe: null,
  cloud: "#f4f6f8",
  steam: "#ffffff",
  fog: "#8b98a8",
  dark: "#05070b",
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t: number) => t * t * (3 - 2 * t);

export default function FilmStoryboard() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const veilRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const tourRef = useRef<number | null>(null);
  const [active, setActive] = useState(0);
  const [touring, setTouring] = useState(false);

  useEffect(() => {
    let raf = 0;
    const last = STOPS.length - 1;

    const paint = () => {
      raf = 0;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const x = clamp01(-rect.top / Math.max(1, span)) * last;
      const k = Math.min(last - 1, Math.floor(x));
      const f = x - k;
      // Each stop holds for a while, then the move to the next one happens.
      const t = ease(clamp01((f - 0.3) / 0.55));
      const next = STOPS[k + 1];

      layerRefs.current.forEach((el, i) => {
        if (!el) return;
        const life = clamp01((x - i + 1) / 2);
        el.style.transform = `scale(${(1.02 + 0.16 * life).toFixed(4)})`;
        if (i === k) {
          el.style.opacity = "1";
          el.style.clipPath = "none";
        } else if (i === k + 1) {
          if (next.via === "wipe") {
            el.style.opacity = "1";
            el.style.clipPath = `inset(0 ${((1 - t) * 100).toFixed(2)}% 0 0)`;
          } else {
            el.style.opacity = t.toFixed(3);
            el.style.clipPath = "none";
          }
        } else {
          el.style.opacity = "0";
        }
      });

      const veil = veilRef.current;
      if (veil) {
        const colour = VEIL[next.via];
        veil.style.background = colour ?? "transparent";
        veil.style.opacity = colour ? (Math.sin(Math.PI * t) * 0.92).toFixed(3) : "0";
      }
      const scan = scanRef.current;
      if (scan) {
        const on = next.via === "wipe" && t > 0.001 && t < 0.999;
        scan.style.opacity = on ? "1" : "0";
        scan.style.left = `${(t * 100).toFixed(2)}%`;
      }
      if (railRef.current) {
        railRef.current.style.transform = `scaleY(${(x / last).toFixed(4)})`;
      }
      const idx = t < 0.5 ? k : k + 1;
      setActive((prev) => (prev === idx ? prev : idx));
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const goTo = (i: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    const span = wrap.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + (span * i) / (STOPS.length - 1), behavior: "smooth" });
  };

  const stopTour = () => {
    if (tourRef.current) cancelAnimationFrame(tourRef.current);
    tourRef.current = null;
    setTouring(false);
  };

  // The tour: the page scrolls itself, about 5 seconds a stop, until someone takes over.
  const startTour = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    const end = top + wrap.offsetHeight - window.innerHeight;
    if (window.scrollY >= end - 4) window.scrollTo({ top });
    const speed = (wrap.offsetHeight - window.innerHeight) / (STOPS.length * 5);
    let prev = performance.now();
    setTouring(true);
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      window.scrollBy(0, speed * dt);
      if (window.scrollY >= end - 1) return stopTour();
      tourRef.current = requestAnimationFrame(step);
    };
    tourRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    if (!touring) return;
    const cancel = () => stopTour();
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("keydown", cancel);
    };
  }, [touring]);

  const stop = STOPS[active];

  return (
    <div
      className={styles.film}
      data-film
      ref={wrapRef}
      style={{ height: `${STOPS.length * 115}vh` }}
    >
      <div className={styles.screen}>
        {STOPS.map((s, i) => (
          <div
            key={s.src}
            ref={(el) => {
              layerRefs.current[i] = el;
            }}
            className={styles.layer}
            style={{ backgroundImage: `url(${s.src})`, opacity: i === 0 ? 1 : 0 }}
            role={i === active ? "img" : undefined}
            aria-label={i === active ? s.place : undefined}
          />
        ))}
        <div ref={veilRef} className={styles.veil} aria-hidden="true" />
        <div ref={scanRef} className={styles.scan} aria-hidden="true" />
        <div className={styles.shade} aria-hidden="true" />

        <div className={styles.caption} key={active}>
          <p className={styles.place}>{stop.place}</p>
          <p className={styles.text}>{stop.text}</p>
          {stop.how ? <p className={styles.how}>How we get here: {stop.how}</p> : null}
        </div>

        <nav className={styles.stops} aria-label="Stops in the film">
          <span className={styles.rail} aria-hidden="true">
            <span ref={railRef} />
          </span>
          <ol>
            {STOPS.map((s, i) => (
              <li key={s.src}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={i === active ? "true" : undefined}
                >
                  {s.place}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <button
          type="button"
          className={styles.tour}
          onClick={() => (touring ? stopTour() : startTour())}
        >
          {touring ? "Stop the tour" : "Play the tour"}
        </button>
      </div>
    </div>
  );
}
