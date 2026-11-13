"use client";

import { useRef } from "react";
import ScrollBreakdown, {
  BreakdownCanvas,
  type BreakdownApi,
  type BreakdownStep,
  type SceneFactory,
} from "@/components/breakdown/ScrollBreakdown";
import type { Callout } from "@/components/breakdown/kit";
import type { CalloutKey, CrimsonDom } from "./crimsonleadScene";
import styles from "./CrimsonleadBreakdown.module.css";

const STEPS: BreakdownStep[] = [
  {
    id: "records",
    title: "This morning’s records",
    body: (
      <p>
        I built Crimsonlead to read 25 public sources every morning and pick out the records that
        are new since the day before. They&rsquo;re things like a new trucking authority, a federal
        bid for HVAC work, a building permit, a fundraising notice or a mining claim, and each pin
        on this map stands for one of them.
      </p>
    ),
  },
  {
    id: "filter",
    title: "Most are turned away",
    body: (
      <p>
        Plenty of new records shouldn&rsquo;t become leads at all, so a filter goes through them
        first. It drops government bodies and private individuals, along with anything whose
        contact details are bad or belong to a registered agent. For every record it drops, the
        filter keeps the reason, so I can look back at what was turned away and why.
      </p>
    ),
  },
  {
    id: "grade",
    title: "A grade for each",
    body: (
      <p>
        Every record that gets through is graded A, B or C against a rubric written for its
        source, because a strong building permit and a strong mining claim have little in common.
        On the map, an A pin stands tallest and a C pin shortest.
      </p>
    ),
  },
  {
    id: "match",
    title: "A match",
    body: (
      <p>
        Then each lead is matched to the kind of company that sells what the record shows is now
        needed. A new trucking authority means a new carrier that will need insurance, so this one
        is paired with a trucking insurer. There are eight desks, and each is built for one kind of
        buyer like that.
      </p>
    ),
  },
  {
    id: "send",
    title: "A person sends it",
    body: (
      <p>
        Last, the site drafts a first message for the lead. Nothing goes out until a person has
        read that draft and sent it themselves.
      </p>
    ),
  },
];

const CALLOUTS: { key: CalloutKey; text: string; reason?: boolean }[] = [
  { key: "mining", text: "Mining claim" },
  { key: "raise", text: "Fundraising notice" },
  { key: "trucking", text: "New trucking authority" },
  { key: "permit", text: "Building permit" },
  { key: "hvac", text: "Federal HVAC bid" },
  { key: "gov", text: "Government body", reason: true },
  { key: "individual", text: "Private individual", reason: true },
  { key: "agent", text: "Registered agent only", reason: true },
  { key: "contact", text: "No usable contact", reason: true },
  { key: "gradeA", text: "Grade A" },
  { key: "gradeB", text: "Grade B" },
  { key: "gradeC", text: "Grade C" },
  { key: "record", text: "New trucking authority" },
  { key: "buyer", text: "Trucking insurer" },
  { key: "draft", text: "Drafted first message" },
  { key: "sender", text: "A person reads and sends it" },
];

type Refs = {
  lines: Partial<Record<CalloutKey, SVGLineElement>>;
  dots: Partial<Record<CalloutKey, SVGCircleElement>>;
  tags: Partial<Record<CalloutKey, HTMLSpanElement>>;
};

function collect(r: Refs): CrimsonDom {
  const need = <E,>(el: E | undefined | null, name: string): E => {
    if (!el) throw new Error(`Crimsonlead overlay is missing ${name}`);
    return el;
  };
  const callouts = {} as Record<CalloutKey, Callout>;
  for (const { key } of CALLOUTS)
    callouts[key] = { el: need(r.tags[key], key), line: need(r.lines[key], key), dot: r.dots[key] ?? null };
  return { callouts };
}

function Visual({ api }: { api: BreakdownApi }) {
  const refs = useRef<Refs>({ lines: {}, dots: {}, tags: {} });
  const r = refs.current;

  const load = async (): Promise<SceneFactory> => {
    const [mod, seg, geo, mat] = await Promise.all([
      import("./crimsonleadScene"),
      import("three/examples/jsm/lines/LineSegments2.js"),
      import("three/examples/jsm/lines/LineSegmentsGeometry.js"),
      import("three/examples/jsm/lines/LineMaterial.js"),
    ]);
    const fat = { LineSegments2: seg.LineSegments2, LineSegmentsGeometry: geo.LineSegmentsGeometry, LineMaterial: mat.LineMaterial };
    return (T, ctx) => mod.createCrimsonleadBreakdown(T, ctx, collect(refs.current), fat);
  };

  return (
    <BreakdownCanvas api={api} load={load} fallback="The 3D map of the records needs WebGL." className={styles.host}>
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
          className={c.reason ? `${styles.tag} ${styles.reason}` : styles.tag}
          aria-hidden="true"
          ref={(el) => {
            if (el) r.tags[c.key] = el;
          }}
        >
          {c.text}
        </span>
      ))}
    </BreakdownCanvas>
  );
}

/** Crimsonlead's scroll breakdown: one morning's records on a map of the US, followed to one message. */
export default function CrimsonleadBreakdown({ className }: { className?: string }) {
  return (
    <ScrollBreakdown
      className={className ? `${styles.root} ${className}` : styles.root}
      label="How a public record becomes a lead"
      steps={STEPS}
      visual={(api) => <Visual api={api} />}
      caption="A simplified map with made-up records. Drag it to turn it."
    />
  );
}
