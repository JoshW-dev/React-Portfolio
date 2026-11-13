"use client";

import { useRef } from "react";
import ScrollBreakdown, {
  BreakdownCanvas,
  type BreakdownApi,
  type BreakdownStep,
  type SceneFactory,
} from "@/components/breakdown/ScrollBreakdown";
import type { Callout } from "@/components/breakdown/kit";
import type { CalloutKey, DiscoDom, NoteKey } from "./discoScene";
import styles from "./DiscoBreakdown.module.css";

const STEPS: BreakdownStep[] = [
  {
    id: "describe",
    title: "A course starts as a description",
    body: (
      <p>
        Disco is a Canadian ed-tech startup whose learning platform has more than 300,000
        learners, and I spent almost three years there as an AI growth engineer. The biggest
        piece of that work was AI curriculum generation, where an organization describes the
        course it wants and the build starts from that description.
      </p>
    ),
  },
  {
    id: "canvas",
    title: "The course fills in on a canvas",
    body: (
      <p>
        RAG pipelines and agent flows draft the modules and lessons onto a canvas step by step,
        and the person building the course approves each stage before the next one starts. They
        can pull any lesson out and rewrite it, so the edit stays in their hands. Enterprise
        deals picked up after it shipped.
      </p>
    ),
  },
  {
    id: "parallel",
    title: "Faster with the steps side by side",
    body: (
      <p>
        Disco&rsquo;s chat agent was slow because each of its steps waited for the one before
        it to finish. I ran them in parallel, which cut response times by 75% and cost by 58%,
        and the answers got better too.
      </p>
    ),
  },
  {
    id: "research",
    title: "One question reaches every system",
    body: (
      <p>
        For the sales and marketing teams I set up deep research in Claude and connected it to
        the CRM and the other systems they depended on. A question about an account now draws
        on all of them at once.
      </p>
    ),
  },
  {
    id: "unattended",
    title: "It keeps running on its own",
    body: (
      <p>
        The same stack, built on Claude, Make.com and custom MCP integrations, handles lead
        enrichment, buyer-intent alerts and outbound sequencing across more than 80,000
        contacts. A payment recovery pipeline runs alongside it with nobody touching it, and it
        brings back tens of thousands of dollars a month in late payments.
      </p>
    ),
  },
];

const CALLOUTS: { key: CalloutKey; text: string }[] = [
  { key: "card", text: "Course description" },
  { key: "canvas", text: "Empty canvas" },
  { key: "agents", text: "Agents" },
  { key: "approve", text: "Each stage approved" },
  { key: "edit", text: "Rewritten by hand" },
  { key: "serial", text: "One after another" },
  { key: "parallel", text: "All at once" },
  { key: "question", text: "A question about an account" },
  { key: "contacts", text: "80,000+ contacts" },
  { key: "coins", text: "Late payments recovered" },
];

const NOTES: { key: NoteKey; text: string }[] = [
  { key: "hub", text: "Claude" },
  { key: "crm", text: "CRM" },
];

type Refs = {
  ticks: (SVGPathElement | null)[];
  spokes: (SVGPathElement | null)[];
  heads: (SVGCircleElement | null)[];
  ask: SVGPathElement | null;
  orbit: SVGPathElement | null;
  stats: HTMLDivElement | null;
  timeFill: HTMLSpanElement | null;
  costFill: HTMLSpanElement | null;
  timeNote: HTMLSpanElement | null;
  costNote: HTMLSpanElement | null;
  lines: Partial<Record<CalloutKey, SVGLineElement>>;
  dots: Partial<Record<CalloutKey, SVGCircleElement>>;
  tags: Partial<Record<CalloutKey, HTMLSpanElement>>;
  notes: Partial<Record<NoteKey, HTMLSpanElement>>;
};

const SPOKES = 6;

function collect(r: Refs): DiscoDom {
  const need = <E,>(el: E | undefined | null, name: string): E => {
    if (!el) throw new Error(`Disco overlay is missing ${name}`);
    return el;
  };
  const callouts = {} as Record<CalloutKey, Callout>;
  for (const { key } of CALLOUTS)
    callouts[key] = { el: need(r.tags[key], key), line: need(r.lines[key], key), dot: r.dots[key] ?? null };
  const notes = {} as Record<NoteKey, HTMLElement>;
  for (const { key } of NOTES) notes[key] = need(r.notes[key], key);
  return {
    callouts,
    notes,
    ticks: r.ticks.map((t, i) => need(t, `tick ${i}`)),
    spokes: r.spokes.map((s, i) => need(s, `spoke ${i}`)),
    heads: r.heads.map((h, i) => need(h, `head ${i}`)),
    ask: need(r.ask, "ask"),
    orbit: need(r.orbit, "orbit"),
    stats: need(r.stats, "stats"),
    timeFill: need(r.timeFill, "timeFill"),
    costFill: need(r.costFill, "costFill"),
    timeNote: need(r.timeNote, "timeNote"),
    costNote: need(r.costNote, "costNote"),
  };
}

function Visual({ api }: { api: BreakdownApi }) {
  const refs = useRef<Refs>({
    ticks: [null, null, null, null],
    spokes: Array(SPOKES).fill(null),
    heads: Array(SPOKES).fill(null),
    ask: null,
    orbit: null,
    stats: null,
    timeFill: null,
    costFill: null,
    timeNote: null,
    costNote: null,
    lines: {},
    dots: {},
    tags: {},
    notes: {},
  });
  const r = refs.current;

  const load = async (): Promise<SceneFactory> => {
    const mod = await import("./discoScene");
    return (T, ctx) => mod.createDiscoScene(T, ctx, collect(refs.current));
  };

  return (
    <BreakdownCanvas api={api} load={load} fallback="The 3D drawing needs WebGL." className={styles.host}>
      <svg className={styles.overlay} aria-hidden="true">
        {r.ticks.map((_, i) => (
          <path
            key={i}
            d="M -5 0 L -1.5 3.5 L 5.5 -4.5"
            className={styles.tick}
            ref={(el) => {
              r.ticks[i] = el;
            }}
          />
        ))}
        <path
          className={styles.ask}
          ref={(el) => {
            r.ask = el;
          }}
        />
        {r.spokes.map((_, i) => (
          <g key={i} className={styles.spoke}>
            <path
              ref={(el) => {
                r.spokes[i] = el;
              }}
            />
            <circle
              r={3}
              ref={(el) => {
                r.heads[i] = el;
              }}
            />
          </g>
        ))}
        <path
          className={styles.orbit}
          ref={(el) => {
            r.orbit = el;
          }}
        />
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
          className={styles.note}
          aria-hidden="true"
          ref={(el) => {
            if (el) r.notes[n.key] = el;
          }}
        >
          {n.text}
        </span>
      ))}
      <div
        className={styles.stats}
        aria-hidden="true"
        ref={(el) => {
          r.stats = el;
        }}
      >
        <span className={styles.statLabel}>Response time</span>
        <span className={styles.track}>
          <span
            className={styles.fill}
            ref={(el) => {
              r.timeFill = el;
            }}
          />
        </span>
        <span
          className={styles.statValue}
          ref={(el) => {
            r.timeNote = el;
          }}
        >
          75% less
        </span>
        <span className={styles.statLabel}>Cost</span>
        <span className={styles.track}>
          <span
            className={styles.fill}
            ref={(el) => {
              r.costFill = el;
            }}
          />
        </span>
        <span
          className={styles.statValue}
          ref={(el) => {
            r.costNote = el;
          }}
        >
          58% less
        </span>
      </div>
    </BreakdownCanvas>
  );
}

/** Disco's scroll breakdown: a model of the course builder and the sales systems, five steps. */
export default function DiscoBreakdown({ className }: { className?: string }) {
  return (
    <ScrollBreakdown
      className={className}
      label="How the course builder and the sales systems work"
      steps={STEPS}
      visual={(api) => <Visual api={api} />}
      caption="A simplified drawing of how the pieces fit together. Drag it to turn it."
    />
  );
}
