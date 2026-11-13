"use client";

import { useRef } from "react";
import ScrollBreakdown, {
  BreakdownCanvas,
  type BreakdownApi,
  type BreakdownStep,
  type SceneFactory,
} from "@/components/breakdown/ScrollBreakdown";
import type { Callout } from "@/components/breakdown/kit";
import type { AlltusDom, CalloutKey, NoteKey } from "./alltusScene";
import styles from "./AlltusBreakdown.module.css";

const STEPS: BreakdownStep[] = [
  {
    id: "call",
    title: "A resident calls the county office",
    body: (
      <p>
        County offices hear the same questions all day: when is the protest deadline, and did my
        exemption go through? A lot of them arrive by phone, from someone at home who just wants
        the answer.
      </p>
    ),
  },
  {
    id: "routing",
    title: "Call routing hands it to an agent",
    body: (
      <p>
        I built the call routing that picks up the office&rsquo;s line and passes each call to a
        voice agent. The agents run in parallel, so when several residents call at once, each of
        them gets an agent of their own.
      </p>
    ),
  },
  {
    id: "decide",
    title: "Working out what’s being asked",
    body: (
      <p>
        The agent turns what the caller says into text and works out the question. Then it looks
        for the answer in the jurisdiction&rsquo;s own material: its knowledge base, its records
        data and an FAQ bank mined from past conversations. A deadline question sends it to the
        knowledge base and the FAQ bank, while an exemption question means looking up the
        caller&rsquo;s property record as well.
      </p>
    ),
  },
  {
    id: "answer",
    title: "The answer, out loud",
    body: (
      <p>
        It writes a reply from what it found and speaks it on the same call. When a link would
        help, like the one for filing a protest, the agent offers to text it and sends it while the
        caller is still on the line.
      </p>
    ),
  },
  {
    id: "scale",
    title: "One county, then many",
    body: (
      <p>
        The deployments I work on take more than 100,000 calls a year, and Alltus&rsquo;s site
        counts more than 300 governments in over 30 states. I&rsquo;m also the engineer on
        launches, so I run kickoff, set up the phone lines and make the test calls before go-live.
      </p>
    ),
  },
];

const CALLOUTS: { key: CalloutKey; text: string }[] = [
  { key: "resident", text: "Resident" },
  { key: "office", text: "County office" },
  { key: "router", text: "Call routing" },
  { key: "rack", text: "Voice agents" },
  { key: "kb", text: "Knowledge base" },
  { key: "records", text: "Records data" },
  { key: "faq", text: "FAQ bank" },
  { key: "answer", text: "Spoken answer" },
  { key: "text", text: "Link sent by text" },
  { key: "deploy", text: "100,000+ calls a year" },
];

const NOTES: { key: NoteKey; text: string; quote?: boolean; stat?: boolean }[] = [
  { key: "ask", text: "“When is the protest deadline?”", quote: true },
  { key: "askA", text: "“When is the protest deadline?”", quote: true },
  { key: "askB", text: "“Did my exemption go through?”", quote: true },
  { key: "govs", text: "300+ governments in 30+ states", stat: true },
];

type Refs = {
  lines: Partial<Record<CalloutKey, SVGLineElement>>;
  dots: Partial<Record<CalloutKey, SVGCircleElement>>;
  tags: Partial<Record<CalloutKey, HTMLSpanElement>>;
  notes: Partial<Record<NoteKey, HTMLSpanElement>>;
  waves: (SVGPathElement | null)[];
};

function collect(r: Refs): AlltusDom {
  const need = <E,>(el: E | undefined | null, name: string): E => {
    if (!el) throw new Error(`Alltus overlay is missing ${name}`);
    return el;
  };
  const callouts = {} as Record<CalloutKey, Callout>;
  for (const { key } of CALLOUTS)
    callouts[key] = { el: need(r.tags[key], key), line: need(r.lines[key], key), dot: r.dots[key] ?? null };
  const notes = {} as Record<NoteKey, HTMLElement>;
  for (const { key } of NOTES) notes[key] = need(r.notes[key], key);
  return { callouts, notes, waves: r.waves.map((w, i) => need(w, `wave ${i}`)) };
}

function Visual({ api }: { api: BreakdownApi }) {
  const refs = useRef<Refs>({ lines: {}, dots: {}, tags: {}, notes: {}, waves: [null, null, null] });
  const r = refs.current;

  const load = async (): Promise<SceneFactory> => {
    const mod = await import("./alltusScene");
    return (T, ctx) => mod.createAlltusBreakdown(T, ctx, collect(refs.current));
  };

  return (
    <BreakdownCanvas api={api} load={load} fallback="The 3D drawing of the phone line needs WebGL." className={styles.host}>
      <svg className={styles.overlay} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <path
            key={i}
            className={styles.wave}
            ref={(el) => {
              r.waves[i] = el;
            }}
          />
        ))}
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
          className={`${styles.note} ${n.quote ? styles.quote : ""} ${n.stat ? styles.stat : ""}`}
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

/** Alltus's scroll breakdown: one county's phone line on the left, the five steps on the right. */
export default function AlltusBreakdown({ className }: { className?: string }) {
  return (
    <ScrollBreakdown
      className={className}
      label="How a call to the county is answered"
      steps={STEPS}
      visual={(api) => <Visual api={api} />}
      caption="A simplified drawing of one county's phone line, with a made-up caller. Drag it to turn it."
    />
  );
}
