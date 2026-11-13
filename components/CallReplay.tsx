"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./CallReplay.module.css";

/*
  A sample call, replayed. Everything is driven by one clock (`t`, in seconds):
  the waveform, the words, the timer and the trace all read from it, so they
  can't drift apart. The canvas and the trace bars are written straight to the
  DOM every frame. React state only changes when a discrete value changes
  (a new word, a new second, a new exchange).
*/

type Step = {
  label: string;
  /** Position on the trace axis, 0 to 1. */
  x0: number;
  x1: number;
  phase: "listen" | "work" | "write" | "speak";
};

type Exchange = {
  caller: { text: string; start: number; end: number };
  agent: { text: string; start: number; end: number };
  steps: Step[];
};

const steps = (lookups: string[]): Step[] => [
  { label: "Transcribe", x0: 0, x1: 0.3, phase: "listen" },
  ...lookups.map((label, i) => ({
    label,
    x0: 0.3,
    x1: i === 0 ? 0.52 : 0.47,
    phase: "work" as const,
  })),
  { label: "Write answer", x0: 0.52, x1: 0.66, phase: "write" },
  { label: "Speak", x0: 0.66, x1: 1, phase: "speak" },
];

const CALL: Exchange[] = [
  {
    caller: {
      text: "Hi, I got my appraisal notice and the value looks too high. How do I protest it?",
      start: 0.8,
      end: 6.0,
    },
    agent: {
      text: "You can file a protest online or by mail. The deadline is May 15, or 30 days after your notice was mailed, whichever is later.",
      start: 7.3,
      end: 15.0,
    },
    steps: steps(["Search knowledge base", "Check FAQ bank"]),
  },
  {
    caller: {
      text: "Okay. And did my homestead exemption go through?",
      start: 15.9,
      end: 19.3,
    },
    agent: {
      text: "It did. Your homestead exemption is on file for this year. Want me to text you the protest link?",
      start: 20.6,
      end: 26.4,
    },
    steps: steps(["Look up property record", "Search knowledge base"]),
  },
  {
    caller: { text: "Yes please.", start: 27.1, end: 28.2 },
    agent: {
      text: "Sent. Is there anything else I can help with?",
      start: 29.2,
      end: 32.2,
    },
    steps: steps(["Send text message"]),
  },
];

const END = 33.2;
const LOOP = END + 2.6;

const WORDS = CALL.map((ex) => ({
  caller: ex.caller.text.split(" "),
  agent: ex.agent.text.split(" "),
}));

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

function exchangeAt(t: number) {
  let i = 0;
  for (let k = 0; k < CALL.length; k++) if (t >= CALL[k].caller.start - 0.5) i = k;
  return i;
}

/** How many words of a line have been said at time t. Longer words take longer. */
function spoken(words: string[], start: number, end: number, t: number) {
  if (t <= start) return 0;
  if (t >= end) return words.length;
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  const target = ((t - start) / (end - start)) * total;
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    acc += words[i].length + 1;
    if (acc > target) return i + 1;
  }
  return words.length;
}

function stepProgress(ex: Exchange, step: Step, t: number) {
  const gap0 = ex.caller.end;
  const gap1 = ex.agent.start;
  const g = gap1 - gap0;
  switch (step.phase) {
    case "listen":
      return span(t, ex.caller.start, ex.caller.end + 0.1);
    case "work":
      return span(t, gap0 + 0.1, gap0 + g * (step.x1 > 0.5 ? 0.7 : 0.55));
    case "write":
      return span(t, gap0 + g * 0.6, gap1 + 0.4);
    case "speak":
      return span(t, ex.agent.start, ex.agent.end);
  }
}

/* ---------- waveform ---------- */

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const noise = (x: number, seed: number) => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i + seed * 57.3) * (1 - u) + hash(i + 1 + seed * 57.3) * u;
};

/** Loudness of one speaker at time t, 0 to 1. Shaped like speech: syllables, short gaps. */
function loudness(who: 0 | 1, t: number) {
  for (let k = 0; k < CALL.length; k++) {
    const line = who === 0 ? CALL[k].caller : CALL[k].agent;
    if (t < line.start || t > line.end) continue;
    const seed = k * 2 + who + 1;
    const edge = Math.min(1, (t - line.start) / 0.18, (line.end - t) / 0.22);
    const syllable = Math.pow(Math.abs(Math.sin(t * 9.4 + seed * 1.7)), 0.7);
    const breath = noise(t * 1.6, seed + 20) < 0.16 ? 0.12 : 1;
    const body = 0.3 + 0.7 * noise(t * 7.3, seed);
    return Math.max(0.06, edge * breath * (0.25 + 0.75 * syllable) * body);
  }
  return 0;
}

const INK = "#000000";
const INK_AHEAD = "#dcdde1";
const AGENT = "#2540f5";
const AGENT_AHEAD = "#d3d9fd";

function draw(canvas: HTMLCanvasElement, t: number, now: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pitch = w < 560 ? 4 : 5;
  const bar = pitch - 2;
  const count = Math.floor(w / pitch);
  const lane = h / 2;
  const maxH = lane - 10;
  const headX = (Math.min(t, END) / END) * w;

  for (let who = 0 as 0 | 1; who < 2; who = (who + 1) as 0 | 1) {
    const mid = lane * who + lane / 2;
    for (let i = 0; i < count; i++) {
      const x = i * pitch;
      const bt = ((i + 0.5) / count) * END;
      let a = loudness(who, bt);
      const played = bt <= t;
      // The few bars just behind the playhead keep moving, like a live meter.
      if (played && t - bt < 0.35 && a > 0) {
        a *= 0.82 + 0.3 * Math.abs(Math.sin(now * 0.016 + i * 1.9));
      }
      const bh = a > 0 ? Math.max(2, a * maxH) : 2;
      ctx.fillStyle =
        who === 0 ? (played ? INK : INK_AHEAD) : played ? AGENT : AGENT_AHEAD;
      if (a === 0) ctx.fillStyle = played ? "#c9cbd1" : "#ececef";
      ctx.beginPath();
      ctx.roundRect(x, mid - bh / 2, bar, bh, bar / 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = INK;
  ctx.fillRect(Math.round(headX), 0, 1, h);
}

/* ---------- component ---------- */

function Clock({ seconds }: { seconds: number }) {
  const s = Math.max(0, Math.floor(seconds));
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  // Fixed-width digits, so the timer doesn't jitter as it counts.
  return (
    <span className={styles.clock} aria-hidden="true">
      {text.split("").map((c, i) => (
        <span key={i} className={c === ":" ? styles.colon : styles.digit}>
          {c}
        </span>
      ))}
    </span>
  );
}

export default function CallReplay() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const tRef = useRef(0);
  const visibleRef = useRef(true);

  const [playing, setPlaying] = useState(true);
  const [second, setSecond] = useState(0);
  const [index, setIndex] = useState(0);
  const [said, setSaid] = useState<[number, number]>([0, 0]);

  const sync = useCallback((now: number) => {
    const t = tRef.current;
    const i = exchangeAt(t);
    const ex = CALL[i];
    if (canvasRef.current) draw(canvasRef.current, t, now);
    ex.steps.forEach((step, k) => {
      const el = barsRef.current[k];
      if (el) el.style.transform = `scaleX(${stepProgress(ex, step, t).toFixed(3)})`;
    });
    setIndex((prev) => (prev === i ? prev : i));
    const sec = Math.floor(Math.min(t, END));
    setSecond((prev) => (prev === sec ? prev : sec));
    const c = spoken(WORDS[i].caller, ex.caller.start, ex.caller.end, t);
    const a = spoken(WORDS[i].agent, ex.agent.start, ex.agent.end, t);
    setSaid((prev) => (prev[0] === c && prev[1] === a ? prev : [c, a]));
  }, []);

  // Start paused for people who ask for less motion. They can still press Play.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      tRef.current = CALL[0].agent.end;
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      // Cap the step so a background tab doesn't jump the call forward.
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (playing && visibleRef.current) {
        tRef.current += dt;
        if (tRef.current >= LOOP) tRef.current = 0;
        sync(now);
      }
      raf = requestAnimationFrame(frame);
    };
    sync(last);
    raf = requestAnimationFrame(frame);
    const onResize = () => sync(performance.now());
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [playing, sync]);

  const ex = CALL[index];
  const words = WORDS[index];

  return (
    <figure className={styles.panel} ref={wrapRef} aria-label="A sample call, replayed">
      <div className={styles.head}>
        <span className={styles.live} data-on={playing} aria-hidden="true" />
        <span className={styles.what}>Sample call, replayed</span>
        <span className={styles.where}>Property tax office line</span>
        <Clock seconds={second} />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause the replay" : "Play the replay"}
        >
          {playing ? "Pause" : "Play"}
        </button>
      </div>

      <div className={styles.wave} aria-hidden="true">
        <div className={styles.lanes}>
          <span>Caller</span>
          <span className={styles.agentName}>Agent</span>
        </div>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>

      <div className={styles.lower}>
        <div className={styles.lines} aria-hidden="true">
          <p className={styles.line}>
            <span className={styles.who}>Caller</span>
            <span className={styles.text}>
              {words.caller.map((w, i) => (
                <span key={`${index}c${i}`} data-said={i < said[0]}>
                  {w}{" "}
                </span>
              ))}
            </span>
          </p>
          <p className={styles.line}>
            <span className={`${styles.who} ${styles.agentName}`}>Agent</span>
            <span className={`${styles.text} ${styles.agentText}`}>
              {words.agent.map((w, i) => (
                <span key={`${index}a${i}`} data-said={i < said[1]}>
                  {w}{" "}
                </span>
              ))}
            </span>
          </p>
        </div>

        <div className={styles.trace} aria-hidden="true">
          <p className={styles.traceTitle}>What the agent is doing</p>
          <ul>
            {ex.steps.map((step, k) => (
              <li key={`${index}-${step.label}`}>
                <span className={styles.stepName}>{step.label}</span>
                <span className={styles.track}>
                  <span
                    className={styles.slot}
                    style={{
                      left: `${step.x0 * 100}%`,
                      width: `${(step.x1 - step.x0) * 100}%`,
                    }}
                  >
                    <span
                      className={styles.fill}
                      ref={(el) => {
                        barsRef.current[k] = el;
                      }}
                    />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <ol className="sr">
        {CALL.map((c, i) => (
          <li key={i}>
            Caller: {c.caller.text} Agent: {c.agent.text}
          </li>
        ))}
      </ol>
    </figure>
  );
}
