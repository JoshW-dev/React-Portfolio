"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import OrbitIntro from "@/components/orbit/OrbitIntro";
import { HOPS, SCROLL, STOPS, VEILS, clipFile, type ClipPart, type Hop } from "@/lib/film";
import styles from "./FilmScroll.module.css";

/*
  The film. Scrolling rests on a stop (a hold), then flies to the next one (a hop). Stop and
  hop data live in lib/film.ts.

  The scroll sets where the film should be (x). A playhead (p) follows it, and everything on
  screen is drawn from p. The playhead moves at most a few times a clip's own speed, so one
  fast swipe still plays every flight it crosses from start to end. It waits at
  the edge of a clip hop until that clip can show frames, with a hairline at the bottom that
  tracks the download. A hop without a clip, or whose clip failed, cross-fades stills.

  Every clip is fetched whole into a Blob from mount, one file at a time, in the order the
  playhead will need them. iOS freezes on seeks into unloaded ranges, and fetching one file
  at a time gives the next clip all the bandwidth. Only the clip at the playhead and its
  neighbours are attached to their video elements. The first fetch measures the connection
  and sets the quality tier for the rest of the visit.

  The first stop is the first frame of the first clip, with the live CubeSat drawn over it.
  A pass stop is flown through: its short hold blends the clip before it into the clip after
  it, with no caption, so the two clips play as one flight.
*/

type Kind = "video" | "wipe" | "fade";

const LAST = STOPS.length - 1;

/** One hop per pair of stops, whatever order or gaps HOPS has. */
const HOP_LIST: Hop[] = STOPS.slice(1).map(
  (_, i) => HOPS.find((h) => h.from === i && h.to === i + 1) ?? { from: i, to: i + 1, kind: "fade" },
);

const kindOf = (h: Hop): Kind => (h.kind === "video" ? (h.clip ? "video" : "fade") : h.kind);

const isPass = (k: number) => STOPS[k]?.pass === true;

/** The stop whose caption belongs to stop k: a pass stop lends the slot to the stop after it. */
const captionStop = (k: number) => {
  let i = k;
  while (i < LAST && isPass(i)) i++;
  return i;
};

/** A hold (resting on a stop) or a hop (flying to the next stop), in viewport heights. */
type Seg = { start: number; len: number; stop: number; hop: number | null };

const { SEGS, HOLD_SEG, HOP_SEG, TOTAL } = (() => {
  const segs: Seg[] = [];
  const holds: Seg[] = [];
  const hops: Seg[] = [];
  let at = 0;
  for (let i = 0; i <= LAST; i++) {
    const len = i === 0 ? SCROLL.firstHold : STOPS[i].pass ? SCROLL.pass : SCROLL.hold;
    const hold: Seg = { start: at, len, stop: i, hop: null };
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

const CLIP_HOPS = HOP_LIST.flatMap((h, i) => (kindOf(h) === "video" ? [i] : []));

/** Still layers, with the stretch of film they belong to, so each loads only when it is near. */
type Still = { key: string; bg: string; from: number; to: number; clip: boolean };
const STILLS: Still[] = [
  ...STOPS.map((s, i): Still => {
    const after = HOP_SEG[i] ?? HOLD_SEG[i];
    return { key: `stop-${i}`, bg: `url(${s.still})`, from: i === 0 ? 0 : HOP_SEG[i - 1].start, to: after.start + after.len, clip: false };
  }),
  ...CLIP_HOPS.flatMap((h): Still[] => {
    const name = HOP_LIST[h].clip as string;
    const from = h === 0 ? 0 : HOP_SEG[h].start;
    const to = HOP_SEG[h].start + HOP_SEG[h].len;
    // The stop's own still sits under each clip still, so a missing file never leaves a hole.
    return [
      { key: `first-${h}`, bg: `url(${clipFile(name, "first.webp")}), url(${STOPS[h].still})`, from, to, clip: true },
      { key: `last-${h}`, bg: `url(${clipFile(name, "last.webp")}), url(${STOPS[h + 1].still})`, from, to, clip: true },
    ];
  }),
];

/** The layer on screen before any script runs: the first clip's first frame. */
const OPENING_KEY = CLIP_HOPS[0] === 0 ? "first-0" : "stop-0";
const OPENING_STYLE: CSSProperties = {
  backgroundImage: STILLS.find((s) => s.key === OPENING_KEY)?.bg,
  opacity: 1,
  visibility: "visible",
  zIndex: 1,
};

const PUSH = 0.035; // push-in across a hold
const DRIFT = 0.012; // a slow breath while resting, so a held frame is never frozen
const DRIFT_MS = 16000;
const CAPTION_FADE = 22; // vh of film the caption takes to fade at each end of a hop
const SAT_FADE = 0.08; // share of hop 0 over which the CubeSat fades out
const STILL_NEAR = 1.5 * (SCROLL.video + SCROLL.hold);

// The playhead.
const FOLLOW = 6; // per second: speed is the gap to the scroll times this, before the caps below
const HOLD_SPEED = 260; // vh/s across a hold
const PASS_SPEED = 80; // vh/s across a pass stop's hold, so its blend takes at least a quarter second
const WIPE_SECS = 0.9;
const FADE_SECS = 1.2;
const RATE = 2.5; // a clip plays at up to this multiple of its own speed
const RATE_STEP = 1.5; // plus this for each further clip hop the scroll is ahead
const RATE_MAX = 7;
const SNAP = 0.01; // vh: closer than this, the playhead lands on the scroll
const LOADER_DELAY = 250; // ms of waiting before the hairline shows

const SEEK_EPS = 0.005;
const HALF_FRAME = 0.5 / 24;
const PHONE = "(max-width: 800px)";

// The quality tier, measured on the first fetch.
const SLOW_TYPES = ["slow-2g", "2g", "3g"];
const PROBE_MS = 2000; // time after the first byte when the first fetch is measured
const PROBE_MAX_SECS = 8; // a projected download longer than this drops to the low tier
const PROBE_GUESS = 10e6; // bytes assumed for a file sent without content-length

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t: number) => t * t * (3 - 2 * t);
const distance = (x: number, from: number, to: number) => (x < from ? from - x : x > to ? x - to : 0);
const locate = (x: number) => SEGS.find((s) => x < s.start + s.len) ?? SEGS[SEGS.length - 1];
const hopProgress = (h: number, x: number) => clamp01((x - HOP_SEG[h].start) / HOP_SEG[h].len);

/** The part of the film the playhead is in or about to enter, moving in direction d. */
const segToward = (at: number, d: number) =>
  d > 0
    ? (SEGS.find((s) => at < s.start + s.len) ?? SEGS[SEGS.length - 1])
    : (SEGS.find((s) => at > s.start && at <= s.start + s.len) ?? SEGS[0]);

type Tier = "high" | "low";
type NetInfo = { saveData?: boolean; effectiveType?: string };

type Clip = {
  hop: number;
  name: string;
  /**
   * idle: not fetched yet. loading: fetching. fetched: the Blob is held, no video attached.
   * attaching: the video is loading the Blob. ready: attached and seeked, frames can show.
   */
  state: "idle" | "loading" | "fetched" | "attaching" | "ready" | "failed";
  /** The file fetched or being fetched. */
  file: string;
  received: number;
  /** From content-length; 0 when unknown. */
  total: number;
  url: string | null;
  dur: number;
  fetchAbort: AbortController | null;
  attachAbort: AbortController | null;
};

/** What the screen shows at one playhead position. Layer keys: stop-i, first-h, last-h, video-h. */
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
  /** Opacity of the CubeSat layer. */
  sat: number;
};

function compose(p: number, ready: (h: number) => boolean, reduced: boolean): Shot {
  const kind = (h: number): Kind => {
    const k = kindOf(HOP_LIST[h]);
    return reduced ? "fade" : k;
  };
  const still = (i: number) => `stop-${i}`;
  const isClip = (h: number) => h >= 0 && h < LAST && kind(h) === "video";
  const startOf = (h: number) => (ready(h) ? `video-${h}` : `first-${h}`);
  const endOf = (h: number) => (ready(h) ? `video-${h}` : `last-${h}`);
  // A hold shows the incoming clip's last frame and the outgoing clip's first frame, so
  // nothing pops; the wipe works on the stops' own stills.
  const arrive = (k: number) =>
    k > 0 && kind(k - 1) === "wipe" ? still(k) : isClip(k - 1) ? endOf(k - 1) : isClip(k) ? startOf(k) : still(k);
  const depart = (k: number) =>
    k < LAST && kind(k) === "wipe" ? still(k) : isClip(k) ? startOf(k) : isClip(k - 1) ? endOf(k - 1) : still(k);
  const push = (k: number) => (reduced || k === 0 || isPass(k) ? 0 : PUSH);

  const seg = locate(p);
  const sat = p <= HOP_SEG[0].start ? 1 : 1 - ease(clamp01(hopProgress(0, p) / SAT_FADE));
  const shot: Shot = { base: still(0), top: null, alpha: 0, wipe: null, veil: null, veilAlpha: 0, scale: 1, rest: 0, caption: 1, stop: captionStop(seg.stop), sat };

  if (seg.hop === null) {
    const k = seg.stop;
    const u = clamp01((p - seg.start) / seg.len);
    shot.base = arrive(k);
    shot.top = depart(k);
    if (isPass(k)) {
      // Flown through: the whole hold is the blend, with no words, push or breath.
      shot.alpha = ease(u);
      shot.caption = 0;
    } else {
      shot.alpha = ease(clamp01((u - 0.25) / 0.5));
      shot.scale = 1 + push(k) * u;
      // The breath eases in and out at the ends of a hold, except where the film starts and ends.
      const into = k === 0 ? 1 : u / 0.25;
      const out = k === LAST ? 1 : (1 - u) / 0.25;
      shot.rest = reduced ? 0 : ease(clamp01(Math.min(into, out)));
    }
  } else {
    const h = seg.hop;
    const f = clamp01((p - seg.start) / seg.len);
    const near = f < 0.5 ? h : h + 1;
    shot.scale = 1 + push(h) * (1 - f);
    shot.stop = captionStop(near);
    // The words leave as the flight starts and come back as it lands, never mid-flight. A
    // pass stop has none, so they stay away across it.
    shot.caption = isPass(near) ? 0 : 1 - clamp01((f < 0.5 ? p - seg.start : seg.start + seg.len - p) / CAPTION_FADE);
    const k = kind(h);
    if (k === "video" && ready(h)) {
      shot.base = `video-${h}`;
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

type StyleProp = "opacity" | "visibility" | "zIndex" | "clipPath" | "transform" | "background" | "left" | "pointerEvents";

export default function FilmScroll() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<HTMLDivElement>(null);
  const loadFillRef = useRef<HTMLSpanElement>(null);
  const layers = useRef(new Map<string, HTMLElement>());
  const refFns = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const [stop, setStop] = useState(0);
  const [orbitOn, setOrbitOn] = useState(true);

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
    let disposed = false;

    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = reduceQuery.matches;
    const conn = (navigator as Navigator & { connection?: NetInfo }).connection;
    const saveData = conn?.saveData === true;
    // Reduced motion and data saver fetch no clips and cross-fade stills.
    const videoOff = () => reduced || saveData;

    // Desktop plays 1920 or 1280 wide, phones 1280 or 854. A slow link starts low; otherwise
    // the first fetch starts high and drops to low if it would take too long.
    const parts: Record<Tier, ClipPart> = window.matchMedia(PHONE).matches
      ? { high: "d.mp4", low: "m.mp4" }
      : { high: "hd.mp4", low: "d.mp4" };
    // The browser's own downlink figure reads low on many good connections, so only its
    // coarse type is trusted here. The measured first fetch decides the rest.
    const slowLink = !!conn && SLOW_TYPES.includes(conn.effectiveType ?? "");
    let tier: Tier = slowLink ? "low" : "high";
    let tierFixed = slowLink;

    const clips: Clip[] = CLIP_HOPS.map((h) => ({
      hop: h,
      name: HOP_LIST[h].clip as string,
      state: "idle",
      file: "",
      received: 0,
      total: 0,
      url: null,
      dur: 0,
      fetchAbort: null,
      attachAbort: null,
    }));
    const clipOf: (Clip | undefined)[] = [];
    clips.forEach((c) => (clipOf[c.hop] = c));
    const videoOf = (c: Clip) => layers.current.get(`video-${c.hop}`) as HTMLVideoElement | undefined;
    const ready = (h: number) => clipOf[h]?.state === "ready";
    /** A clip hop that will play its clip once it is ready. */
    const playable = (h: number) => !videoOff() && kindOf(HOP_LIST[h]) === "video" && clipOf[h]?.state !== "failed";
    const gated = (h: number) => playable(h) && !ready(h);

    let x = 0; // where the scroll puts the film, in vh
    let p = 0; // the playhead
    let dir = 1; // the way the playhead last moved
    let started = false;
    let waitHop: number | null = null; // the clip hop the playhead is waiting at
    let waitSince = 0;
    let lastShot: Shot | null = null;

    const targetOf = (c: Clip) => Math.min(Math.max(0, c.dur - HALF_FRAME), hopProgress(c.hop, p) * c.dur);

    // ---- Playhead ------------------------------------------------------------------------

    /** Top speed in a part of the film, in vh/s. */
    const speedIn = (seg: Seg, d: number) => {
      if (seg.hop === null) return isPass(seg.stop) ? PASS_SPEED : HOLD_SPEED;
      const h = seg.hop;
      const k = kindOf(HOP_LIST[h]);
      if (k === "wipe") return seg.len / WIPE_SECS;
      const c = clipOf[h];
      if (k !== "video" || !c || !playable(h) || !c.dur) return seg.len / FADE_SECS;
      // Faster when the scroll is further ahead, so a long jump does not take minutes. Clips
      // joined by pass stops are one flight, so they do not count as further.
      let further = 0;
      for (const g of CLIP_HOPS) {
        if (!playable(g)) continue;
        const s = HOP_SEG[g];
        if (!(d > 0 ? g > h && s.start < x : g < h && s.start + s.len > x)) continue;
        let joined = true;
        for (let k = Math.min(g, h) + 1; k <= Math.max(g, h); k++) if (!isPass(k)) joined = false;
        if (!joined) further++;
      }
      return (seg.len / c.dur) * Math.min(RATE_MAX, RATE + RATE_STEP * further);
    };

    /** The first clip hop between the playhead and the scroll that is not ready to play. */
    const gateAhead = () => {
      let gate: { edge: number; hop: number } | null = null;
      for (const h of CLIP_HOPS) {
        if (!gated(h)) continue;
        const s = HOP_SEG[h];
        const end = s.start + s.len;
        if (x > p && p <= s.start && x > s.start) {
          if (!gate || s.start < gate.edge) gate = { edge: s.start, hop: h };
        } else if (x < p && p >= end && x < end) {
          if (!gate || end > gate.edge) gate = { edge: end, hop: h };
        }
      }
      return gate;
    };

    // Moves the playhead toward the scroll for dt seconds, one part of the film at a time,
    // since each part has its own top speed.
    const advance = (dt: number) => {
      const gate = gateAhead();
      let left = dt;
      for (let i = 0; i < 32 && left > 0 && p !== x; i++) {
        if (gate && p === gate.edge) break;
        const gap = x - p;
        if (Math.abs(gap) < SNAP) {
          p = gate ? gate.edge : x;
          break;
        }
        const d = gap > 0 ? 1 : -1;
        const seg = segToward(p, d);
        const room = d > 0 ? seg.start + seg.len - p : p - seg.start;
        const top = speedIn(seg, d);
        const step = Math.min(Math.abs(gap) * (1 - Math.exp(-FOLLOW * left)), top * left);
        if (step < room) {
          p += d * step;
          break;
        }
        left -= room / Math.max(1e-6, Math.min(Math.abs(gap) * FOLLOW, top));
        p = d > 0 ? seg.start + seg.len : seg.start;
      }
      waitHop = gate && p === gate.edge ? gate.hop : null;
    };

    // ---- Attaching ------------------------------------------------------------------------

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

    const attach = async (c: Clip) => {
      const el = videoOf(c);
      if (!el || !c.url) return;
      const ac = new AbortController();
      c.attachAbort = ac;
      c.state = "attaching";
      try {
        const loaded = waitFor(el, "loadeddata", ac.signal, 15000);
        el.muted = true;
        el.setAttribute("muted", "");
        el.src = c.url;
        await loaded;
        c.dur = Number.isFinite(el.duration) ? el.duration : 0;
        if (!c.dur) throw new Error("no duration");
        const seeked = waitFor(el, "seeked", ac.signal, 1500);
        el.currentTime = targetOf(c);
        await seeked;
        c.attachAbort = null;
        c.state = "ready";
        if (primed) prime(el);
        kick();
      } catch (err) {
        if (ac.signal.aborted) return;
        c.attachAbort = null;
        c.state = "failed";
        el.removeAttribute("src");
        el.load();
        console.warn(`Film clip "${c.name}" did not play, so its hop keeps the stills.`, err);
      }
    };

    // The Blob stays; only the video lets go of it.
    const detach = (c: Clip) => {
      c.attachAbort?.abort();
      c.attachAbort = null;
      const el = videoOf(c);
      if (el?.getAttribute("src")) {
        el.removeAttribute("src");
        el.load();
      }
      c.state = "fetched";
    };

    /** The clip hops to keep attached: the one at the playhead and one each side of it. */
    const wanted = () => {
      const out = new Set<number>();
      if (videoOff()) return out;
      const n = CLIP_HOPS.length;
      let inside = -1;
      let ahead = n;
      for (let i = 0; i < n; i++) {
        const s = HOP_SEG[CLIP_HOPS[i]];
        if (p > s.start && p < s.start + s.len) {
          inside = i;
          break;
        }
        if (s.start >= p) {
          ahead = i;
          break;
        }
      }
      const idx =
        inside >= 0 ? [inside - 1, inside, inside + 1] : dir > 0 ? [ahead - 1, ahead, ahead + 1] : [ahead, ahead - 1, ahead - 2];
      for (const i of idx) if (i >= 0 && i < n) out.add(CLIP_HOPS[i]);
      return out;
    };

    const manage = () => {
      const want = wanted();
      for (const c of clips) {
        const on = want.has(c.hop);
        if (on && c.state === "fetched") void attach(c);
        else if (!on && (c.state === "attaching" || c.state === "ready")) detach(c);
      }
    };

    // ---- Fetching -------------------------------------------------------------------------

    let fetching: Clip | null = null;

    /** Next clip to fetch: the one at the playhead, then those ahead of it, then behind. */
    const pickNext = () => {
      let best: Clip | null = null;
      let bestScore = Infinity;
      for (const c of clips) {
        if (c.state !== "idle") continue;
        const s = HOP_SEG[c.hop];
        const end = s.start + s.len;
        let score: number;
        if (c.hop === waitHop || (p >= s.start && p <= end)) score = -1;
        else {
          const gapAhead = dir > 0 ? s.start - p : p - end;
          score = gapAhead >= 0 ? gapAhead : 1e6 - gapAhead;
        }
        if (score < bestScore) {
          best = c;
          bestScore = score;
        }
      }
      return best;
    };

    const pump = () => {
      if (fetching || disposed || videoOff()) return;
      const next = pickNext();
      if (next) void fetchClip(next);
    };

    const fetchClip = async (c: Clip) => {
      fetching = c;
      let t: Tier = tier;
      try {
        for (;;) {
          const ac = new AbortController();
          c.fetchAbort = ac;
          c.state = "loading";
          c.file = clipFile(c.name, parts[t]);
          c.received = 0;
          c.total = 0;
          const probe = t === "high" && !tierFixed;
          const res = await fetch(c.file, { signal: ac.signal });
          if (!res.ok) {
            // A missing high-tier file falls back to the low tier for this clip only.
            if (t === "high") {
              void res.body?.cancel().catch(() => {});
              t = "low";
              continue;
            }
            throw new Error(`HTTP ${res.status}`);
          }
          c.total = Number(res.headers.get("content-length")) || 0;
          const chunks: BlobPart[] = [];
          let tooSlow = false;
          const reader = res.body?.getReader();
          if (!reader) chunks.push(await res.blob());
          else {
            let first = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              c.received += value.byteLength;
              const now = performance.now();
              if (!first) first = now;
              else if (probe && !tierFixed && now - first >= PROBE_MS) {
                // Project the whole download from the rate so far.
                tierFixed = true;
                const secs = ((c.total || PROBE_GUESS) * (now - first)) / 1000 / c.received;
                if (secs > PROBE_MAX_SECS) {
                  tooSlow = true;
                  break;
                }
              }
              if (waitHop === c.hop) kick();
            }
          }
          if (tooSlow) {
            tier = "low";
            t = "low";
            void reader?.cancel().catch(() => {});
            ac.abort();
            continue;
          }
          // A first fetch that finished inside the probe window keeps the high tier.
          if (probe) tierFixed = true;
          c.fetchAbort = null;
          c.url = URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
          c.state = "fetched";
          break;
        }
      } catch (err) {
        const aborted = c.fetchAbort?.signal.aborted ?? false;
        c.fetchAbort = null;
        c.received = 0;
        if (aborted) c.state = "idle";
        else {
          c.state = "failed";
          if (!disposed) console.warn(`Film clip "${c.name}" did not load, so its hop keeps the stills.`, err);
        }
      } finally {
        fetching = null;
      }
      if (disposed) return;
      manage();
      pump();
      kick();
    };

    // ---- Drawing --------------------------------------------------------------------------

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

    const painted = new Set<string>([OPENING_KEY]);
    const paintStill = (key: string) => {
      if (painted.has(key) || key.startsWith("video-")) return;
      const s = STILLS.find((t) => t.key === key);
      const el = layers.current.get(key);
      if (!s || !el) return;
      el.style.backgroundImage = s.bg;
      painted.add(key);
    };

    let lastStop = -1;
    let lastSat = true;
    const apply = (s: Shot, now: number) => {
      paintStill(s.base);
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

      const sat = s.sat > 0.001;
      put(orbitRef.current, "opacity", s.sat.toFixed(3));
      put(orbitRef.current, "visibility", sat ? "visible" : "hidden");
      put(orbitRef.current, "pointerEvents", sat ? "auto" : "none");
      if (sat !== lastSat) {
        lastSat = sat;
        setOrbitOn(sat);
      }

      const breath = s.rest * DRIFT * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / DRIFT_MS));
      put(media, "transform", `scale(${(s.scale + breath).toFixed(4)})`);

      put(veilRef.current, "background", s.veil ?? "transparent");
      put(veilRef.current, "opacity", s.veil ? s.veilAlpha.toFixed(3) : "0");
      const scanOn = s.wipe !== null;
      put(scanRef.current, "opacity", scanOn ? "1" : "0");
      if (scanOn) put(scanRef.current, "left", `${((s.wipe ?? 0) * 100).toFixed(2)}%`);

      const c = s.caption;
      put(captionRef.current, "opacity", c.toFixed(3));
      put(captionRef.current, "transform", `translateY(${((1 - c) * 12).toFixed(1)}px)`);
      put(captionRef.current, "visibility", c > 0.01 ? "visible" : "hidden");
      if (s.stop !== lastStop) {
        lastStop = s.stop;
        setStop(s.stop);
      }

      // The hairline: bytes of the clip the playhead is waiting for.
      const wait = waitHop === null ? undefined : clipOf[waitHop];
      put(loadRef.current, "opacity", wait && now - waitSince > LOADER_DELAY ? "1" : "0");
      if (wait) {
        const got =
          wait.state !== "idle" && wait.state !== "loading"
            ? 1
            : wait.total > 0
              ? wait.received / wait.total
              : wait.received / (wait.received + PROBE_GUESS);
        put(loadFillRef.current, "transform", `scaleX(${clamp01(got).toFixed(3)})`);
      }
    };

    // ---- Loop -----------------------------------------------------------------------------

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

      const waited = waitHop;
      // Nobody sees the playhead catch up on the first frame, with reduced motion, or off screen.
      if (!started || reduced || !inView) {
        p = x;
        waitHop = null;
        started = true;
      } else advance(dt);
      if (x !== p) dir = x > p ? 1 : -1;
      if (waitHop !== null && waitHop !== waited) waitSince = now;

      manage();
      pump();

      let busy = p !== x || waitHop !== null;
      for (const c of clips) {
        if (c.state !== "ready") continue;
        const el = videoOf(c);
        if (!el) continue;
        const target = targetOf(c);
        if (!el.seeking && Math.abs(el.currentTime - target) > SEEK_EPS) el.currentTime = target;
        if (el.seeking) busy = true;
      }

      for (const s of STILLS) {
        if (!painted.has(s.key) && (!s.clip || !reduced) && distance(p, s.from, s.to) <= STILL_NEAR) paintStill(s.key);
      }

      const shot = compose(p, ready, reduced);
      lastShot = shot;
      apply(shot, now);
      // The breath animates for as long as a hold is in view.
      if (shot.rest > 0) busy = true;
      if (busy && inView && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const kick = (force = false) => {
      if (raf || disposed || document.hidden || (!inView && !force)) return;
      prev = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const onKick = () => kick();

    const onReduce = () => {
      reduced = reduceQuery.matches;
      if (reduced) fetching?.fetchAbort?.abort();
      kick();
    };
    reduceQuery.addEventListener("change", onReduce);

    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      // One frame either way: off screen it lands the playhead on the scroll.
      kick(true);
    });
    io.observe(wrap);
    document.addEventListener("visibilitychange", onKick);
    window.addEventListener("scroll", onKick, { passive: true });
    window.addEventListener("resize", onKick);
    kick();

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __film?: unknown }).__film = {
        get x() {
          return x;
        },
        get p() {
          return p;
        },
        get tier() {
          return tier;
        },
        get waiting() {
          return waitHop;
        },
        get shot() {
          return lastShot;
        },
        total: TOTAL,
        segs: SEGS,
        clips,
      };
    }

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      reduceQuery.removeEventListener("change", onReduce);
      document.removeEventListener("visibilitychange", onKick);
      window.removeEventListener("scroll", onKick);
      window.removeEventListener("resize", onKick);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("pointerdown", onGesture);
      for (const c of clips) {
        c.fetchAbort?.abort();
        if (c.state === "attaching" || c.state === "ready") detach(c);
        if (c.url) URL.revokeObjectURL(c.url);
        c.url = null;
      }
      if (process.env.NODE_ENV !== "production") delete (window as unknown as { __film?: unknown }).__film;
    };
  }, []);

  const here = STOPS[stop];

  return (
    <div className={styles.film} data-film ref={wrapRef} style={{ height: `${TOTAL + 100}vh` }}>
      <div className={styles.screen}>
        <div ref={mediaRef} className={styles.media} aria-hidden="true">
          {STOPS.map((s, i) => (
            <div key={`stop-${i}`} ref={layer(`stop-${i}`)} className={styles.layer} />
          ))}
          {CLIP_HOPS.map((h) => (
            <Fragment key={h}>
              <div
                ref={layer(`first-${h}`)}
                className={styles.layer}
                style={OPENING_KEY === `first-${h}` ? OPENING_STYLE : undefined}
              />
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

        {/* The CubeSat, live over the first frame. It can be clicked. */}
        <div ref={orbitRef} className={styles.orbit}>
          <OrbitIntro active={orbitOn} earth={false} />
        </div>

        <div className={styles.shade} aria-hidden="true" />

        <div ref={captionRef} className={styles.caption}>
          <p className={styles.place}>{here.place}</p>
          <p className={styles.text}>{here.text}</p>
          {here.link || here.more?.length ? (
            <div className={styles.links}>
              {here.link ? (
                <Link className={styles.open} href={here.link.href}>
                  {here.link.label}
                </Link>
              ) : null}
              {here.more?.map((m) => (
                <Link key={m.href} className={styles.more} href={m.href}>
                  {m.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <div ref={loadRef} className={styles.load} aria-hidden="true">
          <span ref={loadFillRef} />
        </div>
      </div>
    </div>
  );
}
