"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import OrbitIntro from "@/components/orbit/OrbitIntro";
import { HOPS, SCROLL, STOPS, TOUR, VEILS, clipFile, type Hop } from "@/lib/film";
import styles from "./FilmScroll.module.css";

/*
  The film. Scrolling rests on a stop (a hold), then flies to the next one (a hop). A hop
  with a clip scrubs that clip's frames with the scroll position; a hop without one, or
  whose clip is still downloading, cross-fades stills. Stop and hop data live in lib/film.ts.

  Scrubbing follows the usual recipe for smooth video seeks: all-intra H.264, fetched whole
  into a Blob URL before seeking (iOS freezes on seeks into unloaded ranges), and the shown
  time eased toward the scroll's time each frame, seeking only when the last seek is done.
*/

type Kind = "video" | "wipe" | "fade";

const LAST = STOPS.length - 1;

/** One hop per pair of stops, whatever order or gaps HOPS has. */
const HOP_LIST: Hop[] = STOPS.slice(1).map(
  (_, i) => HOPS.find((h) => h.from === i && h.to === i + 1) ?? { from: i, to: i + 1, kind: "fade" },
);

const kindOf = (h: Hop): Kind => (h.kind === "video" ? (h.clip ? "video" : "fade") : h.kind);

/** A hold (resting on a stop) or a hop (flying to the next stop), in viewport heights. */
type Seg = { start: number; len: number; stop: number; hop: number | null };

const { SEGS, HOLD_SEG, HOP_SEG, TOTAL } = (() => {
  const segs: Seg[] = [];
  const holds: Seg[] = [];
  const hops: Seg[] = [];
  let at = 0;
  for (let i = 0; i <= LAST; i++) {
    const hold: Seg = { start: at, len: i === 0 ? SCROLL.firstHold : SCROLL.hold, stop: i, hop: null };
    segs.push(hold);
    holds.push(hold);
    at += hold.len;
    if (i < LAST) {
      const hop: Seg = { start: at, len: SCROLL[kindOf(HOP_LIST[i])], stop: i, hop: i };
      segs.push(hop);
      hops.push(hop);
      at += hop.len;
    }
  }
  return { SEGS: segs, HOLD_SEG: holds, HOP_SEG: hops, TOTAL: at };
})();

/** Where each stop's button scrolls to: the middle of its hold (the ends for the first and last). */
const REST = HOLD_SEG.map((s, i) => (i === 0 ? 0 : i === LAST ? TOTAL : s.start + s.len / 2));

const CLIP_HOPS = HOP_LIST.flatMap((h, i) => (kindOf(h) === "video" ? [i] : []));

/** Still layers, with the stretch of film they belong to, so each loads only when it is near. */
type Still = { key: string; bg: string; from: number; to: number; clip: boolean };
const STILLS: Still[] = [
  ...STOPS.flatMap((s, i): Still[] => {
    if (i === 0) return [];
    const after = HOP_SEG[i] ?? HOLD_SEG[i];
    return [{ key: `stop-${i}`, bg: `url(${s.still})`, from: HOP_SEG[i - 1].start, to: after.start + after.len, clip: false }];
  }),
  ...CLIP_HOPS.flatMap((h): Still[] => {
    const name = HOP_LIST[h].clip as string;
    const from = HOP_SEG[h].start;
    const to = from + HOP_SEG[h].len;
    // The stop's own still sits under each clip still, so a missing file never leaves a hole.
    const last = { key: `last-${h}`, bg: `url(${clipFile(name, "last.webp")}), url(${STOPS[h + 1].still})`, from, to, clip: true };
    if (h === 0) return [last];
    return [{ key: `first-${h}`, bg: `url(${clipFile(name, "first.webp")}), url(${STOPS[h].still})`, from, to, clip: true }, last];
  }),
];

const PUSH = 0.035; // push-in across a hold
const DRIFT = 0.012; // a slow breath while resting, so a held frame is never frozen
const DRIFT_MS = 16000;
const CAPTION_FADE = 22; // vh of scroll the caption takes to fade at each end of a hop
const ORBIT_FADE = 0.06; // share of hop 0 over which the live Earth hands over to the clip
const LOAD_NEAR = SCROLL.video + SCROLL.hold; // fetch a clip once within about one hop of it
const RELEASE_FAR = 3 * LOAD_NEAR; // drop its blob beyond this
const STILL_NEAR = 1.5 * LOAD_NEAR;
const EASE = 0.12; // share of the gap closed per 60 Hz frame
const SEEK_EPS = 0.005;
const HALF_FRAME = 0.5 / 24;
const PHONE = "(max-width: 800px)";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t: number) => t * t * (3 - 2 * t);
const distance = (x: number, from: number, to: number) => (x < from ? from - x : x > to ? x - to : 0);
const locate = (x: number) => SEGS.find((s) => x < s.start + s.len) ?? SEGS[SEGS.length - 1];
const hopProgress = (h: number, x: number) => clamp01((x - HOP_SEG[h].start) / HOP_SEG[h].len);

type Clip = {
  hop: number;
  name: string;
  state: "idle" | "loading" | "ready" | "failed";
  url: string | null;
  abort: AbortController | null;
  /** The time on screen, eased toward the scroll's time. */
  shown: number;
  dur: number;
};

/** What the screen shows at one scroll position. Layer keys: orbit, stop-i, first-h, last-h, video-h. */
type Shot = {
  base: string;
  top: string | null;
  alpha: number;
  /** 0 to 1: the top layer revealed from the left, for the line-to-twin hop. */
  wipe: number | null;
  veil: string | null;
  veilAlpha: number;
  scale: number;
  /** 0 to 1: how much of the resting breath applies. */
  rest: number;
  caption: number;
  stop: number;
};

function compose(x: number, ready: (h: number) => boolean, reduced: boolean): Shot {
  const kind = (h: number): Kind => {
    const k = kindOf(HOP_LIST[h]);
    return reduced ? "fade" : k;
  };
  const still = (i: number) => (i === 0 ? "orbit" : `stop-${i}`);
  const isClip = (h: number) => h >= 0 && h < LAST && kind(h) === "video";
  const startOf = (h: number) => (h === 0 ? "orbit" : ready(h) ? `video-${h}` : `first-${h}`);
  const endOf = (h: number) => (ready(h) ? `video-${h}` : `last-${h}`);
  // A hold shows the incoming clip's last frame and the outgoing clip's first frame, so
  // nothing pops; the wipe works on the stops' own stills.
  const arrive = (k: number) =>
    k === 0 ? "orbit" : kind(k - 1) === "wipe" ? still(k) : isClip(k - 1) ? endOf(k - 1) : isClip(k) ? startOf(k) : still(k);
  const depart = (k: number) =>
    k === 0 ? "orbit" : k < LAST && kind(k) === "wipe" ? still(k) : isClip(k) ? startOf(k) : isClip(k - 1) ? endOf(k - 1) : still(k);
  const push = (k: number) => (reduced || k === 0 ? 0 : PUSH);

  const seg = locate(x);
  const shot: Shot = { base: "orbit", top: null, alpha: 0, wipe: null, veil: null, veilAlpha: 0, scale: 1, rest: 0, caption: 1, stop: seg.stop };

  if (seg.hop === null) {
    const k = seg.stop;
    const u = clamp01((x - seg.start) / seg.len);
    shot.base = arrive(k);
    shot.top = depart(k);
    shot.alpha = ease(clamp01((u - 0.25) / 0.5));
    shot.scale = 1 + push(k) * u;
    shot.rest = reduced || k === 0 ? 0 : ease(Math.min(1, u / 0.25, (1 - u) / 0.25));
  } else {
    const h = seg.hop;
    const f = clamp01((x - seg.start) / seg.len);
    shot.scale = 1 + push(h) * (1 - f);
    shot.stop = f < 0.5 ? h : h + 1;
    // The words leave as the flight starts and come back as it lands, never mid-flight.
    shot.caption = 1 - clamp01((f < 0.5 ? x - seg.start : seg.start + seg.len - x) / CAPTION_FADE);
    const k = kind(h);
    if (k === "video" && ready(h)) {
      if (h === 0) {
        shot.base = "orbit";
        shot.top = "video-0";
        shot.alpha = ease(clamp01(f / ORBIT_FADE));
      } else {
        shot.base = `video-${h}`;
      }
    } else if (k === "video") {
      shot.base = startOf(h);
      shot.top = `last-${h}`;
      shot.alpha = ease(clamp01((f - 0.15) / 0.7));
    } else if (k === "wipe") {
      shot.base = still(h);
      shot.top = still(h + 1);
      shot.wipe = ease(clamp01((f - 0.1) / 0.8));
    } else {
      const t = ease(clamp01((f - 0.15) / 0.7));
      const veil = HOP_LIST[h].veil;
      shot.base = depart(h);
      shot.top = arrive(h + 1);
      shot.alpha = t;
      if (!reduced && veil) {
        shot.veil = VEILS[veil];
        shot.veilAlpha = Math.sin(Math.PI * t) * 0.92;
      }
    }
  }

  // Drop a layer that adds nothing, so a hidden one can stop drawing.
  if (shot.top === shot.base) shot.top = null;
  if (shot.top) {
    const v = shot.wipe ?? shot.alpha;
    if (v <= 0.001) shot.top = null;
    else if (v >= 0.999) {
      shot.base = shot.top;
      shot.top = null;
    }
  }
  if (!shot.top) shot.wipe = null;
  return shot;
}

type StyleProp = "opacity" | "visibility" | "zIndex" | "clipPath" | "transform" | "background" | "left";

export default function FilmScroll() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLSpanElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const tourBtnRef = useRef<HTMLButtonElement>(null);
  const layers = useRef(new Map<string, HTMLElement>());
  const refFns = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const clipsRef = useRef<Clip[]>([]);
  const reducedRef = useRef(false);
  const tourRef = useRef<number | null>(null);
  const [stop, setStop] = useState(0);
  const [orbitOn, setOrbitOn] = useState(true);
  const [touring, setTouring] = useState(false);

  // Stable ref callbacks, so React attaches each layer once.
  const layer = (key: string) => {
    let fn = refFns.current.get(key);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        if (el) layers.current.set(key, el);
        else layers.current.delete(key);
      };
      refFns.current.set(key, fn);
    }
    return fn;
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const media = mediaRef.current;
    if (!wrap || !media) return;

    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = reduceQuery.matches;
    reducedRef.current = reduced;
    const onReduce = () => {
      reduced = reduceQuery.matches;
      reducedRef.current = reduced;
      kick();
    };
    reduceQuery.addEventListener("change", onReduce);

    const clips: Clip[] = CLIP_HOPS.map((h) => ({
      hop: h,
      name: HOP_LIST[h].clip as string,
      state: "idle",
      url: null,
      abort: null,
      shown: 0,
      dur: 0,
    }));
    clipsRef.current = clips;
    const clipOf: (Clip | undefined)[] = [];
    clips.forEach((c) => (clipOf[c.hop] = c));
    const videoOf = (c: Clip) => layers.current.get(`video-${c.hop}`) as HTMLVideoElement | undefined;
    const ready = (h: number) => clipOf[h]?.state === "ready";

    let x = 0;
    const targetOf = (c: Clip) => Math.min(Math.max(0, c.dur - HALF_FRAME), hopProgress(c.hop, x) * c.dur);

    // iOS only shows seeks on a video that has played once from a user gesture.
    let primed = false;
    const prime = (el: HTMLVideoElement) => {
      el.play()
        .then(() => el.pause())
        .catch(() => {});
    };
    const onGesture = () => {
      if (primed) return;
      primed = true;
      clips.forEach((c) => {
        const el = videoOf(c);
        if (el && c.state === "ready") prime(el);
      });
    };
    window.addEventListener("touchstart", onGesture, { passive: true });
    window.addEventListener("pointerdown", onGesture);

    const waitFor = (el: HTMLVideoElement, type: "loadeddata" | "seeked", signal: AbortSignal, ms: number) =>
      new Promise<void>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer);
          el.removeEventListener(type, ok);
          el.removeEventListener("error", bad);
          signal.removeEventListener("abort", stop);
        };
        const ok = () => {
          done();
          resolve();
        };
        const bad = () => {
          done();
          reject(new Error(`video error ${el.error?.code ?? "?"}`));
        };
        const stop = () => {
          done();
          reject(new DOMException("released", "AbortError"));
        };
        const timer = setTimeout(type === "seeked" ? ok : bad, ms);
        el.addEventListener(type, ok);
        el.addEventListener("error", bad);
        signal.addEventListener("abort", stop);
      });

    const load = async (c: Clip) => {
      const el = videoOf(c);
      if (!el) return;
      const ac = new AbortController();
      c.abort = ac;
      c.state = "loading";
      const part = window.matchMedia(PHONE).matches ? "m.mp4" : "d.mp4";
      try {
        const res = await fetch(clipFile(c.name, part), { signal: ac.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (ac.signal.aborted) return;
        c.url = URL.createObjectURL(blob);
        const loaded = waitFor(el, "loadeddata", ac.signal, 15000);
        el.muted = true;
        el.setAttribute("muted", "");
        el.src = c.url;
        await loaded;
        c.dur = Number.isFinite(el.duration) ? el.duration : 0;
        if (!c.dur) throw new Error("no duration");
        c.shown = targetOf(c);
        const seeked = waitFor(el, "seeked", ac.signal, 1500);
        el.currentTime = c.shown;
        await seeked;
        c.abort = null;
        c.state = "ready";
        if (primed) prime(el);
        kick();
      } catch (err) {
        if (ac.signal.aborted) return;
        c.abort = null;
        c.state = "failed";
        console.warn(`Film clip "${c.name}" did not load, so its hop keeps the stills.`, err);
      }
    };

    const release = (c: Clip) => {
      c.abort?.abort();
      c.abort = null;
      const el = videoOf(c);
      if (el?.getAttribute("src")) {
        el.removeAttribute("src");
        el.load();
      }
      if (c.url) URL.revokeObjectURL(c.url);
      c.url = null;
      if (c.state !== "failed") c.state = "idle";
    };

    // Style writes go through a cache, so a still frame costs no style work.
    const written = new WeakMap<HTMLElement, Partial<Record<StyleProp, string>>>();
    const put = (el: HTMLElement | null, prop: StyleProp, value: string) => {
      if (!el) return;
      let rec = written.get(el);
      if (!rec) written.set(el, (rec = {}));
      if (rec[prop] === value) return;
      rec[prop] = value;
      (el.style as unknown as Record<StyleProp, string>)[prop] = value;
    };

    const painted = new Set<string>();
    const paintStill = (key: string) => {
      if (painted.has(key)) return;
      const s = STILLS.find((t) => t.key === key);
      const el = layers.current.get(key);
      if (!s || !el) return;
      el.style.backgroundImage = s.bg;
      painted.add(key);
    };

    let lastStop = -1;
    let lastOrbit = true;
    const apply = (s: Shot, now: number) => {
      if (s.base !== "orbit") paintStill(s.base);
      if (s.top) paintStill(s.top);
      for (const [key, el] of layers.current) {
        let o = 0;
        let z = "0";
        let clip = "none";
        if (key === s.base) {
          o = 1;
          z = "1";
        } else if (key === s.top) {
          z = "2";
          if (s.wipe !== null) {
            o = 1;
            clip = `inset(0 ${((1 - s.wipe) * 100).toFixed(2)}% 0 0)`;
          } else o = s.alpha;
        }
        put(el, "opacity", o.toFixed(3));
        put(el, "zIndex", z);
        put(el, "clipPath", clip);
        // Videos keep drawing while hidden, so a seek made off screen is ready when shown.
        if (el.tagName !== "VIDEO") put(el, "visibility", o > 0 ? "visible" : "hidden");
      }

      const orbitShown = s.base === "orbit" || s.top === "orbit";
      put(orbitRef.current, "visibility", orbitShown ? "visible" : "hidden");
      if (orbitShown !== lastOrbit) {
        lastOrbit = orbitShown;
        setOrbitOn(orbitShown);
      }

      const breath = s.rest * DRIFT * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / DRIFT_MS));
      put(media, "transform", `scale(${(s.scale + breath).toFixed(4)})`);

      put(veilRef.current, "background", s.veil ?? "transparent");
      put(veilRef.current, "opacity", s.veil ? s.veilAlpha.toFixed(3) : "0");
      const scanOn = s.wipe !== null;
      put(scanRef.current, "opacity", scanOn ? "1" : "0");
      if (scanOn) put(scanRef.current, "left", `${((s.wipe ?? 0) * 100).toFixed(2)}%`);
      put(railRef.current, "transform", `scaleY(${(x / TOTAL).toFixed(4)})`);

      const c = s.caption;
      put(captionRef.current, "opacity", c.toFixed(3));
      put(captionRef.current, "transform", `translateY(${((1 - c) * 12).toFixed(1)}px)`);
      put(captionRef.current, "visibility", c > 0.01 ? "visible" : "hidden");
      if (s.stop !== lastStop) {
        lastStop = s.stop;
        setStop(s.stop);
      }
    };

    let raf = 0;
    let inView = true;
    let prev = performance.now();
    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.1, Math.max(0, now - prev) / 1000);
      prev = now;
      const rect = wrap.getBoundingClientRect();
      const span = Math.max(1, rect.height - window.innerHeight);
      x = clamp01(-rect.top / span) * TOTAL;

      const k = 1 - Math.pow(1 - EASE, dt * 60);
      for (const c of clips) {
        const seg = HOP_SEG[c.hop];
        const d = distance(x, seg.start, seg.start + seg.len);
        if (!reduced && c.state === "idle" && d <= LOAD_NEAR) void load(c);
        else if ((reduced || d > RELEASE_FAR) && (c.state === "loading" || c.state === "ready")) release(c);
        if (c.state !== "ready") continue;
        const el = videoOf(c);
        if (!el) continue;
        const target = targetOf(c);
        c.shown += (target - c.shown) * k;
        if (Math.abs(target - c.shown) < SEEK_EPS / 2) c.shown = target;
        if (!el.seeking && Math.abs(el.currentTime - c.shown) > SEEK_EPS) el.currentTime = c.shown;
      }

      for (const s of STILLS) {
        if (!painted.has(s.key) && (!s.clip || !reduced) && distance(x, s.from, s.to) <= STILL_NEAR) paintStill(s.key);
      }

      apply(compose(x, ready, reduced), now);
      if (inView && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (raf || !inView || document.hidden) return;
      prev = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      kick();
    });
    io.observe(wrap);
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("scroll", kick, { passive: true });
    kick();

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __film?: unknown }).__film = {
        get x() {
          return x;
        },
        total: TOTAL,
        segs: SEGS,
        rest: REST,
        clips,
      };
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      reduceQuery.removeEventListener("change", onReduce);
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("scroll", kick);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("pointerdown", onGesture);
      clips.forEach(release);
      if (process.env.NODE_ENV !== "production") delete (window as unknown as { __film?: unknown }).__film;
    };
  }, []);

  const stopTour = () => {
    if (tourRef.current) cancelAnimationFrame(tourRef.current);
    tourRef.current = null;
    setTouring(false);
  };

  const goTo = (i: number) => {
    stopTour();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    const span = wrap.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + (REST[i] / TOTAL) * span, behavior: reducedRef.current ? "auto" : "smooth" });
  };

  // How long the tour spends on a part: clips at their own length, so they play at speed.
  const tourSeconds = (seg: Seg) => {
    if (seg.hop === null) return TOUR.hold;
    const kind = kindOf(HOP_LIST[seg.hop]);
    if (kind !== "video") return TOUR[kind];
    if (reducedRef.current) return TOUR.fade;
    const clip = clipsRef.current.find((c) => c.hop === seg.hop);
    return clip && clip.dur > 0 ? clip.dur : TOUR.video;
  };

  // The tour scrolls the page itself until someone scrolls, touches or presses a key.
  const startTour = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    stopTour();
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    const span = () => Math.max(1, wrap.offsetHeight - window.innerHeight);
    let x = clamp01((window.scrollY - top) / span()) * TOTAL;
    if (x >= TOTAL - 1) x = 0;
    let i = SEGS.indexOf(locate(x));
    let frac = clamp01((x - SEGS[i].start) / SEGS[i].len);
    let prev = performance.now();
    setTouring(true);
    const step = (now: number) => {
      let dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      while (dt > 0) {
        const secs = tourSeconds(SEGS[i]);
        const left = (1 - frac) * secs;
        if (dt < left) {
          frac += dt / secs;
          dt = 0;
        } else if (i === SEGS.length - 1) {
          frac = 1;
          dt = 0;
        } else {
          dt -= left;
          i += 1;
          frac = 0;
        }
      }
      const at = SEGS[i].start + frac * SEGS[i].len;
      window.scrollTo({ top: top + (at / TOTAL) * span(), behavior: "instant" });
      if (i === SEGS.length - 1 && frac >= 1) return stopTour();
      tourRef.current = requestAnimationFrame(step);
    };
    tourRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    if (!touring) return;
    const cancel = (e: Event) => {
      // The tour button handles its own presses.
      if (e.target instanceof Node && tourBtnRef.current?.contains(e.target)) return;
      stopTour();
    };
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("keydown", cancel);
    };
  }, [touring]);

  useEffect(
    () => () => {
      if (tourRef.current) cancelAnimationFrame(tourRef.current);
    },
    [],
  );

  const here = STOPS[stop];

  return (
    <div className={styles.film} data-film ref={wrapRef} style={{ height: `${TOTAL + 100}vh` }}>
      <div className={styles.screen}>
        {/* The first stop is live: a real-time Earth with the CubeSat, which can be clicked. */}
        <div ref={orbitRef} className={styles.orbit}>
          <OrbitIntro active={orbitOn} poster={STOPS[0].still} />
        </div>

        <div ref={mediaRef} className={styles.media} aria-hidden="true">
          {STOPS.map((s, i) => (i === 0 ? null : <div key={s.still} ref={layer(`stop-${i}`)} className={styles.layer} />))}
          {CLIP_HOPS.map((h) => (
            <Fragment key={h}>
              {h > 0 ? <div ref={layer(`first-${h}`)} className={styles.layer} /> : null}
              <div ref={layer(`last-${h}`)} className={styles.layer} />
              <video
                ref={layer(`video-${h}`)}
                className={styles.video}
                muted
                playsInline
                preload="auto"
                disablePictureInPicture
                disableRemotePlayback
                tabIndex={-1}
              />
            </Fragment>
          ))}
          <div ref={scanRef} className={styles.scan} />
        </div>

        <div ref={veilRef} className={styles.veil} aria-hidden="true" />
        <div className={styles.shade} aria-hidden="true" />

        <div ref={captionRef} className={styles.caption}>
          <p className={styles.place}>{here.place}</p>
          <p className={styles.text}>{here.text}</p>
          {here.link ? (
            <Link className={styles.open} href={here.link.href}>
              {here.link.label}
            </Link>
          ) : null}
        </div>

        <nav className={styles.stops} aria-label="Stops in the film">
          <span className={styles.rail} aria-hidden="true">
            <span ref={railRef} />
          </span>
          <ol>
            {STOPS.map((s, i) => (
              <li key={s.still}>
                <button type="button" onClick={() => goTo(i)} aria-current={i === stop ? "true" : undefined}>
                  {s.place}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <button
          ref={tourBtnRef}
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
