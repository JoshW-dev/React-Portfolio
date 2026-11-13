"use client";

import { useRef } from "react";
import ScrollBreakdown, {
  BreakdownCanvas,
  type BreakdownApi,
  type BreakdownStep,
  type SceneFactory,
} from "@/components/breakdown/ScrollBreakdown";
import type { CalloutKey, HydrogenDom, NoteKey, Pin } from "./hydrogenScene";
import styles from "./HydrogenBreakdown.module.css";

const STEPS: BreakdownStep[] = [
  {
    id: "purpose",
    title: "Natural gas in, hydrogen out",
    body: (
      <p>
        The plant takes in natural gas and sends out hydrogen, more than 300,000 tonnes of it a
        year. Hydrogen gives off only water when it burns, so it can cut emissions wherever
        it&rsquo;s used, as long as the carbon that came in with the gas doesn&rsquo;t end up in
        the air.
      </p>
    ),
  },
  {
    id: "chemistry",
    title: "How blue hydrogen is made",
    body: (
      <p>
        Natural gas is mostly methane. In the reformer it reacts with steam at well over
        800&nbsp;&deg;C and splits into hydrogen and carbon monoxide, then a second reaction with
        more steam turns the carbon monoxide into CO<sub>2</sub> and more hydrogen. A plant without
        capture sends that CO<sub>2</sub> up a stack.
      </p>
    ),
  },
  {
    id: "capture",
    title: "Catching the carbon",
    body: (
      <p>
        This plant is designed to capture over 90% of the emissions it generates. The CO<sub>2</sub>{" "}
        is separated out, compressed and piped deep underground into rock that holds it.
        Hydrogen made from natural gas with its carbon captured this way is called blue hydrogen.
      </p>
    ),
  },
  {
    id: "sessions",
    title: "Tightening the scope",
    body: (
      <p>
        A plant this size comes down to thousands of scope decisions, and each one carries cost. I
        led the design working sessions where the team found ways to tighten that scope and
        developed them into the design, which cut more than $300M from the capital budget. The
        drawing on the left only illustrates the idea of less to build for the same output, so it
        doesn&rsquo;t show what changed or where.
      </p>
    ),
  },
  {
    id: "result",
    title: "Same hydrogen, $300M less",
    body: (
      <p>
        The design still produces more than 300,000 tonnes of clean hydrogen a year and still
        captures over 90% of the emissions it generates. It needs more than $300M less capital to
        build.
      </p>
    ),
  },
];

const CALLOUTS: { key: CalloutKey; text: string }[] = [
  { key: "gas", text: "Natural gas in" },
  { key: "h2", text: "Hydrogen out, 300,000+ t a year" },
  { key: "reformer", text: "Reformer" },
  { key: "capture", text: "Carbon capture" },
  { key: "co2", text: "90%+ of emissions captured" },
  { key: "budget", text: "Capital budget" },
];

const NOTES: { key: NoteKey; text: string; agent?: boolean }[] = [
  { key: "formula", text: "CH₄ + 2H₂O → 4H₂ + CO₂" },
  { key: "air", text: "CO₂ to the air" },
  { key: "stored", text: "Stored deep underground" },
  { key: "cut", text: "−$300M+", agent: true },
];

type Refs = {
  lines: Partial<Record<CalloutKey, SVGLineElement>>;
  dots: Partial<Record<CalloutKey, SVGCircleElement>>;
  tags: Partial<Record<CalloutKey, HTMLSpanElement>>;
  notes: Partial<Record<NoteKey, HTMLSpanElement>>;
};

function collect(r: Refs): HydrogenDom {
  const need = <E,>(el: E | undefined | null, name: string): E => {
    if (!el) throw new Error(`Hydrogen overlay is missing ${name}`);
    return el;
  };
  const callouts = {} as Record<CalloutKey, Pin>;
  for (const { key } of CALLOUTS)
    callouts[key] = { el: need(r.tags[key], key), line: need(r.lines[key], key), dot: need(r.dots[key], key) };
  const notes = {} as Record<NoteKey, HTMLElement>;
  for (const { key } of NOTES) notes[key] = need(r.notes[key], key);
  return { callouts, notes };
}

function Visual({ api }: { api: BreakdownApi }) {
  const refs = useRef<Refs>({ lines: {}, dots: {}, tags: {}, notes: {} });
  const r = refs.current;

  const load = async (): Promise<SceneFactory> => {
    const mod = await import("./hydrogenScene");
    return (T, ctx) => mod.createHydrogenScene(T, ctx, collect(refs.current));
  };

  return (
    <BreakdownCanvas api={api} load={load} fallback="The 3D drawing of the plant needs WebGL." className={styles.host}>
      <svg className={styles.overlay} aria-hidden="true">
        {CALLOUTS.map((c) => (
          <g key={c.key} className={styles.leader}>
            <line
              ref={(el) => {
                if (el) r.lines[c.key] = el;
              }}
            />
            <circle
              r={2.5}
              ref={(el) => {
                if (el) r.dots[c.key] = el;
              }}
            />
          </g>
        ))}
      </svg>
      {CALLOUTS.map((c) => (
        <span
          key={c.key}
          className={styles.tag}
          aria-hidden="true"
          ref={(el) => {
            if (el) r.tags[c.key] = el;
          }}
        >
          {c.text}
        </span>
      ))}
      {NOTES.map((n) => (
        <span
          key={n.key}
          className={n.agent ? `${styles.note} ${styles.noteAgent}` : styles.note}
          aria-hidden="true"
          ref={(el) => {
            if (el) r.notes[n.key] = el;
          }}
        >
          {n.text}
        </span>
      ))}
    </BreakdownCanvas>
  );
}

/** The hydrogen plant's scroll breakdown: the plant on the left, the five steps on the right. */
export default function HydrogenBreakdown({ className }: { className?: string }) {
  return (
    <ScrollBreakdown
      className={className}
      label="How the hydrogen plant works and what the design sessions changed"
      steps={STEPS}
      visual={(api) => <Visual api={api} />}
      caption="A simplified drawing made for this page. It isn't the real plant's layout, and the budget bar isn't to scale. Drag it to turn it."
    />
  );
}
