"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import TransitionLink from "@/components/TransitionLink";
import OrbitIntro, { type OrbitControl } from "@/components/orbit/OrbitIntro";
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

  The first stop is the live scene: Earth turning slowly with the CubeSat flying in. It is
  framed exactly as the first clip, and as the first flight starts the planet rolls into the
  clip's first frame and the live layer cross-fades to the clip, all driven by the playhead.

  On a first visit at the top of the page the film opens with a short intro: black, the
  planet fades up, the words come in, then the CubeSat. Scrolling is held for its first
  three seconds, then a small scroll cue shows until the visitor scrolls.

  A pass stop is flown through: its short hold blends the clip before it into the clip after
  it, so the two clips play as one flight. Its words ride along on the flight.

  Each stop can carry up to two hotspots, rings on things in the picture that open a
  project. They show only while the playhead rests in the stop's hold.

  The scroll can run at most one stop ahead of where the film last landed. Past the middle of
  the next stop's hold, the page is held where it is until the playhead lands there, so a
  long swipe flies one flight and stops on its place. The side map lists every place: the
  next or last one plays its flight, a further one dips to black and opens there.
*/

type Kind = "video" | "wipe" | "fade";

const LAST = STOPS.length - 1;

/** One hop per pair of stops, whatever order or gaps HOPS has. */
const HOP_LIST: Hop[] = STOPS.slice(1).map(
  (_, i) => HOPS.find((h) => h.from === i && h.to === i + 1) ?? { from: i, to: i + 1, kind: "fade" },
);

const kindOf = (h: Hop): Kind => (h.kind === "video" ? (h.clip ? "video" : "fade") : h.kind);

const isPass = (k: number) => STOPS[k]?.pass === true;

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
      const hop: Seg = { start: at, len: HOP_LIST[i].scroll ?? SCROLL[kindOf(HOP_LIST[i])], stop: i, hop: i };
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
const STILL_NEAR = 1.5 * (SCROLL.video + SCROLL.hold);

// The hand-over from the live planet to the first clip, as shares of hop 0. The planet rolls
// into the clip's first pose, then the live layer cross-fades to the clip, which holds its
// first frame until the live layer is gone.
const ROLL_END = 0.06;
const LIVE_END = 0.12;
/** Top playhead speeds through the roll and the cross-fade, in vh/s: about 0.85 s and 0.45 s. */
const ROLL_SPEED = 12;
const LIVE_SPEED = 24;

// A pass stop's words: they come in from this share before the end of the hop into it, stay
// through the pass, and are gone by this share of the hop out of it.
const PASS_LEAD = 0.34;
const PASS_TAIL = 0.34;
const PASS_FADE = 0.08;

/** vh at each end of a hold's hops over which its hotspots fade. */
const SPOT_FADE = 4;

/** A pass stop's words slow the flight under them to this share of its speed, so they can be read. */
const PASS_PACE = 0.82;

/**
 * Stretches of film where the playhead goes slower than the part's own top speed: under a
 * fixed speed in vh/s, or a share of the part's speed.
 */
const SLOW: { from: number; to: number; speed?: number; share?: number }[] = [
  { from: HOP_SEG[0].start, to: HOP_SEG[0].start + ROLL_END * HOP_SEG[0].len, speed: ROLL_SPEED },
  { from: HOP_SEG[0].start + ROLL_END * HOP_SEG[0].len, to: HOP_SEG[0].start + LIVE_END * HOP_SEG[0].len, speed: LIVE_SPEED },
  ...STOPS.flatMap((s, k) =>
    s.pass && k > 0 && k < LAST
      ? [{ from: HOP_SEG[k - 1].start + (1 - PASS_LEAD) * HOP_SEG[k - 1].len, to: HOP_SEG[k].start + PASS_TAIL * HOP_SEG[k].len, share: PASS_PACE }]
      : [],
  ),
];

// The intro, in seconds from the moment the planet is on screen.
const INTRO_CAPTION = 1.0; // the words start to ease in
const INTRO_CAPTION_SECS = 0.9;
const INTRO_RELEASE = 3.0; // scrolling is let go
const INTRO_MAX_HOLD = 3500; // ms from mount: scrolling is never held longer than this
const INTRO_DONE = 7; // the CubeSat has settled
const EARTH_FIRST_MS = 1200; // clip fetching waits this long for the planet's textures
const SCROLL_KEYS = new Set([" ", "Spacebar", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "End", "Home"]);

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
// How far short of a clip's end the last seek lands, so it shows the last frame: a quarter
// of a frame at 60 fps, which is inside the last frame at 24, 30 and 60 fps alike.
const END_GUARD = 0.25 / 60;
const PHONE = "(max-width: 800px)";

// The scroll gate and the side map.
/** Stops the film rests on, in order: every stop that is not a pass stop. */
const RESTS = STOPS.flatMap((s, k) => (s.pass ? [] : [k]));
/** How far into a rest stop's hold the scroll may run before the playhead lands there. */
const GATE_SHARE = 0.5;
const SETTLE_MS = 300; // the playhead rests this long on a stop before the gate moves on
const CUE_IDLE_MS = 2600; // resting this long on a stop brings the scroll cue back
const DIP_MS = 280; // the side map's jump: fade to black, move, fade back
/** The scroll position a rest stop's gate sits at. */
const gateAt = (k: number) => (k === LAST ? TOTAL : HOLD_SEG[k].start + HOLD_SEG[k].len * GATE_SHARE);
/** Where the side map lands on a stop: just inside its hold. */
const landAt = (k: number) => (k === 0 ? 0 : HOLD_SEG[k].start + Math.min(4, HOLD_SEG[k].len * 0.08));
/** The rest stop whose hold holds this position, or -1. */
const restIn = (pos: number) => {
  for (const k of RESTS) {
    const h = HOLD_SEG[k];
    if (pos >= h.start - 1e-6 && pos <= h.start + h.len + 1e-6) return k;
  }
  return -1;
};
/** The last rest stop at or before this position. */
const restBefore = (pos: number) => {
  let out = RESTS[0];
  for (const k of RESTS) if (HOLD_SEG[k].start <= pos + 1e-6) out = k;
  return out;
};
/** How long a far jump stays on black waiting for the place's picture to load. */
const DIP_WAIT_MAX = 3000;
/**
 * The picture a far jump lands on: the last frame of the clip into the stop, or the stop's
 * own still. Loaded at high priority, once, and decoded so it shows at once.
 */
const landing = new Map<number, Promise<void>>();
const loadLanding = (k: number) => {
  let done = landing.get(k);
  if (!done) {
    const hop = k > 0 ? HOP_LIST[k - 1] : null;
    const src = hop && kindOf(hop) === "video" && hop.clip ? clipFile(hop.clip, "last.webp") : STOPS[k].still;
    const img = new Image();
    img.fetchPriority = "high";
    img.src = src;
    done = img.decode().catch(() => undefined);
    landing.set(k, done);
  }
  return done;
};
/** The side map's fill: rest stops passed so far, with the share of the way to the next. */
const mapProgress = (pos: number) => {
  for (let i = RESTS.length - 1; i >= 0; i--) {
    const a = HOLD_SEG[RESTS[i]].start;
    if (pos >= a) {
      if (i === RESTS.length - 1) return i;
      const b = HOLD_SEG[RESTS[i + 1]].start;
      return i + clamp01((pos - a) / (b - a));
    }
  }
  return 0;
};

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
/** How far into its clip a hop is: the first clip waits on its first frame for the hand-over. */
const clipProgress = (h: number, x: number) => {
  const f = hopProgress(h, x);
  return h === 0 ? clamp01((f - LIVE_END) / (1 - LIVE_END)) : f;
};

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
  /** The stop whose words are on screen. */
  stop: number;
  /** Opacity of the live layer (the planet and the CubeSat). */
  sat: number;
  /** 0 to 1: how far the planet has been rolled into the first clip's pose. */
  handover: number;
  /** Opacity of the hotspots, and the stop they belong to. */
  spots: number;
  spotStop: number;
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
  const h0 = p <= HOP_SEG[0].start ? 0 : hopProgress(0, p);
  const shot: Shot = {
    base: still(0),
    top: null,
    alpha: 0,
    wipe: null,
    veil: null,
    veilAlpha: 0,
    scale: 1,
    rest: 0,
    caption: 1,
    stop: seg.stop,
    sat: 1 - ease(clamp01((h0 - ROLL_END) / (LIVE_END - ROLL_END))),
    handover: ease(clamp01(h0 / ROLL_END)),
    spots: 0,
    spotStop: seg.stop,
  };

  if (seg.hop === null) {
    const k = seg.stop;
    const u = clamp01((p - seg.start) / seg.len);
    shot.base = arrive(k);
    shot.top = depart(k);
    if (isPass(k)) {
      // Flown through: the whole hold is the blend, with no push or breath. Its words stay.
      shot.alpha = ease(u);
    } else {
      shot.spots = 1;
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
    shot.stop = near;
    shot.spotStop = near;
    // The words leave as the flight starts and come back as it lands. A pass stop's words
    // ride the flight instead: in over the end of the hop before it, out over the start of
    // the hop after it.
    const fromEnd = f < 0.5 ? p - seg.start : seg.start + seg.len - p;
    if (isPass(near)) {
      shot.caption = f < 0.5 ? 1 - clamp01((f - (PASS_TAIL - PASS_FADE)) / PASS_FADE) : clamp01((f - (1 - PASS_LEAD)) / PASS_FADE);
    } else {
      shot.caption = 1 - clamp01(fromEnd / CAPTION_FADE);
      shot.spots = 1 - clamp01(fromEnd / SPOT_FADE);
    }
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

/** Intro state, shared between the film's loop and the scene's first-frame callback. */
type Intro = {
  phase: "off" | "waiting" | "playing" | "done";
  holding: boolean;
  /** performance.now() at mount, when the planet showed, and when scrolling was let go. */
  mount: number;
  shown: number;
  released: number;
  /** The scroll cue is showing. */
  cue: boolean;
};

export default function FilmScroll() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const spotsRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef<HTMLDivElement>(null);
  const loadFillRef = useRef<HTMLSpanElement>(null);
  const mapRef = useRef<HTMLElement>(null);
  const mapFillRef = useRef<HTMLSpanElement>(null);
  const dipRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<((k: number) => void) | null>(null);
  const layers = useRef(new Map<string, HTMLElement>());
  const refFns = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const orbitControl = useRef<OrbitControl | null>(null);
  // When the planet first showed, kept here because the scene can report it before the
  // film's effect has run.
  const shownAt = useRef(0);
  const shownHandler = useRef<(() => void) | null>(null);
  const [stop, setStop] = useState(0);
  const [spotStop, setSpotStop] = useState(0);
  const [orbitOn, setOrbitOn] = useState(true);

  const onShown = useCallback(() => {
    if (shownAt.current) return;
    shownAt.current = performance.now();
    shownHandler.current?.();
  }, []);

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
    // The gate: the stop the film last landed on, and a stop it is settling on.
    let home = 0;
    let settling = -1;
    let settleSince = 0;
    let snapNext = false; // the next frame puts the playhead on the scroll, for a jump
    let jumping = false;
    let lastScrollAt = performance.now();

    const targetOf = (c: Clip) => Math.min(Math.max(0, c.dur - END_GUARD), clipProgress(c.hop, p) * c.dur);

    // ---- Intro ---------------------------------------------------------------------------

    const intro: Intro = { phase: "off", holding: false, mount: performance.now(), shown: 0, released: 0, cue: false };
    // Only on a visit that starts at the top, with motion allowed and the page in view.
    if (!reduced && window.scrollY < 8 && !document.hidden) {
      intro.phase = "waiting";
      intro.holding = true;
    }
    // The caption's no-script entrance gives way to the playhead.
    if (captionRef.current) captionRef.current.style.animation = "none";
    const timers: number[] = [];

    const release = () => {
      if (!intro.holding) return;
      intro.holding = false;
      intro.released = performance.now();
      intro.cue = intro.phase !== "off" && x < 0.5;
      kick();
    };
    /** Ends the intro at once: words up, scrolling free, no cue. */
    const skipIntro = () => {
      if (intro.phase === "off" || intro.phase === "done") return;
      intro.phase = "done";
      intro.holding = false;
      intro.cue = false;
      kick();
    };
    const introCaption = (now: number) => {
      if (intro.phase === "off" || intro.phase === "done") return 1;
      if (intro.phase === "waiting") return 0;
      return ease(clamp01((now - intro.shown - INTRO_CAPTION * 1000) / (INTRO_CAPTION_SECS * 1000)));
    };
    const planetShown = () => {
      if (intro.phase !== "waiting") return;
      intro.phase = "playing";
      intro.shown = shownAt.current || performance.now();
      const at = Math.min(intro.shown + INTRO_RELEASE * 1000, intro.mount + INTRO_MAX_HOLD);
      timers.push(window.setTimeout(release, Math.max(0, at - performance.now())));
      timers.push(
        window.setTimeout(() => {
          if (intro.phase === "playing") intro.phase = "done";
        }, Math.max(0, intro.shown + INTRO_DONE * 1000 - performance.now())),
      );
      kick();
    };
    if (intro.phase === "waiting") {
      timers.push(window.setTimeout(release, INTRO_MAX_HOLD));
      // Clip fetching waits a moment for the planet's textures, then goes ahead regardless.
      timers.push(window.setTimeout(() => kick(), EARTH_FIRST_MS));
      shownHandler.current = planetShown;
    }

    // Holding the scroll: wheel, touch and scroll keys do nothing over the film while the
    // intro holds. The listeners sit on the window because the nav floats over the film's top
    // edge, and they only act while the film fills the screen. Overflow is never touched, so
    // nothing shifts. Escape lets go at once.
    const filmOnScreen = () => {
      const r = wrap.getBoundingClientRect();
      return r.top <= 1 && r.bottom >= window.innerHeight - 1;
    };
    const blockScroll = (e: Event) => {
      if (intro.holding && filmOnScreen() && e.cancelable) e.preventDefault();
    };
    const onKeyHold = (e: KeyboardEvent) => {
      if (!intro.holding) return;
      if (e.key === "Escape") {
        release();
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (!typing && SCROLL_KEYS.has(e.key) && filmOnScreen()) e.preventDefault();
    };
    // Anything that moves the page while scrolling is held (restoring a scroll position, a
    // link to a fragment) ends the intro: the visit did not start at the top after all.
    const onScrollHold = () => {
      if (intro.holding && window.scrollY > 40) skipIntro();
    };
    if (intro.holding) {
      window.addEventListener("wheel", blockScroll, { passive: false });
      window.addEventListener("touchmove", blockScroll, { passive: false });
      window.addEventListener("keydown", onKeyHold);
      window.addEventListener("scroll", onScrollHold, { passive: true });
    }

    // ---- Gate ----------------------------------------------------------------------------

    const gateOn = () => !reduced && !intro.holding && !jumping;
    /** Page scroll position of a film position. */
    const yOf = (pos: number) => {
      const r = wrap.getBoundingClientRect();
      const span = Math.max(1, r.height - window.innerHeight);
      return r.top + window.scrollY + (pos / TOTAL) * span;
    };
    // Runs on every scroll, before the frame: holds the page between the gates either side
    // of the stop the film last landed on. The film is pinned, so the hold does not show.
    const onScrollGate = () => {
      lastScrollAt = performance.now();
      if (!gateOn()) return;
      const i = RESTS.indexOf(home);
      const lo = i > 0 ? yOf(gateAt(RESTS[i - 1])) : -Infinity;
      const hi = i < RESTS.length - 1 ? yOf(gateAt(RESTS[i + 1])) : Infinity;
      const y = window.scrollY;
      if (y > hi + 1) window.scrollTo({ top: hi, behavior: "instant" });
      else if (y < lo - 1) window.scrollTo({ top: lo, behavior: "instant" });
    };

    const timersJump: number[] = [];
    // The side map. A neighbouring stop plays its flight. A further one dips to black, moves
    // the film there with the playhead on it, and fades back.
    const jumpTo = (k: number) => {
      if (jumping || disposed) return;
      skipIntro();
      const i = RESTS.indexOf(home);
      const j = RESTS.indexOf(k);
      if (j < 0) return;
      const target = landAt(k);
      if (reduced || Math.abs(j - i) <= 1) {
        window.scrollTo({ top: yOf(target), behavior: "instant" });
        kick();
        return;
      }
      jumping = true;
      put(dipRef.current, "opacity", "1");
      put(dipRef.current, "visibility", "visible");
      // The place's picture loads during the dip, and the film stays on black until it can show.
      const picture = loadLanding(k);
      const dipped = new Promise<void>((r) => timersJump.push(window.setTimeout(r, DIP_MS)));
      const late = new Promise<void>((r) => timersJump.push(window.setTimeout(r, DIP_WAIT_MAX)));
      void dipped.then(() => {
        if (disposed) return;
        home = k;
        settling = -1;
        window.scrollTo({ top: yOf(target), behavior: "instant" });
        snapNext = true;
        kick(true);
        const settled = new Promise<void>((r) => timersJump.push(window.setTimeout(r, 220)));
        void Promise.all([settled, Promise.race([picture, late])]).then(() => {
          if (disposed) return;
          jumping = false;
          put(dipRef.current, "opacity", "0");
          timersJump.push(window.setTimeout(() => put(dipRef.current, "visibility", "hidden"), DIP_MS + 40));
          kick();
        });
      });
    };
    jumpRef.current = jumpTo;

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
        let bound = d > 0 ? seg.start + seg.len : seg.start;
        let top = speedIn(seg, d);
        // A slow stretch caps the speed inside it, and its edges split the step like a part's.
        for (const z of SLOW) {
          const inside = d > 0 ? p >= z.from && p < z.to : p > z.from && p <= z.to;
          if (inside) {
            top = Math.min(top, z.speed ?? Infinity, z.share ? z.share * speedIn(seg, d) : Infinity);
            bound = d > 0 ? Math.min(bound, z.to) : Math.max(bound, z.from);
          } else {
            const edge = d > 0 ? z.from : z.to;
            if (d > 0 ? edge > p && edge < bound : edge < p && edge > bound) bound = edge;
          }
        }
        const room = Math.abs(bound - p);
        const step = Math.min(Math.abs(gap) * (1 - Math.exp(-FOLLOW * left)), top * left);
        if (step < room) {
          p += d * step;
          break;
        }
        left -= room / Math.max(1e-6, Math.min(Math.abs(gap) * FOLLOW, top));
        p = bound;
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
      // The intro's planet gets the line first, briefly.
      if (intro.phase === "waiting" && performance.now() - intro.mount < EARTH_FIRST_MS) return;
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
    let lastSpotStop = -1;
    let lastSat = true;
    let lastHandover = -1;
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
      if (s.handover !== lastHandover && orbitControl.current) {
        lastHandover = s.handover;
        orbitControl.current.setHandover(s.handover);
      }

      const breath = s.rest * DRIFT * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / DRIFT_MS));
      const scale = `scale(${(s.scale + breath).toFixed(4)})`;
      put(media, "transform", scale);

      // The hotspots ride the same push-in as the picture, so they stay on their things.
      const spots = spotsRef.current;
      const so = STOPS[s.spotStop]?.spots?.length ? s.spots : 0;
      put(spots, "transform", scale);
      put(spots, "opacity", so.toFixed(3));
      put(spots, "visibility", so > 0.01 ? "visible" : "hidden");
      if (so > 0.001 && s.spotStop !== lastSpotStop) {
        lastSpotStop = s.spotStop;
        setSpotStop(s.spotStop);
      }

      put(veilRef.current, "background", s.veil ?? "transparent");
      put(veilRef.current, "opacity", s.veil ? s.veilAlpha.toFixed(3) : "0");
      const scanOn = s.wipe !== null;
      put(scanRef.current, "opacity", scanOn ? "1" : "0");
      if (scanOn) put(scanRef.current, "left", `${((s.wipe ?? 0) * 100).toFixed(2)}%`);

      const c = s.caption * introCaption(now);
      put(captionRef.current, "opacity", c.toFixed(3));
      put(captionRef.current, "transform", `translateY(${((1 - c) * 12).toFixed(1)}px)`);
      put(captionRef.current, "visibility", c > 0.01 ? "visible" : "hidden");
      if (s.stop !== lastStop) {
        lastStop = s.stop;
        setStop(s.stop);
      }

      // The scroll cue shows once the intro lets go, until the visitor first scrolls, and again
      // whenever the film has rested a while on a stop with more to come.
      if (intro.cue && x > 0.5) intro.cue = false;
      const resting = !intro.holding && p === x && waitHop === null && restIn(p) >= 0 && restIn(p) !== LAST;
      const cue = intro.cue || (resting && now - lastScrollAt > CUE_IDLE_MS);
      put(cueRef.current, "opacity", cue ? "1" : "0");

      // The side map: hidden while the intro holds, its fill tracking the playhead.
      put(mapRef.current, "opacity", intro.holding ? "0" : "1");
      put(mapRef.current, "visibility", intro.holding ? "hidden" : "visible");
      put(mapFillRef.current, "transform", `scaleY(${(mapProgress(p) / Math.max(1, RESTS.length - 1)).toFixed(4)})`);

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
      if (!started || reduced || !inView || snapNext) {
        p = x;
        waitHop = null;
        started = true;
        snapNext = false;
        // Wherever the playhead was put, the gate starts from there.
        if (!jumping) home = restBefore(p);
        settling = -1;
      } else advance(dt);
      if (x !== p) dir = x > p ? 1 : -1;
      if (waitHop !== null && waitHop !== waited) waitSince = now;

      manage();
      pump();

      let busy = p !== x || waitHop !== null;

      // The gate moves on once the playhead has rested on a new stop for a moment.
      const at = restIn(p);
      if (at >= 0 && at !== home) {
        if (settling !== at) {
          settling = at;
          settleSince = now;
        }
        if (now - settleSince >= SETTLE_MS) {
          home = at;
          settling = -1;
        } else busy = true;
      } else settling = -1;
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
      // The breath animates for as long as a hold is in view, and the intro's words until up.
      if (shot.rest > 0) busy = true;
      if (intro.phase === "playing" && introCaption(now) < 1) busy = true;
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
    window.addEventListener("scroll", onScrollGate, { passive: true });
    window.addEventListener("scroll", onKick, { passive: true });
    window.addEventListener("resize", onKick);
    kick();
    // The planet may have shown before this effect ran.
    if (intro.phase === "waiting" && shownAt.current) planetShown();

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __film?: unknown }).__film = {
        get x() {
          return x;
        },
        get intro() {
          const now = performance.now();
          return {
            phase: intro.phase,
            holding: intro.holding,
            cue: intro.cue,
            shownMs: intro.shown ? Math.round(intro.shown - intro.mount) : null,
            releasedMs: intro.released ? Math.round(intro.released - intro.mount) : null,
            sinceMountMs: Math.round(now - intro.mount),
            caption: +introCaption(now).toFixed(3),
          };
        },
        get p() {
          return p;
        },
        get tier() {
          return tier;
        },
        get home() {
          return home;
        },
        jump: (k: number) => jumpTo(k),
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
      timers.forEach((t) => clearTimeout(t));
      shownHandler.current = null;
      window.removeEventListener("wheel", blockScroll);
      window.removeEventListener("touchmove", blockScroll);
      window.removeEventListener("keydown", onKeyHold);
      window.removeEventListener("scroll", onScrollHold);
      io.disconnect();
      reduceQuery.removeEventListener("change", onReduce);
      document.removeEventListener("visibilitychange", onKick);
      window.removeEventListener("scroll", onScrollGate);
      window.removeEventListener("scroll", onKick);
      window.removeEventListener("resize", onKick);
      timersJump.forEach((t) => clearTimeout(t));
      jumpRef.current = null;
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

  // Each hotspot's label goes on the side with room. A hotspot that would sit off screen,
  // under the nav, on the words or on another hotspot is left out, so a phone may keep one.
  useEffect(() => {
    const layer = spotsRef.current;
    const screen = screenRef.current;
    if (!layer || !screen) return;
    let raf = 0;
    const PAD = 10;
    const hits = (a: DOMRect, b: DOMRect) =>
      a.left < b.right + PAD && a.right > b.left - PAD && a.top < b.bottom + PAD && a.bottom > b.top - PAD;
    const fit = () => {
      raf = 0;
      const box = screen.getBoundingClientRect();
      const nav = document.querySelector("body > header")?.getBoundingClientRect();
      const top = Math.max(box.top, nav && nav.bottom > box.top ? nav.bottom : box.top) + 4;
      const words = captionRef.current?.getBoundingClientRect();
      const kept: DOMRect[] = [];
      const map = mapRef.current?.getBoundingClientRect();
      if (map && map.width > 0) kept.push(map);
      // What shows of a spot: its ring and its label, without the link's padding.
      const shown = (el: HTMLElement) => {
        const a = (el.firstElementChild as HTMLElement).getBoundingClientRect();
        const b = (el.lastElementChild as HTMLElement).getBoundingClientRect();
        const l = Math.min(a.left, b.left);
        const t = Math.min(a.top, b.top);
        return { ring: a, all: new DOMRect(l, t, Math.max(a.right, b.right) - l, Math.max(a.bottom, b.bottom) - t) };
      };
      const outside = (r: DOMRect) => r.left < box.left + 6 || r.right > box.right - 6;
      for (const el of layer.querySelectorAll<HTMLElement>("[data-spot]")) {
        el.dataset.off = "false";
        el.dataset.side = el.dataset.prefer ?? "right";
        let s = shown(el);
        if (outside(s.all)) {
          el.dataset.side = el.dataset.side === "right" ? "left" : "right";
          s = shown(el);
        }
        const cx = s.ring.left + s.ring.width / 2;
        const off =
          cx < box.left + 16 ||
          cx > box.right - 16 ||
          s.ring.top < top ||
          s.ring.bottom > box.bottom - 8 ||
          outside(s.all) ||
          (!!words && words.height > 0 && hits(s.all, words)) ||
          kept.some((k) => hits(s.all, k));
        if (off) el.dataset.off = "true";
        else kept.push(s.all);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(fit);
    };
    schedule();
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
    };
  }, [spotStop, stop]);

  const here = STOPS[stop];
  const spots = STOPS[spotStop].spots ?? [];

  return (
    <div className={styles.film} data-film ref={wrapRef} style={{ height: `${TOTAL + 100}vh` }}>
      <div ref={screenRef} className={styles.screen}>
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

        {/* The live planet with the CubeSat. The CubeSat can be clicked. */}
        <div ref={orbitRef} className={styles.orbit}>
          <OrbitIntro active={orbitOn} poster={STOPS[0].still} control={orbitControl} onShown={onShown} />
        </div>

        <div className={styles.shade} aria-hidden="true" />

        {/* Hotspots on things in the picture, framed like the picture under object-fit: cover. */}
        <div ref={spotsRef} className={styles.spots}>
          <div className={styles.frame}>
            {spots.map((s) => (
              <TransitionLink
                key={`${spotStop}-${s.href}-${s.x}`}
                href={s.href}
                className={styles.spot}
                data-spot=""
                data-prefer={s.x > 0.6 ? "left" : "right"}
                style={{ left: `${(s.x * 100).toFixed(2)}%`, top: `${(s.y * 100).toFixed(2)}%` }}
              >
                <span className={styles.ring} aria-hidden="true" />
                <span className={styles.leader} aria-hidden="true" />
                <span className={styles.spotLabel}>{s.label}</span>
              </TransitionLink>
            ))}
          </div>
        </div>

        <div ref={captionRef} className={styles.caption}>
          <p className={styles.place}>{here.place}</p>
          <p className={styles.text}>{here.text}</p>
          {here.link ? (
            <div className={styles.links}>
              <TransitionLink className={styles.open} href={here.link.href}>
                {here.link.label}
              </TransitionLink>
            </div>
          ) : null}
        </div>

        <div ref={cueRef} className={styles.cue} aria-hidden="true">
          <span>
            Scroll<span className={styles.cueMore}> to fly on</span>
          </span>
          <i />
        </div>

        <nav ref={mapRef} className={styles.map} aria-label="Places in the film">
          <span className={styles.mapRail} aria-hidden="true">
            <span ref={mapFillRef} className={styles.mapFill} />
          </span>
          <ol>
            {RESTS.map((k) => (
              <li key={k}>
                <button
                  type="button"
                  className={styles.mapStop}
                  aria-current={k === stop ? "location" : undefined}
                  onClick={() => jumpRef.current?.(k)}
                  onPointerEnter={() => void loadLanding(k)}
                  onFocus={() => void loadLanding(k)}
                >
                  <span className={styles.mapLabel}>{STOPS[k].short}</span>
                  <span className={styles.mapDot} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div ref={dipRef} className={styles.dip} aria-hidden="true" />

        <div ref={loadRef} className={styles.load} aria-hidden="true">
          <span ref={loadFillRef} />
        </div>
      </div>
    </div>
  );
}
