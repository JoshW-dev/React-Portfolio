"use client";

import { useRef } from "react";
import ScrollBreakdown, {
  BreakdownCanvas,
  type BreakdownApi,
  type BreakdownStep,
  type SceneFactory,
} from "@/components/breakdown/ScrollBreakdown";
import type { BottleneckDom, NoteKey, Pin, TagKey } from "./bottleneckScene";
import styles from "./BottleneckBreakdown.module.css";

const STEPS: BreakdownStep[] = [
  {
    id: "money",
    title: "What the cloud companies spend",
    body: (
      <p>
        Once a month the pipeline reads how much Microsoft, Amazon, Alphabet, Meta and Oracle paid
        for property and equipment, taken straight from their SEC filings. That spending covers more
        than AI data centers, so the next step only counts the share that goes into them.
      </p>
    ),
  },
  {
    id: "hardware",
    title: "Turning dollars into hardware",
    body: (
      <p>
        Code turns that share into the physical things it buys: gigawatts of power, GPUs,
        high-bandwidth memory and gas turbines. The conversion factors all sit in one config file,
        each with its source or a flag saying it still needs one, so when a factor turns out wrong I
        change one number and run it again.
      </p>
    ),
  },
  {
    id: "supply",
    title: "Where each part comes from",
    body: (
      <p>
        Then it reads one supply figure for each input: Korea&rsquo;s memory chip exports,
        Taiwan&rsquo;s export orders, the backlogs at three gas turbine makers, and the queue of
        large new loads waiting to connect to the Texas grid. Taiwan&rsquo;s orders stand in for
        leading-edge chips because there&rsquo;s no direct supply series for them yet. A few of these
        figures only come out in PDFs, so I enter those by hand and the memo flags any that are more
        than 120 days old.
      </p>
    ),
  },
  {
    id: "arcs",
    title: "Arcs to the data centers",
    body: (
      <p>
        On the dashboard, a globe draws arcs from where each part is made to two big US data center
        markets, Texas and Northern Virginia. Claude Sonnet ranks the four inputs by how tight they
        are, which here means demand growing faster than supply can add capacity, and the tightest one
        becomes that month&rsquo;s bottleneck.
      </p>
    ),
  },
  {
    id: "call",
    title: "One call, and what would prove it wrong",
    body: (
      <p>
        The call names one input, and the companies it lists behind that input can only come from a
        fixed list I keep. It also has to write down what would prove it wrong, which is a figure in
        next month&rsquo;s data and the line that figure would have to cross. Each call is made once
        and goes out with its test. Next month&rsquo;s run reads it back before making its own.
      </p>
    ),
  },
];

const TAGS: { key: TagKey; text: string; agent?: boolean }[] = [
  { key: "amazon", text: "Amazon" },
  { key: "alphabet", text: "Alphabet" },
  { key: "microsoft", text: "Microsoft" },
  { key: "meta", text: "Meta" },
  { key: "oracle", text: "Oracle" },
  { key: "power", text: "Gigawatts" },
  { key: "gpus", text: "GPUs" },
  { key: "hbm", text: "HBM" },
  { key: "turbines", text: "Gas turbines" },
  { key: "korea", text: "Memory exports" },
  { key: "taiwan", text: "Export orders" },
  { key: "takasago", text: "Turbine backlog" },
  { key: "berlin", text: "Turbine backlog" },
  { key: "greenville", text: "Turbine backlog" },
  { key: "queue", text: "Grid queue" },
  { key: "texas", text: "Texas" },
  { key: "virginia", text: "N. Virginia" },
  { key: "tightest", text: "Tightest input", agent: true },
  { key: "call", text: "The call", agent: true },
  { key: "next", text: "Next month" },
  { key: "line", text: "Proves it wrong" },
];

const NOTES: { key: NoteKey; text: string }[] = [{ key: "capex", text: "Capex, last four quarters" }];

type Refs = {
  rim?: SVGCircleElement;
  threshold?: SVGPathElement;
  lines: Partial<Record<TagKey, SVGLineElement>>;
  dots: Partial<Record<TagKey, SVGCircleElement>>;
  tags: Partial<Record<TagKey, HTMLSpanElement>>;
  notes: Partial<Record<NoteKey, HTMLSpanElement>>;
};

function collect(r: Refs): BottleneckDom {
  const need = <E,>(el: E | undefined | null, name: string): E => {
    if (!el) throw new Error(`Bottleneck overlay is missing ${name}`);
    return el;
  };
  const tags = {} as Record<TagKey, Pin>;
  for (const { key } of TAGS) tags[key] = { el: need(r.tags[key], key), line: need(r.lines[key], key), dot: need(r.dots[key], key) };
  const notes = {} as Record<NoteKey, HTMLElement>;
  for (const { key } of NOTES) notes[key] = need(r.notes[key], key);
  return { rim: need(r.rim, "rim"), threshold: need(r.threshold, "threshold"), tags, notes };
}

function Visual({ api }: { api: BreakdownApi }) {
  const refs = useRef<Refs>({ lines: {}, dots: {}, tags: {}, notes: {} });
  const r = refs.current;

  const load = async (): Promise<SceneFactory> => {
    const [mod, land, seg, geo, mat] = await Promise.all([
      import("./bottleneckScene"),
      // Without the land mask the globe still works, as a plain sphere.
      import("./land").then((m) => m.loadLandDots()).catch(() => new Float32Array(0)),
      import("three/examples/jsm/lines/LineSegments2.js"),
      import("three/examples/jsm/lines/LineSegmentsGeometry.js"),
      import("three/examples/jsm/lines/LineMaterial.js"),
    ]);
    const fat = { LineSegments2: seg.LineSegments2, LineSegmentsGeometry: geo.LineSegmentsGeometry, LineMaterial: mat.LineMaterial };
    return (T, ctx) => mod.createBottleneckScene(T, ctx, collect(refs.current), fat, land);
  };

  return (
    <BreakdownCanvas api={api} load={load} fallback="The 3D globe needs WebGL." className={styles.host}>
      {/* The globe's rim, behind the canvas, so parts standing in front of it cover it. */}
      <svg className={styles.back} aria-hidden="true">
        <circle
          className={styles.rim}
          ref={(el) => {
            if (el) r.rim = el;
          }}
        />
      </svg>
      <svg className={styles.overlay} aria-hidden="true">
        <path
          className={styles.threshold}
          ref={(el) => {
            if (el) r.threshold = el;
          }}
        />
        {TAGS.map((t) => (
          <g key={t.key} className={styles.leader}>
            <line
              ref={(el) => {
                if (el) r.lines[t.key] = el;
              }}
            />
            <circle
              r={2.5}
              ref={(el) => {
                if (el) r.dots[t.key] = el;
              }}
            />
          </g>
        ))}
      </svg>
      {TAGS.map((t) => (
        <span
          key={t.key}
          className={t.agent ? `${styles.tag} ${styles.tagAgent}` : styles.tag}
          aria-hidden="true"
          ref={(el) => {
            if (el) r.tags[t.key] = el;
          }}
        >
          {t.text}
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
    </BreakdownCanvas>
  );
}

/** Bottleneck Radar's scroll breakdown: the globe on the left, the five steps on the right. */
export default function BottleneckBreakdown({ className }: { className?: string }) {
  return (
    <ScrollBreakdown
      className={className}
      label="How Bottleneck Radar turns capex into a monthly call on the tightest input"
      steps={STEPS}
      visual={(api) => <Visual api={api} />}
      caption="A simplified globe drawn for this page. The call in blue is an example, since the real one changes every month. Drag the globe to turn it."
    />
  );
}
