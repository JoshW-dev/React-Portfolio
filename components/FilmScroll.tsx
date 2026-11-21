"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import TransitionLink from "@/components/TransitionLink";
import OrbitIntro, { type OrbitControl } from "@/components/orbit/OrbitIntro";
import { MotionFade, MovingStill, loadPicture, motionAllowed, type Motion, type Source } from "@/components/film/movingStill";
import FilmLoop, { keepLoop, keptFile, keptLoop, loopFile, startLoop } from "@/components/film/FilmLoop";
import { HOPS, SCROLL, STOPS, VEILS, clipFile, motionForFrame, type ClipPart, type Hop, type Loop } from "@/lib/film";
import { filmUrl } from "@/lib/filmUrl";
import { slowLink as measuredSlow } from "@/lib/netRate";
import { setHandoff, type Handoff } from "@/lib/handoff";
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

  Each stop can carry up to three hotspots, rings on things in the picture that open a
  project. They show only while the playhead rests in the stop's hold.

  The scroll can run at most one stop ahead of where the film last landed. Past the middle of
  the next stop's hold, the page is held where it is until the playhead lands there, so a
  long swipe flies one flight and stops on its place. The side map lists every place: the
  next or last one plays its flight, a further one dips to black and opens there.

  A flight that starts always finishes. Once the scroll leaves a stop's hold, the playhead
  heads for the next stop in the way the page last scrolled, wherever the scroll stops. When
  the gesture ends, the page is moved to that stop too, so the next scroll starts from there.
  The film is pinned, so the move does not show.

  On a touch screen beside a mouse (a laptop's) one swipe moves one stop. Once a touch gesture
  has moved the page a short way, it picks the next stop that way (mid-flight: the end of the
  flight, or back where it came from) and the film flies there, however far the finger and the
  momentum carry the page. When the gesture ends, the page is moved to that stop. A mouse wheel
  or trackpad still scrolls through each hold as before.

  On a phone or tablet the film is a reel instead, like a feed of short videos. The film is one
  screen tall and follows the finger itself (Reel, below): a drag moves the flight with the
  finger from the first pixel, and the words slide with it. When the finger lifts, a flick or a
  drag past a short way flies on to the next place in that direction, and anything less goes
  back. A swipe during a flight catches it where it is, and a flick then adds a place. Flights
  play their clip at speed (Flights, below), which a phone shows smoothly where it can't seek
  frame by frame. The intro never holds a swipe. At the last place a swipe up scrolls the page
  on to the projects, and the browser's back button reopens the reel on the place it showed.

  iOS loads only a video's metadata until it has played, and in low power mode plays it only
  from a touch. Each clip is played for a moment as it attaches, and the first touch that ends
  plays and pauses every clip's video, which lifts both for good (Unlocking, below).

  Once the film rests on a stop, one thing in its picture starts to move (film/movingStill.ts):
  a canvas over the layers fades in drawing the same frames, then lets its motion grow. It
  fades out as a flight starts. With reduced motion, without WebGL, or on a machine that
  can't keep up, it stays off and the stop shows its still as before.
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
    return { key: `stop-${i}`, bg: `url(${filmUrl(s.still)})`, from: i === 0 ? 0 : HOP_SEG[i - 1].start, to: after.start + after.len, clip: false };
  }),
  ...CLIP_HOPS.flatMap((h): Still[] => {
    const name = HOP_LIST[h].clip as string;
    const from = h === 0 ? 0 : HOP_SEG[h].start;
    const to = HOP_SEG[h].start + HOP_SEG[h].len;
    // The stop's own still sits under each clip still, so a missing file never leaves a hole.
    return [
      { key: `first-${h}`, bg: `url(${filmUrl(clipFile(name, "first.webp"))}), url(${filmUrl(STOPS[h].still)})`, from, to, clip: true },
      { key: `last-${h}`, bg: `url(${filmUrl(clipFile(name, "last.webp"))}), url(${filmUrl(STOPS[h + 1].still)})`, from, to, clip: true },
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

/** After this long on the page, the moving still's canvas is set up in an idle moment. */
const MOVING_WARM_MS = 6000;
/** The moving still draws at most this often, about 30 times a second. */
const MOVE_DRAW_MS = 30;
const LOOP_SETTLE = 0.6; // s the film rests on a stop before its loop may fade in
const LOOP_SETTLE_AGAIN = 0.12; // the same, on a return to a stop whose loop already showed
/**
 * Loops (by base path) and moving stills (by map) that have shown in full in this page load.
 * Coming back to their stop, they show again at once: no long rest, a short fade, and a loop
 * picks up where it paused instead of rewinding (its file is already in memory).
 */
const motionShown = new Set<string>();

/** How long the film rests on a stop before it loads the pictures of the projects it opens. */
const FRAMES_AFTER_MS = 800;
/** Project pictures already asked for, so each loads once per page load. */
const framesAsked = new Set<string>();

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

// The reel, on a screen held in the hand: the film follows the finger, the way a feed of short
// videos does, and flies on or back when it lifts. A flight plays its clip at speed instead of
// seeking it frame by frame.
const REEL = "(hover: none) and (pointer: coarse)";
/** Share of the way between two places that crosses the rest of the first place's hold. */
const REEL_DEPART = 0.01;
const REEL_HOLD_SPEED = 650; // vh/s across a hold
/** A drag this share of the screen's height long moves the film one place. */
const REEL_DRAG = 0.7;
/** px a finger moves before its touch counts as a drag rather than a tap. */
const REEL_SLOP = 6;
/** px/ms: a finger lifting this fast flies on in its direction, however short the drag. */
const REEL_FLICK = 0.25;
/** A swipe shorter than this many ms that covers REEL_SWIPE_MIN px flies on in its direction. */
const REEL_SWIPE_MS = 300;
const REEL_SWIPE_MIN = 24;
/** Share of the way to the next place that a slow drag must cover to fly on rather than go back. */
const REEL_COMMIT = 0.18;
/** How far, in places, a drag can pull past the first or last place, against rising resistance. */
const REEL_EDGE = 0.1;
/** ms of the finger's last moves that set its speed as it lifts. */
const REEL_TRAIL_MS = 100;
/** Per second: how fast a pull past the first or last place springs back. */
const REEL_SPRING = 14;
/** px of wheel in one gesture that move the reel a place, and ms without one that end it. */
const REEL_WHEEL_STEP = 30;
const REEL_WHEEL_IDLE = 220;
/** A reel flight lasts about this long: its clip plays at up to REEL_RATE_TOP times its speed. */
const REEL_FLIGHT_SECS = 2.8;
const REEL_RATE_TOP = 4.5;
/** The planet's roll and cross-fade into the first clip run this much faster in the reel. */
const REEL_HANDOVER = 1.4;
/** A flight's clip that shows no new frame for this long is seeked instead, from then on. */
const FLIGHT_STUCK_MS = 500;
/** How long after the browser's back or forward the film counts as opened by it. */
const BACK_MS = 3000;

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
/** Where a flight back to a rest stop lands: just inside the end of its hold. */
const backAt = (k: number) => HOLD_SEG[k].start + HOLD_SEG[k].len - Math.min(4, HOLD_SEG[k].len * 0.08);
/**
 * Where the film is headed for a scroll position. Inside a rest stop's hold it is the scroll
 * itself. Between two rest stops it is the whole way to one of them, in the way the page
 * last scrolled, so the film never rests mid-flight.
 */
const destination = (pos: number, way: number) => {
  if (restIn(pos) >= 0) return pos;
  const a = restBefore(pos);
  const b = RESTS[RESTS.indexOf(a) + 1];
  if (b === undefined) return pos;
  return way < 0 ? backAt(a) : landAt(b);
};
/** No scroll for this long ends a gesture, and a page left between two stops moves on. */
const IDLE_MS = 160;
/** A touch gesture that moves the page this share of the screen flies one stop. */
const SWIPE_SHARE = 0.08;
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
    img.src = filmUrl(src);
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

/** Where the film rests on each place in the reel: just inside its hold, where flights land. */
const REEL_AT = RESTS.map((k) => landAt(k));
/**
 * The film position for a reel position, counted in places. The first REEL_DEPART of the way
 * crosses the rest of the place's hold, so a flight starts as soon as the finger moves.
 */
const reelFilm = (s: number) => {
  const n = REEL_AT.length - 1;
  if (n <= 0 || s <= 0) return REEL_AT[0];
  if (s >= n) return REEL_AT[n];
  const i = Math.floor(s);
  const t = s - i;
  const a = REEL_AT[i];
  const b = REEL_AT[i + 1];
  const hold = HOLD_SEG[RESTS[i]];
  const out = hold.start + hold.len;
  return t <= REEL_DEPART ? a + (out - a) * (t / REEL_DEPART) : out + (b - out) * ((t - REEL_DEPART) / (1 - REEL_DEPART));
};
/** The reel position, in places, of a film position: reelFilm the other way round. */
const reelPlace = (pos: number) => {
  const n = REEL_AT.length - 1;
  if (n <= 0 || pos <= REEL_AT[0]) return 0;
  if (pos >= REEL_AT[n]) return n;
  let i = 0;
  while (i < n - 1 && pos >= REEL_AT[i + 1]) i++;
  const a = REEL_AT[i];
  const b = REEL_AT[i + 1];
  const hold = HOLD_SEG[RESTS[i]];
  const out = hold.start + hold.len;
  return pos <= out
    ? i + REEL_DEPART * clamp01((pos - a) / Math.max(1e-6, out - a))
    : i + REEL_DEPART + (1 - REEL_DEPART) * clamp01((pos - out) / Math.max(1e-6, b - out));
};
/** A pull of o places past the first or last place, against resistance: at most REEL_EDGE. */
const edgePull = (o: number) => REEL_EDGE * (1 - 1 / (1 + o / REEL_EDGE));
/** The reel's place when the film last showed, so the browser's back button returns to it. */
let reelKept = 0;
let poppedAt = -Infinity;
if (typeof window !== "undefined") window.addEventListener("popstate", () => (poppedAt = performance.now()));

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

/** A clip playing at speed through a flight in the reel. */
type Flight = {
  c: Clip;
  el: HTMLVideoElement;
  /** The clip's time when it last moved on, and seconds of frames drawn since then. */
  lastT: number;
  still: number;
};

/*
  Downloads that outlive one showing of the film. Clip files fetched whole are kept as object
  URLs for the page's life, by file path, as the loops are (FilmLoop.tsx), so the film shown
  again (back from a project page) plays them from memory with no request. A download still
  running when the film unmounts finishes into the same store, and the next showing waits on
  it instead of starting over. The quality tier the first fetch measured is kept as well, so
  a slow link isn't tested again on the big file.
*/
type Download = { done: Promise<void>; received: number; total: number };
const keptClips = new Map<string, string>();
const clipDownloads = new Map<string, Download>();
const loopDownloads = new Map<string, Promise<void>>();
let keptTier: Tier | null = null;
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

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

/** flat: no push-in, for the reel, which rests at the start of a hold and crosses the rest at once. */
function compose(p: number, ready: (h: number) => boolean, reduced: boolean, flat = false): Shot {
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
  const push = (k: number) => (reduced || flat || k === 0 || isPass(k) ? 0 : PUSH);

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

/** No project pictures given. */
const NO_FRAMES: Record<string, string> = {};

/**
 * frames: each project page's hero picture, by its path, so the film can load the pictures
 * of the projects a stop opens while it rests there.
 */
export default function FilmScroll({ frames = NO_FRAMES }: { frames?: Record<string, string> }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const movingRef = useRef<HTMLCanvasElement>(null);
  /** Each stop's loop video, by stop. */
  const loopRefs = useRef<(HTMLVideoElement | null)[]>([]);
  /** Records what the film shows, for the project page a link opens (lib/handoff.ts). */
  const handOffRef = useRef<(() => void) | null>(null);
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
    // The reel: the film follows the finger, one place per swipe (REEL above). The stylesheet
    // switches on the same query, so the two always agree.
    const reelQuery = window.matchMedia(REEL);
    let reel = reelQuery.matches;
    // The place the reel rests on or flies to, as an index into RESTS. Back to the film, it
    // opens on the place it showed when the visitor left.
    let reelTo = reel && performance.now() - poppedAt < BACK_MS ? reelKept : 0;
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
    let tier: Tier = keptTier ?? (slowLink ? "low" : "high");
    let tierFixed = keptTier !== null || slowLink;

    const clips: Clip[] = CLIP_HOPS.map((h) => {
      const name = HOP_LIST[h].clip as string;
      // Fetched on an earlier showing: already in memory, this tier's file first.
      const file = [parts[tier], parts.high, parts.low].map((part) => clipFile(name, part)).find((f) => keptClips.has(f)) ?? "";
      const url = file ? (keptClips.get(file) ?? null) : null;
      return { hop: h, name, state: url ? "fetched" : "idle", file, received: 0, total: 0, url, dur: 0, fetchAbort: null, attachAbort: null };
    });
    const clipOf: (Clip | undefined)[] = [];
    clips.forEach((c) => (clipOf[c.hop] = c));
    const videoOf = (c: Clip) => layers.current.get(`video-${c.hop}`) as HTMLVideoElement | undefined;
    const ready = (h: number) => clipOf[h]?.state === "ready";
    /** A clip hop that will play its clip once it is ready. */
    const playable = (h: number) => !videoOff() && kindOf(HOP_LIST[h]) === "video" && clipOf[h]?.state !== "failed";
    const gated = (h: number) => playable(h) && !ready(h);

    let x = 0; // where the scroll puts the film, in vh
    let goal = 0; // where the playhead is headed: the scroll, or the stop a flight goes to
    let way = 1; // the way the page last scrolled
    let lastY = window.scrollY;
    let touching = false;
    let idleTimer = 0;
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
    // A touch gesture runs from a finger down until the page has been still for IDLE_MS after
    // the last finger lifts, momentum included. swipe: where the page was when it started,
    // until it picks a stop. aim: where it sends the film, kept until the page is still.
    let swipe: { y0: number } | null = null;
    let aim: number | null = null;
    // A clip playing at speed for a flight in the reel (Flights, below), and whether the
    // browser has refused to play one until the next touch.
    let flight: Flight | null = null;
    let flightBlocked = false;
    /** Clip hops whose clip would not play smoothly: their flights seek, as on a desktop. */
    const unplayable = new Set<number>();
    /** The document has scrolled past the top of the reel, so a swipe on it moves the page. */
    let pageOn = false;
    /**
     * A finger on the reel (Reel, below). down: where and when it went down. y0: where the
     * film was caught once it moved. s0: the film's place then. heading: where a flight it
     * caught was going. s: the place it has dragged the film to, past the first or last place
     * against resistance. mode: "film" once it drags the film, "page" when the page scrolls
     * under it, null until it has moved far enough to tell. trail: its last moves, for its speed.
     */
    type ReelDrag = {
      id: number;
      down: { y: number; t: number };
      x0: number;
      y0: number;
      s0: number;
      heading: number | null;
      s: number;
      mode: "film" | "page" | null;
      trail: { y: number; t: number }[];
    };
    let drag: ReelDrag | null = null;
    /** Places a drag pulled past the first or last place, springing back once it lets go. */
    let reelOver = 0;
    /** A finger is dragging the film. */
    const dragging = () => drag?.mode === "film";
    /** The last time a finger let go of the film: its speed, where it left it, where it went. */
    let reelLetGo: { v: number; s: number; to: number } | null = null;

    const targetOf = (c: Clip) => Math.min(Math.max(0, c.dur - END_GUARD), clipProgress(c.hop, p) * c.dur);

    // ---- Intro ---------------------------------------------------------------------------

    const intro: Intro = { phase: "off", holding: false, mount: performance.now(), shown: 0, released: 0, cue: false };
    // Only on a visit that starts at the top, with motion allowed and the page in view. In the
    // reel a swipe is never held: it flies at once, and the intro plays on under it.
    if (!reduced && window.scrollY < 8 && (!reel || reelTo === 0) && !document.hidden) {
      intro.phase = "waiting";
      intro.holding = !reel;
    }
    // The caption's no-script entrance gives way to the playhead.
    if (captionRef.current) captionRef.current.style.animation = "none";
    const timers: number[] = [];

    // In the reel nothing is held, and this only brings up the scroll cue at the same moment.
    const release = () => {
      if (intro.released) return;
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
      intro.released ||= performance.now();
      intro.cue = false;
      kick();
    };
    /** The intro's words as a swipe flew off before they were all in: they go no further. */
    let introLeft = -1;
    const introCaption = (now: number) => {
      if (intro.phase === "off" || intro.phase === "done") return 1;
      if (introLeft >= 0) return introLeft;
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

    // The reel has no gate: its snapping already moves one place per swipe.
    const gateOn = () => !reel && !reduced && !intro.holding && !jumping;
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
      const y0 = window.scrollY;
      if (Math.abs(y0 - lastY) > 0.5) way = y0 > lastY ? 1 : -1;
      lastY = y0;
      idleSoon();
      if (!gateOn()) return;
      // A swipe that has moved the page far enough picks its stop, once per gesture.
      if (swipe) {
        const moved = y0 - swipe.y0;
        if (Math.abs(moved) >= SWIPE_SHARE * window.innerHeight) {
          aimSwipe(moved > 0 ? 1 : -1);
          swipe = null;
        }
      }
      const i = RESTS.indexOf(home);
      const lo = i > 0 ? yOf(gateAt(RESTS[i - 1])) : -Infinity;
      const hi = i < RESTS.length - 1 ? yOf(gateAt(RESTS[i + 1])) : Infinity;
      const y = window.scrollY;
      if (y > hi + 1) window.scrollTo({ top: hi, behavior: "instant" });
      else if (y < lo - 1) window.scrollTo({ top: lo, behavior: "instant" });
    };

    // When a gesture ends between two stops, the page moves to the stop the film is flying
    // to, so the next scroll starts there. A finger on the screen holds this off until it lifts.
    const settlePage = () => {
      idleTimer = 0;
      if (disposed || touching) return;
      const wait = IDLE_MS - (performance.now() - lastScrollAt);
      if (wait > 1) {
        idleTimer = window.setTimeout(settlePage, wait);
        return;
      }
      // The gesture is over.
      const aimed = aim;
      aim = null;
      swipe = null;
      if (!gateOn() || !filmOnScreen()) return;
      const r = wrap.getBoundingClientRect();
      const at = clamp01(-r.top / Math.max(1, r.height - window.innerHeight)) * TOTAL;
      const to = aimed ?? destination(at, way);
      if (Math.abs(to - at) > 0.5) window.scrollTo({ top: yOf(to), behavior: "instant" });
    };
    function idleSoon() {
      if (!idleTimer && !disposed) idleTimer = window.setTimeout(settlePage, IDLE_MS);
    }

    /**
     * The rest stop a swipe in direction d flies to, or -1. From a stop it is the next one that
     * way. Mid-flight, a swipe the same way keeps the flight, and the other way turns it back.
     */
    const swipeTarget = (d: number) => {
      const to = restIn(goal);
      if (to < 0) return -1;
      if (restIn(p) !== to && Math.sign(goal - p) === d) return to;
      return RESTS[RESTS.indexOf(to) + d] ?? -1;
    };
    const aimSwipe = (d: number) => {
      const k = swipeTarget(d);
      if (k < 0) return;
      // The film is on a stop: it has landed there, whether or not it has settled yet.
      const at = restIn(p);
      if (at >= 0 && at === restIn(goal)) {
        home = at;
        settling = -1;
      }
      aim = d > 0 ? landAt(k) : backAt(k);
      kick();
    };

    const onTouchStart = (e: TouchEvent) => {
      touching = true;
      // One finger with the film on screen starts a swipe. A second finger (a pinch) ends it.
      swipe = e.touches.length === 1 && filmOnScreen() ? { y0: window.scrollY } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length) return;
      touching = false;
      lastScrollAt = performance.now();
      idleSoon();
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    // ---- Reel ----------------------------------------------------------------------------

    // The film follows a finger on it, from wherever the finger catches it, mid-flight or at
    // rest: a drag of REEL_DRAG of the screen's height moves it one place. When the finger
    // lifts, a flick flies on to the next place its way (one past a flight it caught going
    // that way, so each flick in a row adds a place). A slow drag flies on once it has covered
    // REEL_COMMIT of the way, and goes back otherwise. A caught flight flies on to where it
    // was going, unless the drag pulled it back that far. The flight starts inside the touch's
    // end, which iOS counts as a gesture, so it plays even in low power mode.

    /** Sends the reel to a place: the film flies there from wherever it is. */
    const reelGo = (j: number) => {
      reelTo = Math.min(RESTS.length - 1, Math.max(0, j));
      reelKept = reelTo;
      lastScrollAt = performance.now();
      kick();
    };
    const touchOf = (list: TouchList, id: number) => {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
      return null;
    };
    const onReelTouchStart = (e: TouchEvent) => {
      if (!reel) return;
      if (e.touches.length !== 1) {
        // A second finger (a pinch) lets go of the film where it is.
        if (drag?.mode === "film") letGo(drag, 0, 0);
        drag = null;
        return;
      }
      const t = e.touches[0];
      const down = { y: t.clientY, t: e.timeStamp };
      drag = { id: t.identifier, down, x0: t.clientX, y0: t.clientY, s0: 0, heading: null, s: 0, mode: null, trail: [down] };
    };
    const onReelTouchMove = (e: TouchEvent) => {
      const d = drag;
      if (!d || !reel || d.mode === "page") return;
      const t = touchOf(e.touches, d.id);
      if (!t) return;
      if (d.mode === null) {
        // The page scrolls under a finger once it has left the top of the film, and from the
        // last place a swipe up goes on to the projects. Anything else drags the film, so the
        // page must not start to scroll while the finger is still too close to tell.
        const atEnd = reelTo === RESTS.length - 1;
        if (pageOn) {
          d.mode = "page";
          return;
        }
        const dy = d.y0 - t.clientY;
        if (Math.abs(dy) < REEL_SLOP && Math.abs(t.clientX - d.x0) < REEL_SLOP) {
          if (!atEnd && e.cancelable) e.preventDefault();
          return;
        }
        if (atEnd && dy > 0) {
          d.mode = "page";
          return;
        }
        // Caught where it is, the film drags from here. A browser that holds back the first
        // moves (Chrome does, for its own slop) has the rest of them count.
        d.mode = "film";
        d.heading = Math.abs(goal - p) > SNAP ? reelTo : null;
        endFlight();
        d.s0 = d.s = reelPlace(p);
        d.y0 -= Math.sign(dy) * Math.min(Math.abs(dy), REEL_SLOP);
      }
      if (e.cancelable) e.preventDefault();
      const last = RESTS.length - 1;
      const raw = d.s0 + (d.y0 - t.clientY) / (REEL_DRAG * Math.max(1, window.innerHeight));
      d.s = raw < 0 ? -edgePull(-raw) : raw > last ? last + edgePull(raw - last) : raw;
      reelOver = d.s - Math.min(last, Math.max(0, d.s));
      d.trail.push({ y: t.clientY, t: e.timeStamp });
      while (d.trail.length > 2 && e.timeStamp - d.trail[0].t > REEL_TRAIL_MS) d.trail.shift();
      lastScrollAt = performance.now();
      kick();
    };
    const onReelTouchEnd = (e: TouchEvent) => {
      const d = drag;
      if (!d || touchOf(e.touches, d.id)) return;
      drag = null;
      if (d.mode !== "film") return;
      if (e.type !== "touchend") {
        letGo(d, 0, 0);
        return;
      }
      // The finger's speed over its last REEL_TRAIL_MS before it lifted, in px/ms, up the
      // screen positive. A finger that stopped before lifting has none left.
      let v = 0;
      const end = touchOf(e.changedTouches, d.id);
      const y = end ? end.clientY : d.trail[d.trail.length - 1].y;
      d.trail.push({ y, t: e.timeStamp });
      const recent = d.trail.filter((m) => e.timeStamp - m.t <= REEL_TRAIL_MS);
      if (recent.length >= 2) {
        const a = recent[0];
        const b = recent[recent.length - 1];
        v = (a.y - b.y) / Math.max(8, b.t - a.t);
      }
      // A quick swipe flies on its way, even one that slowed as it lifted.
      const moved = d.down.y - y;
      const quick = e.timeStamp - d.down.t < REEL_SWIPE_MS && Math.abs(moved) >= REEL_SWIPE_MIN && moved * v >= 0;
      const way = v >= REEL_FLICK || (quick && moved > 0) ? 1 : v <= -REEL_FLICK || (quick && moved < 0) ? -1 : 0;
      letGo(d, v, way);
    };
    /**
     * A finger lets go of the film at v px/ms, up positive. way: 1 or -1 for a flick or a quick
     * swipe that way, 0 for neither. The film flies on, or back.
     */
    function letGo(d: ReelDrag, v: number, way: number) {
      const last = RESTS.length - 1;
      const s = Math.min(last, Math.max(0, d.s));
      const net = s - d.s0;
      const base = Math.floor(s + 1e-6);
      const f = s - base;
      // The nearest place, leaning the way the drag went.
      let to = net >= 0 ? (f > REEL_COMMIT ? base + 1 : base) : f > 1 - REEL_COMMIT ? base + 1 : base;
      const hd = d.heading === null ? 0 : Math.sign(d.heading - d.s0);
      const heading = d.heading ?? 0;
      if (way > 0) to = Math.max(base + 1, hd > 0 ? heading + 1 : 0);
      else if (way < 0) to = Math.min(Math.ceil(s - 1e-6) - 1, hd < 0 ? heading - 1 : last);
      else if (hd !== 0 && net * hd > -REEL_COMMIT) to = hd > 0 ? Math.max(heading, to) : Math.min(heading, to);
      reelLetGo = { v, s, to };
      unlock();
      reelGo(to);
      goal = reelFilm(reelTo);
      if (!flight) {
        const h = flyable();
        if (h >= 0) startFlight(h);
      }
    }
    // Once the page has scrolled past the top of the reel (out of the last place, into the
    // projects), a swipe on what shows of the film scrolls the page back, rather than flying
    // the film. The reel takes swipes again once it fills the screen.
    const onPageScroll = () => {
      pageOn = reel && wrap.getBoundingClientRect().top < -2;
    };
    // Keys move the reel one place, as a swipe does. Past its first and last places the page
    // scrolls as usual.
    const onKeyReel = (e: KeyboardEvent) => {
      if (!reel || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || pageOn || !filmOnScreen()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const space = e.key === " " || e.key === "Spacebar";
      // Space on a focused link or button presses it.
      if (space && t && /^(A|BUTTON)$/.test(t.tagName)) return;
      const d = e.key === "ArrowDown" || e.key === "PageDown" || (space && !e.shiftKey) ? 1 : e.key === "ArrowUp" || e.key === "PageUp" || (space && e.shiftKey) ? -1 : 0;
      const j = reelTo + d;
      if (!d || j < 0 || j > RESTS.length - 1) return;
      e.preventDefault();
      reelGo(j);
    };
    // A wheel or trackpad on the reel (a mouse plugged into a tablet, say) moves it a place per
    // gesture, as a swipe does. A gesture ends after REEL_WHEEL_IDLE ms without a wheel event,
    // so a trackpad's momentum stays inside the one that started it. From the last place a
    // new gesture down scrolls the page on to the projects.
    let wheelSum = 0;
    let wheelAt = -Infinity;
    let wheelMoved = false;
    const onReelWheel = (e: WheelEvent) => {
      if (!reel || pageOn || e.ctrlKey) return;
      const now = performance.now();
      if (now - wheelAt > REEL_WHEEL_IDLE) {
        wheelSum = 0;
        wheelMoved = false;
      }
      wheelAt = now;
      if (!wheelMoved && e.deltaY > 0 && reelTo === RESTS.length - 1) return;
      if (e.cancelable) e.preventDefault();
      if (wheelMoved) return;
      wheelSum += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (Math.abs(wheelSum) < REEL_WHEEL_STEP) return;
      wheelMoved = true;
      reelGo(reelTo + Math.sign(wheelSum));
    };
    // The reel's own touch and wheel listeners hold the page's scrolling until they have run,
    // so they are only there while the reel is.
    const listenReel = (on: boolean) => {
      const set = on ? wrap.addEventListener.bind(wrap) : wrap.removeEventListener.bind(wrap);
      set("touchstart", onReelTouchStart as EventListener, { passive: true });
      set("touchmove", onReelTouchMove as EventListener, { passive: false });
      set("touchend", onReelTouchEnd as EventListener, { passive: true });
      set("touchcancel", onReelTouchEnd as EventListener, { passive: true });
      set("wheel", onReelWheel as EventListener, { passive: false });
    };
    // A mouse plugged into a tablet, say: the film keeps its place across the switch.
    const onReelChange = () => {
      const place = Math.min(RESTS.length - 1, Math.max(0, Math.round(reelPlace(p))));
      reel = reelQuery.matches;
      listenReel(reel);
      drag = null;
      reelOver = 0;
      if (reel) reelTo = place;
      else requestAnimationFrame(() => window.scrollTo({ top: yOf(landAt(RESTS[place])), behavior: "instant" }));
      onPageScroll();
      snapNext = true;
      kick();
    };
    listenReel(reel);
    window.addEventListener("scroll", onPageScroll, { passive: true });
    window.addEventListener("keydown", onKeyReel);
    reelQuery.addEventListener("change", onReelChange);
    onPageScroll();

    const timersJump: number[] = [];
    // The side map. A neighbouring stop plays its flight. A further one dips to black, moves
    // the film there with the playhead on it, and fades back.
    const jumpTo = (k: number) => {
      if (jumping || disposed) return;
      skipIntro();
      aim = null;
      swipe = null;
      const i = RESTS.indexOf(home);
      const j = RESTS.indexOf(k);
      if (j < 0) return;
      const target = landAt(k);
      // Sends the film to the place: the reel's place, or the page's scroll to its hold.
      const go = () => {
        if (reel) reelGo(j);
        else window.scrollTo({ top: yOf(target), behavior: "instant" });
      };
      if (reduced || Math.abs(j - i) <= 1) {
        go();
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
        go();
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
      if (seg.hop === null) return isPass(seg.stop) ? PASS_SPEED : reel ? REEL_HOLD_SPEED : HOLD_SPEED;
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
        if (!(d > 0 ? g > h && s.start < goal : g < h && s.start + s.len > goal)) continue;
        let joined = true;
        for (let k = Math.min(g, h) + 1; k <= Math.max(g, h); k++) if (!isPass(k)) joined = false;
        if (!joined) further++;
      }
      // A reel flight takes about the same time whatever its clip's length.
      const rate = reel ? Math.min(REEL_RATE_TOP, Math.max(RATE, c.dur / REEL_FLIGHT_SECS)) : RATE;
      return (seg.len / c.dur) * Math.min(RATE_MAX, rate + RATE_STEP * further);
    };

    /**
     * The first clip hop between the playhead and its goal that is not ready to play. Going
     * forward the playhead waits where the clip starts: the first hop's planet rolls into the
     * clip's first frame without it, so a swipe there moves the planet at once.
     */
    const gateAhead = () => {
      let gate: { edge: number; hop: number } | null = null;
      for (const h of CLIP_HOPS) {
        if (!gated(h)) continue;
        const s = HOP_SEG[h];
        const end = s.start + s.len;
        const from = h === 0 ? s.start + LIVE_END * s.len : s.start;
        if (goal > p && p <= from && goal > from) {
          if (!gate || from < gate.edge) gate = { edge: from, hop: h };
        } else if (goal < p && p >= end && goal < end) {
          if (!gate || end > gate.edge) gate = { edge: end, hop: h };
        }
      }
      return gate;
    };

    // Moves the playhead toward its goal for dt seconds, one part of the film at a time,
    // since each part has its own top speed.
    const advance = (dt: number) => {
      const gate = gateAhead();
      let left = dt;
      for (let i = 0; i < 32 && left > 0 && p !== goal; i++) {
        if (gate && p === gate.edge) break;
        const gap = goal - p;
        if (Math.abs(gap) < SNAP) {
          p = gate ? gate.edge : goal;
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
            const cap = z.speed ? z.speed * (reel ? REEL_HANDOVER : 1) : Infinity;
            top = Math.min(top, cap, z.share ? z.share * speedIn(seg, d) : Infinity);
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

    // ---- Unlocking -------------------------------------------------------------------------

    // iOS loads only a video's metadata until it has played, and in low power mode plays a
    // video only from a gesture: a touch that ends, not one that starts. The first gesture
    // plays every clip's video and pauses it at once, which lifts both for good without moving
    // its picture. A video that could not warm up waits for this (warmUp, below).
    const unlocked = new WeakSet<HTMLVideoElement>();
    const unlockWaits = new Map<HTMLVideoElement, () => void>();
    function unlock() {
      for (const c of clips) {
        const el = videoOf(c);
        // A flight's clip is already playing.
        if (!el || unlocked.has(el) || flight?.el === el) continue;
        unlocked.add(el);
        el.play().catch(() => {});
        el.pause();
        const wake = unlockWaits.get(el);
        unlockWaits.delete(el);
        wake?.();
      }
      // A refused flight tries again now the videos can play.
      if (flightBlocked) {
        flightBlocked = false;
        kick();
      }
    }
    const onGesture = () => unlock();
    window.addEventListener("touchend", onGesture, { passive: true });
    window.addEventListener("click", onGesture);
    window.addEventListener("keydown", onGesture);

    // ---- Attaching ------------------------------------------------------------------------

    const waitFor = (el: HTMLVideoElement, type: "loadedmetadata" | "loadeddata" | "seeked", signal: AbortSignal, ms: number) =>
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

    /**
     * Gets a muted video's first frames by playing it until they come, then pausing it: iOS
     * loads only the metadata until a video has played. Refused (low power mode), it waits for
     * the visitor's next gesture to unlock the video (Unlocking, above), then tries again. A
     * play cut short (by that unlock, say) tries again too.
     */
    const warmUp = async (el: HTMLVideoElement, signal: AbortSignal) => {
      for (let tries = 0; el.readyState < 2; tries++) {
        if (signal.aborted) throw new DOMException("released", "AbortError");
        if (tries >= 3) throw new Error("no frames");
        const frames = waitFor(el, "loadeddata", signal, 5000);
        frames.catch(() => {});
        try {
          await el.play();
          if (el.readyState < 2) await frames;
        } catch (err) {
          if (signal.aborted) throw err;
          if ((err as { name?: string } | null)?.name !== "NotAllowedError" || unlocked.has(el)) continue;
          tries--;
          await new Promise<void>((resolve, reject) => {
            const stop = () => reject(new DOMException("released", "AbortError"));
            signal.addEventListener("abort", stop, { once: true });
            unlockWaits.set(el, () => {
              signal.removeEventListener("abort", stop);
              resolve();
            });
          });
        }
      }
      if (flight?.el !== el && !el.paused) el.pause();
    };

    const attach = async (c: Clip) => {
      const el = videoOf(c);
      if (!el || !c.url) return;
      const ac = new AbortController();
      c.attachAbort = ac;
      c.state = "attaching";
      try {
        const loaded = waitFor(el, "loadedmetadata", ac.signal, 15000);
        el.muted = true;
        el.setAttribute("muted", "");
        el.src = c.url;
        await loaded;
        c.dur = Number.isFinite(el.duration) ? el.duration : 0;
        if (!c.dur) throw new Error("no duration");
        // Most browsers load the first frames by themselves; iOS needs the video played.
        if (el.readyState < 2) await waitFor(el, "loadeddata", ac.signal, 150).catch(() => {});
        await warmUp(el, ac.signal);
        const seeked = waitFor(el, "seeked", ac.signal, 1500);
        el.currentTime = targetOf(c);
        await seeked;
        c.attachAbort = null;
        c.state = "ready";
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
      if (flight?.c === c) endFlight();
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

    // ---- Flights ---------------------------------------------------------------------------

    // In the reel, a flight that crosses a clip plays it at speed: the browser decodes it frame
    // after frame and shows each one on time, off the main thread, where a phone seeking frame
    // by frame shows a fraction of them, unevenly. The playhead then follows the video. A
    // flight that ends inside a clip, turns back, or can't play (low power mode, say) seeks.

    /** vh of film per second of a clip hop's clip. */
    const vhPerClipSec = (c: Clip) => ((c.hop === 0 ? 1 - LIVE_END : 1) * HOP_SEG[c.hop].len) / c.dur;
    /** The playhead at a time in a clip. */
    const pAtClipTime = (c: Clip, t: number) => {
      const s = HOP_SEG[c.hop];
      const f = clamp01(t / c.dur);
      return s.start + (c.hop === 0 ? LIVE_END + (1 - LIVE_END) * f : f) * s.len;
    };

    /** The clip hop a flight can play from here to its end, or -1. */
    const flyable = () => {
      if (!reel || reduced || flightBlocked || leaving || jumping || goal <= p) return -1;
      const seg = segToward(p, 1);
      const h = seg.hop;
      if (h === null || !ready(h) || unplayable.has(h)) return -1;
      const c = clipOf[h] as Clip;
      // The flight carries on past the clip's end, and the playhead is inside the clip, past
      // the planet's hand-over on the first one, which is drawn rather than played.
      const from = seg.start + (h === 0 ? LIVE_END * seg.len : 0);
      if (!c.dur || goal < seg.start + seg.len || p < from - 1e-6) return -1;
      return h;
    };

    /** The flight's clip speed, in clip seconds a second: the playhead's top speed, easing as it lands. */
    const flightRate = (c: Clip) => {
      const v = Math.min(speedIn(HOP_SEG[c.hop], 1), Math.abs(goal - p) * FOLLOW);
      return Math.min(8, Math.max(0.25, v / vhPerClipSec(c)));
    };

    const startFlight = (h: number) => {
      const c = clipOf[h] as Clip;
      const el = videoOf(c);
      if (!el || el.seeking) return;
      const f: Flight = { c, el, lastT: el.currentTime, still: 0 };
      flight = f;
      el.playbackRate = flightRate(c);
      const played = el.play();
      if (played)
        played.catch((err: unknown) => {
          // Refused (low power mode, say): seek this flight, and try again after the next
          // touch. A play cut short by the flight's own end needs nothing.
          if ((err as { name?: string } | null)?.name !== "NotAllowedError") return;
          if (flight === f) flight = null;
          flightBlocked = true;
          kick();
        });
    };

    function endFlight() {
      const f = flight;
      if (!f) return;
      flight = null;
      if (!f.el.paused) f.el.pause();
      f.el.playbackRate = 1;
    }

    /** Moves the playhead with the flight's video for a frame of dt seconds. False once it is over. */
    const stepFlight = (dt: number) => {
      const f = flight as Flight;
      const { c, el } = f;
      if (flyable() !== c.hop) {
        endFlight();
        return false;
      }
      const t = el.currentTime;
      if (t > f.lastT + 1e-4) {
        f.lastT = t;
        f.still = 0;
      } else if ((f.still += dt) > FLIGHT_STUCK_MS / 1000) {
        // Not moving on (or never started): this clip seeks from here on.
        unplayable.add(c.hop);
        endFlight();
        return false;
      }
      const at = pAtClipTime(c, t);
      if (at > p) p = at;
      if (el.ended || t >= c.dur - END_GUARD) {
        p = Math.max(p, HOP_SEG[c.hop].start + HOP_SEG[c.hop].len);
        endFlight();
        return false;
      }
      const rate = flightRate(c);
      if (Math.abs(rate - el.playbackRate) > 0.06 * rate) el.playbackRate = rate;
      return true;
    };

    // ---- Fetching -------------------------------------------------------------------------

    let fetching: Clip | null = null;

    // Each stop's cinemagraph loop is fetched in the same line as the clips, placed at its
    // stop's hold: after the clip that flies in, before the one that flies on. Arriving
    // before it is in, the loop plays straight from the network instead ("direct").
    type LoopFile = { k: number; state: "idle" | "loading" | "fetched" | "direct" | "failed"; url: string | null; abort: AbortController | null };
    const loopFiles: LoopFile[] = motionAllowed()
      ? STOPS.flatMap((s, k): LoopFile[] => {
          if (!s.loop) return [];
          // Fetched on an earlier showing of the film in this page load: already in memory.
          const url = keptLoop(s.loop) ?? null;
          return [{ k, state: url ? "fetched" : "idle", url, abort: null }];
        })
      : [];
    let loopFetching = false;

    /** Next clip to fetch: the one at the playhead, then those ahead of it, then behind. */
    const pickNext = () => {
      let best: Clip | LoopFile | null = null;
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
      for (const l of loopFiles) {
        if (l.state !== "idle") continue;
        const h = HOLD_SEG[l.k];
        const end = h.start + h.len;
        let score: number;
        if (p >= h.start && p <= end) score = -0.5;
        else {
          const gapAhead = dir > 0 ? h.start - p : p - end;
          score = gapAhead >= 0 ? gapAhead : 1e6 - gapAhead;
        }
        if (score < bestScore) {
          best = l;
          bestScore = score;
        }
      }
      return best;
    };

    const pump = () => {
      if (fetching || loopFetching || disposed || videoOff()) return;
      // The intro's planet gets the line first, briefly, unless the film is already waiting.
      if (intro.phase === "waiting" && waitHop === null && performance.now() - intro.mount < EARTH_FIRST_MS) return;
      const next = pickNext();
      if (!next) return;
      if ("hop" in next) void fetchClip(next);
      else void fetchLoop(next);
    };

    const fetchLoop = async (l: LoopFile) => {
      loopFetching = true;
      const ac = new AbortController();
      l.abort = ac;
      l.state = "loading";
      try {
        const file = loopFile(STOPS[l.k].loop as Loop, tier === "high" ? "hd" : "m");
        // Still downloading from an earlier showing of the film: wait for it.
        const running = loopDownloads.get(file);
        if (running) await running;
        let url = keptFile(file);
        if (!url) {
          let finish = () => {};
          loopDownloads.set(file, new Promise<void>((r) => (finish = r)));
          try {
            const res = await fetch(file, { signal: ac.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            url = URL.createObjectURL(new Blob([blob], { type: "video/mp4" }));
            // Kept past this film, for the project page and for the film's next showing.
            keepLoop(file, url);
          } finally {
            loopDownloads.delete(file);
            finish();
          }
        }
        l.url = url;
        l.state = "fetched";
      } catch {
        // An aborted fetch goes back in the line; a failed one plays from the network.
        l.state = ac.signal.aborted ? "idle" : "failed";
      } finally {
        l.abort = null;
        loopFetching = false;
      }
      if (disposed) return;
      pump();
      kick();
    };

    /**
     * Fetches one clip file whole into the store (keptClips), listed in clipDownloads while it
     * runs so a later showing can wait on it. It carries on if the film unmounts. With probe,
     * it measures the link two seconds in and stops ("slow") if the file would take too long.
     */
    const download = async (
      c: Clip,
      ac: AbortController,
      probe: boolean,
    ): Promise<{ url: string } | { status: number } | { slow: true }> => {
      const file = c.file;
      let finish = () => {};
      const dl: Download = { done: new Promise<void>((r) => (finish = r)), received: 0, total: 0 };
      clipDownloads.set(file, dl);
      try {
        const res = await fetch(filmUrl(file), { signal: ac.signal });
        if (!res.ok) {
          void res.body?.cancel().catch(() => {});
          return { status: res.status };
        }
        c.total = dl.total = Number(res.headers.get("content-length")) || 0;
        const chunks: BlobPart[] = [];
        const reader = res.body?.getReader();
        if (!reader) chunks.push(await res.blob());
        else {
          let first = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            c.received += value.byteLength;
            dl.received = c.received;
            const now = performance.now();
            if (!first) first = now;
            else if (probe && !tierFixed && now - first >= PROBE_MS) {
              // Project the whole download from the rate so far.
              tierFixed = true;
              const secs = ((c.total || PROBE_GUESS) * (now - first)) / 1000 / c.received;
              if (secs > PROBE_MAX_SECS) {
                void reader.cancel().catch(() => {});
                ac.abort();
                return { slow: true };
              }
              keptTier = tier;
            }
            if (waitHop === c.hop) kick();
          }
        }
        const url = URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
        keptClips.set(file, url);
        return { url };
      } finally {
        if (clipDownloads.get(file) === dl) clipDownloads.delete(file);
        finish();
      }
    };

    const fetchClip = async (c: Clip) => {
      fetching = c;
      let t: Tier = tier;
      try {
        for (;;) {
          // A tier another showing measured while this one waited.
          if (keptTier !== null && !tierFixed) {
            tier = keptTier;
            tierFixed = true;
            if (tier === "low") t = "low";
          }
          // The page's own files already show a slow link: skip the big file's test, which
          // costs seconds there (lib/netRate.ts).
          if (t === "high" && !tierFixed && measuredSlow()) {
            tier = "low";
            keptTier = "low";
            tierFixed = true;
            t = "low";
          }
          const ac = new AbortController();
          c.fetchAbort = ac;
          c.state = "loading";
          c.file = clipFile(c.name, parts[t]);
          c.received = 0;
          c.total = 0;
          // Fetched, or still downloading, on an earlier showing of the film.
          const kept = keptClips.get(c.file);
          if (kept) {
            c.fetchAbort = null;
            c.url = kept;
            c.state = "fetched";
            break;
          }
          const running = clipDownloads.get(c.file);
          if (running) {
            while (clipDownloads.get(c.file) === running) {
              if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
              c.received = running.received;
              c.total = running.total;
              if (waitHop === c.hop) kick();
              await Promise.race([running.done, sleep(120)]);
            }
            // Done: take it from the store. Failed: fetch it here.
            continue;
          }
          const probe = t === "high" && !tierFixed;
          const got = await download(c, ac, probe);
          if ("status" in got) {
            // A missing high-tier file falls back to the low tier for this clip only.
            if (t === "high") {
              t = "low";
              continue;
            }
            throw new Error(`HTTP ${got.status}`);
          }
          if ("slow" in got) {
            tier = "low";
            keptTier = "low";
            t = "low";
            continue;
          }
          // A first fetch that finished inside the probe window keeps the high tier.
          if (probe) {
            tierFixed = true;
            keptTier = tier;
          }
          c.fetchAbort = null;
          c.url = got.url;
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
    /** The picture's push-in as last drawn, for the hand-off to a project page. */
    let lastScale = 1;
    /** A project link was clicked and the page is changing. */
    let leaving = false;
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
      lastScale = s.scale + breath;
      const scale = `scale(${lastScale.toFixed(4)})`;
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

      const introIn = introCaption(now);
      const c = s.caption * introIn;
      put(captionRef.current, "opacity", c.toFixed(3));
      // In the reel the words ride the film: a place's words sit as far from their spot as the
      // film is from their place, a drag's length per place, so they leave with the finger and
      // the next place's come up from below as the film lands.
      const k = reel ? RESTS.indexOf(s.stop) : -1;
      const lift = k >= 0 ? (k - reelPlace(p) - reelOver) * REEL_DRAG * window.innerHeight + (1 - introIn) * 12 : (1 - c) * 12;
      put(captionRef.current, "transform", `translateY(${lift.toFixed(1)}px)`);
      put(captionRef.current, "visibility", c > 0.01 ? "visible" : "hidden");
      if (s.stop !== lastStop) {
        lastStop = s.stop;
        setStop(s.stop);
      }

      // The scroll cue shows once the intro lets go, until the visitor first scrolls, and again
      // whenever the film has rested a while on a stop with more to come. In the reel the last
      // place has more too: a swipe there goes on to the projects.
      if (intro.cue && x > 0.5) intro.cue = false;
      const more = restIn(p) >= 0 && (reel ? !pageOn : restIn(p) !== LAST);
      const resting = !intro.holding && p === goal && waitHop === null && more && !dragging();
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

    // ---- Moving still -----------------------------------------------------------------------

    const canvas = movingRef.current;
    let moving: MovingStill | null = null;
    let movingOff = !canvas || !motionAllowed();
    const fade = new MotionFade();
    let mMix = 0;
    let mLastDraw = 0;
    const mStart = performance.now();
    /** The stop the canvas is drawing, kept through its fade-out. */
    let mShown: { k: number; a: Source; b: Source | null; motion: Motion } | null = null;

    /** The two layers a stop's hold blends, as compose() picks them: arrival, then departure. */
    const holdLayers = (k: number) => {
      const kindH = (h: number) => kindOf(HOP_LIST[h]);
      const isClip = (h: number) => h >= 0 && h < LAST && kindH(h) === "video";
      const startOf = (h: number) => (ready(h) ? `video-${h}` : `first-${h}`);
      const endOf = (h: number) => (ready(h) ? `video-${h}` : `last-${h}`);
      const a = k > 0 && kindH(k - 1) === "wipe" ? `stop-${k}` : isClip(k - 1) ? endOf(k - 1) : isClip(k) ? startOf(k) : `stop-${k}`;
      const b = k < LAST && kindH(k) === "wipe" ? `stop-${k}` : isClip(k) ? startOf(k) : isClip(k - 1) ? endOf(k - 1) : `stop-${k}`;
      return { a, b: b === a ? null : b };
    };
    /** What a layer shows, as something the canvas can draw: a video's frame, or a still. */
    const sourceOf = (key: string): Source => {
      const [kind, n] = key.split("-") as [string, string];
      const i = Number(n);
      if (kind === "video") {
        const c = clipOf[i] as Clip;
        const el = videoOf(c);
        if (el) return { key: `${key}@${Math.round(targetOf(c) * 1000)}`, video: el };
        return clipFile(c.name, targetOf(c) > 0 ? "last.webp" : "first.webp");
      }
      if (kind === "last") return clipFile(HOP_LIST[i].clip as string, "last.webp");
      if (kind === "first") return clipFile(HOP_LIST[i].clip as string, "first.webp");
      return STOPS[i].still;
    };
    const keyOf = (s: Source | null) => (s === null ? "" : typeof s === "string" ? s : s.key);

    // The canvas's context and shader are made in a quiet moment ahead of the first stop that
    // moves, so landing there doesn't stop to compile them (10 to 40 ms on a phone).
    let warmIdle = 0;
    const warmMoving = () => {
      warmIdle = 0;
      if (moving || movingOff || reduced || !canvas) return;
      moving = new MovingStill(canvas);
      if (!moving.ok) movingOff = true;
    };
    const warmTimer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") warmIdle = window.requestIdleCallback(warmMoving, { timeout: 4000 });
      else warmMoving();
    }, MOVING_WARM_MS);

    /** Draws the moving still for this frame. True while it needs more frames. */
    const drawMoving = (now: number, dt: number) => {
      if (!canvas) return false;
      const seg = locate(p);
      const k = seg.hop === null && seg.stop > 0 && !isPass(seg.stop) ? seg.stop : -1;
      const motion = k > 0 ? STOPS[k].motion : undefined;
      let want = false;
      if (!movingOff && !fade.off && !reduced && !jumping && motion) {
        if (!moving) {
          moving = new MovingStill(canvas);
          if (!moving.ok) movingOff = true;
        }
        if (moving?.live) {
          const l = holdLayers(k);
          const a = sourceOf(l.a);
          const b = l.b ? sourceOf(l.b) : null;
          // A new stop waits until the last one has faded out. On the same stop, a layer that
          // switches from a still to its video switches here too.
          const free = !mShown || mShown.k === k || fade.opacity === 0;
          if (free && moving.prepare(a, b, motion.map)) {
            if (!mShown || mShown.k !== k || keyOf(mShown.a) !== keyOf(a) || keyOf(mShown.b) !== keyOf(b)) {
              mShown = { k, a, b, motion };
              moving.keepOnly(b ? [a, b, motion.map] : [a, motion.map]);
            }
            want = true;
          } else if (mShown?.k === k && fade.opacity > 0) want = true;
        } else movingOff = true;
      }
      if (want && mShown) {
        const u = clamp01((p - HOLD_SEG[k].start) / HOLD_SEG[k].len);
        mMix = ease(clamp01((u - 0.25) / 0.5));
      }

      const was = fade.opacity;
      if (mShown) fade.quick = motionShown.has(mShown.motion.map);
      fade.step(dt, want, p === goal && waitHop === null && !leaving && !dragging());
      if (mShown && fade.opacity >= 1 && fade.amp >= 1) motionShown.add(mShown.motion.map);
      if (fade.drawNow && moving && mShown && (was === 0 || now - mLastDraw >= MOVE_DRAW_MS)) {
        const drawn = moving.draw({
          a: mShown.a,
          b: mShown.b,
          map: mShown.motion.map,
          mix: mMix,
          amp: fade.strength,
          time: (now - mStart) / 1000,
          motion: mShown.motion,
        });
        if (drawn) mLastDraw = now;
      }
      put(canvas, "opacity", fade.opacity.toFixed(3));
      put(canvas, "visibility", fade.opacity > 0 ? "visible" : "hidden");
      return want || fade.opacity > 0;
    };

    // ---- Cinemagraph loops ----------------------------------------------------------------

    // Like the moving still: the picture first, then the loop fades in once it plays and the
    // machine has kept up, and it fades out the moment the film moves on.
    const loopFade = new MotionFade();
    let loopOff = !motionAllowed();
    /** The stop whose loop is showing or fading out, or -1. */
    let lShown = -1;
    let lStarting = false;
    let lPlaying = false;
    /** Seconds the film has rested on the loop's stop; it fades in after LOOP_SETTLE. */
    let lRest = 0;
    const loopEl = (k: number) => (k >= 0 ? (loopRefs.current[k] ?? null) : null);
    const pauseLoop = () => {
      const el = loopEl(lShown);
      if (el && !el.paused) el.pause();
      lPlaying = false;
    };

    /** Plays and fades the resting stop's loop. True while it needs more frames. */
    const stepLoop = (dt: number) => {
      const seg = locate(p);
      const k = seg.hop === null && seg.stop > 0 && !isPass(seg.stop) ? seg.stop : -1;
      const target = k > 0 && STOPS[k].loop && !loopOff && !loopFade.off && !reduced && !jumping ? k : -1;
      // A new stop's loop waits until the last one has faded out.
      if (lShown !== target && loopFade.opacity === 0) {
        pauseLoop();
        lShown = target;
      }
      const el = loopEl(lShown);
      const loop = lShown >= 0 ? STOPS[lShown].loop : undefined;
      if (!el || !loop) return false;
      const wanted = lShown === target && inView && !document.hidden;
      const file = loopFiles.find((f) => f.k === lShown);
      // Still coming down the line: wait for it rather than fetch it twice.
      const waiting = file?.state === "loading";
      if (wanted && file?.state === "idle") file.state = "direct";
      const steady = p === goal && waitHop === null && !leaving && !dragging();
      const again = motionShown.has(loop.src);
      loopFade.quick = again;
      lRest = wanted && steady ? lRest + dt : wanted && loopFade.opacity > 0 ? lRest : 0;
      if (wanted && !lPlaying && !lStarting && !waiting) {
        lStarting = true;
        const src = file?.url ?? loopFile(loop, tier === "high" ? "hd" : "m");
        void startLoop(el, src, loopFade.opacity === 0 && !again, loop.rate).then((r) => {
          lStarting = false;
          if (r === "playing") lPlaying = true;
          else if (r === "blocked") loopOff = true;
          kick();
        });
      }
      if (el.error) loopOff = true;
      // It shows only once its frames are coming. Once showing it stays: at each restart Chrome
      // drops readyState for a moment (to 1 on the preview), and a stall only holds a frame.
      const flowing = el.readyState >= 3 || loopFade.opacity > 0;
      const want = wanted && lPlaying && flowing && lRest >= (again ? LOOP_SETTLE_AGAIN : LOOP_SETTLE);
      loopFade.step(dt, want, steady);
      if (loopFade.opacity >= 1) motionShown.add(loop.src);
      put(el, "opacity", loopFade.opacity.toFixed(3));
      put(el, "visibility", loopFade.opacity > 0 ? "visible" : "hidden");
      if (!wanted && loopFade.opacity === 0 && (lPlaying || !el.paused)) pauseLoop();
      return wanted || loopFade.opacity > 0;
    };

    // A link to a project records what the film shows: the push-in, and the loop or moving
    // still if one shows at full strength, so the project's hero carries them on.
    handOffRef.current = () => {
      // The page is about to change: slow frames from here on are the new page loading, so
      // they no longer count against the machine.
      leaving = true;
      // A page that never changes (a failed load, say) leaves the film working as before.
      timers.push(window.setTimeout(() => (leaving = false), 5000));
      const h: Handoff = { scale: lastScale, at: performance.now() };
      const el = loopEl(lShown);
      const loop = lShown >= 0 ? STOPS[lShown].loop : undefined;
      if (el && loop && lPlaying && loopFade.opacity >= 0.99 && el.currentSrc) {
        h.loop = { src: loop.src, url: el.currentSrc, time: el.currentTime };
      }
      if (mShown && fade.opacity >= 0.99) h.motion = { map: mShown.motion.map, time: (performance.now() - mStart) / 1000 };
      setHandoff(h);
    };

    // ---- Loop -----------------------------------------------------------------------------

    let raf = 0;
    let inView = true;
    let prev = performance.now();
    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.1, Math.max(0, now - prev) / 1000);
      prev = now;
      if (reel) {
        // Under a finger, the place the drag has taken the film to; otherwise the place it
        // rests on or flies to.
        x = reelFilm(dragging() ? (drag as ReelDrag).s : reelTo);
        reelKept = reelTo;
        // A pull past the first or last place springs back once the finger lets go.
        if (reelOver && !dragging()) {
          reelOver *= Math.exp(-REEL_SPRING * dt);
          if (Math.abs(reelOver) < 1e-4) reelOver = 0;
        }
      } else {
        const rect = wrap.getBoundingClientRect();
        const span = Math.max(1, rect.height - window.innerHeight);
        x = clamp01(-rect.top / span) * TOTAL;
      }
      goal = gateOn() ? (aim ?? destination(x, way)) : x;

      const waited = waitHop;
      // Nobody sees the playhead catch up on the first frame, with reduced motion, or off screen.
      if (!started || reduced || !inView || snapNext) {
        endFlight();
        p = x;
        waitHop = null;
        started = true;
        snapNext = false;
        // Wherever the playhead was put, the gate starts from there.
        if (!jumping) home = restBefore(p);
        settling = -1;
      } else if (dragging()) {
        // Under a finger the film is wherever the finger has taken it, at once.
        p = goal;
        waitHop = null;
      } else if (!(flight && stepFlight(dt))) advance(dt);
      // A flight across a clip plays it from the frame the playhead reaches it (Flights, above).
      if (!flight) {
        const h = flyable();
        if (h >= 0) startFlight(h);
      }
      // A swipe in the reel can fly before the intro has finished: its words stop coming in as
      // the film leaves, and once they are out of sight the intro is over, so every place after
      // shows its words as usual.
      if (intro.phase === "waiting" || intro.phase === "playing") {
        if (introLeft < 0 && p > HOLD_SEG[0].start + HOLD_SEG[0].len) introLeft = introCaption(now);
        if (p > HOP_SEG[0].start + CAPTION_FADE) {
          intro.phase = "done";
          intro.released ||= now;
          intro.cue = false;
        }
      }
      if (goal !== p) dir = goal > p ? 1 : -1;
      if (waitHop !== null && waitHop !== waited) waitSince = now;

      manage();
      pump();

      let busy = p !== goal || waitHop !== null || reelOver !== 0;

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
        // A flight's clip plays on its own.
        if (c.state !== "ready" || flight?.c === c) continue;
        const el = videoOf(c);
        if (!el) continue;
        const target = targetOf(c);
        if (!el.seeking && Math.abs(el.currentTime - target) > SEEK_EPS) el.currentTime = target;
        if (el.seeking) busy = true;
      }

      for (const s of STILLS) {
        if (!painted.has(s.key) && (!s.clip || !reduced) && distance(p, s.from, s.to) <= STILL_NEAR) paintStill(s.key);
      }

      const shot = compose(p, ready, reduced, reel);
      lastShot = shot;
      apply(shot, now);
      if (drawMoving(now, dt)) busy = true;
      if (stepLoop(dt)) busy = true;
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
      if (reduced) {
        fetching?.fetchAbort?.abort();
        for (const l of loopFiles) l.abort?.abort();
      }
      kick();
    };
    reduceQuery.addEventListener("change", onReduce);

    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (!inView) pauseLoop();
      // One frame either way: off screen it lands the playhead on the scroll.
      kick(true);
    });
    const onHidden = () => {
      if (document.hidden) pauseLoop();
    };
    document.addEventListener("visibilitychange", onHidden);
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
        get goal() {
          return goal;
        },
        get tier() {
          return tier;
        },
        get home() {
          return home;
        },
        get aim() {
          return aim;
        },
        get reel() {
          return { on: reel, to: reelTo, at: reelPlace(p), over: reelOver, drag: drag && { mode: drag.mode, s: drag.s, s0: drag.s0, heading: drag.heading, trail: drag.trail.length }, letGo: reelLetGo, pageOn };
        },
        get flight() {
          return flight ? { hop: flight.c.hop, rate: flight.el.playbackRate, t: flight.el.currentTime } : null;
        },
        get unplayable() {
          return [...unplayable];
        },
        jump: (k: number) => jumpTo(k),
        get waiting() {
          return waitHop;
        },
        get shot() {
          return lastShot;
        },
        get loop() {
          return { opacity: loopFade.opacity, stop: lShown, playing: lPlaying, off: loopOff || loopFade.off, t: loopEl(lShown)?.currentTime ?? null, files: loopFiles.map((f) => `${f.k}:${f.state}`).join(" ") };
        },
        get moving() {
          return { opacity: fade.opacity, amp: fade.amp, probing: fade.probing, mix: mMix, off: movingOff || fade.off, stop: mShown?.k ?? null, avgMs: fade.frameMs };
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
      document.removeEventListener("visibilitychange", onHidden);
      pauseLoop();
      window.removeEventListener("scroll", onScrollGate);
      window.removeEventListener("scroll", onKick);
      window.removeEventListener("resize", onKick);
      timersJump.forEach((t) => clearTimeout(t));
      jumpRef.current = null;
      window.removeEventListener("touchend", onGesture);
      window.removeEventListener("click", onGesture);
      window.removeEventListener("keydown", onGesture);
      listenReel(false);
      window.removeEventListener("scroll", onPageScroll);
      window.removeEventListener("keydown", onKeyReel);
      reelQuery.removeEventListener("change", onReelChange);
      endFlight();
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(warmTimer);
      if (warmIdle) window.cancelIdleCallback(warmIdle);
      (moving as MovingStill | null)?.dispose();
      // A download still running finishes into the store for the film's next showing, and
      // every file fetched stays there (keptClips, and FilmLoop.tsx for the loops).
      for (const c of clips) {
        if (c.state === "attaching" || c.state === "ready") detach(c);
        c.url = null;
      }
      for (const l of loopFiles) {
        const el = loopRefs.current[l.k];
        if (el && l.url && el.src === l.url) el.removeAttribute("src");
        l.url = null;
      }
      handOffRef.current = null;
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

  // Once the film rests on a stop, the pictures of the projects it opens load quietly, so a
  // project page opens on a picture already in memory.
  useEffect(() => {
    const s = STOPS[stop];
    const hrefs = [s.link?.href, ...(s.spots ?? []).map((x) => x.href)];
    const t = window.setTimeout(() => {
      for (const href of hrefs) {
        const src = href ? frames[href] : undefined;
        if (!src) continue;
        // The picture, and the map its moving still uses on the project page.
        for (const file of [src, motionForFrame(src)?.map]) {
          if (!file || framesAsked.has(file)) continue;
          framesAsked.add(file);
          void loadPicture(file).catch(() => undefined);
        }
      }
    }, FRAMES_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [stop, frames]);

  /** A plain click on a project link hands the film's picture on; one opening a new tab doesn't. */
  const handOff = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    handOffRef.current?.();
  };

  const here = STOPS[stop];
  const spots = STOPS[spotStop].spots ?? [];

  // --film-h: the film's scroll length on a desktop. The reel is one screen tall
  // (FilmScroll.module.css).
  const size = { "--film-h": `${TOTAL + 100}vh` } as CSSProperties;

  return (
    <div className={styles.film} data-film ref={wrapRef} style={size}>
      <div className={styles.track}>
      <div ref={screenRef} className={styles.screen}>
        {/* The picture, the planet and the rings. */}
        <div className={styles.stage}>
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
          {STOPS.map((s, i) =>
            s.loop ? (
              <FilmLoop
                key={`loop-${i}`}
                loop={s.loop}
                className={styles.loop}
                videoRef={(el) => {
                  loopRefs.current[i] = el;
                }}
              />
            ) : null,
          )}
          <canvas ref={movingRef} className={styles.moving} aria-hidden="true" />
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
                onClick={handOff}
              >
                <span className={styles.ring} aria-hidden="true" />
                <span className={styles.leader} aria-hidden="true" />
                <span className={styles.spotLabel}>{s.label}</span>
              </TransitionLink>
            ))}
          </div>
        </div>
        </div>

        <div ref={captionRef} className={styles.caption}>
          <p className={styles.place}>{here.place}</p>
          <p className={styles.text}>{here.text}</p>
          {here.link ? (
            <div className={styles.links}>
              <TransitionLink className={styles.open} href={here.link.href} onClick={handOff}>
                {here.link.label}
              </TransitionLink>
            </div>
          ) : null}
        </div>

        <div ref={cueRef} className={styles.cue} aria-hidden="true">
          <span className={styles.cueScroll}>
            Scroll<span className={styles.cueMore}> to fly on</span>
          </span>
          <span className={styles.cueSwipe}>Swipe up</span>
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
    </div>
  );
}
