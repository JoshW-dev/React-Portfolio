"use client";

import ScrollBreakdown, {
  BreakdownCanvas,
  type BreakdownApi,
  type BreakdownStep,
  type SceneFactory,
} from "@/components/breakdown/ScrollBreakdown";
import styles from "./LinesBreakdown.module.css";

const STEPS: BreakdownStep[] = [
  {
    id: "chain",
    title: "A line is a chain",
    body: (
      <p>
        I led an improvement team on two production lines, one in Texas and one in California.
        Each machine on a line feeds the next, so when one stops, product backs up behind it and
        every machine after it runs out of work. The whole line loses that time, which is what
        downtime means.
      </p>
    ),
  },
  {
    id: "find",
    title: "Finding where the time goes",
    body: (
      <p>
        Before fixing anything, you need to know which stops cost the most. Log every stop by
        machine and the time rarely spreads evenly, because one spot usually loses far more than
        the rest. That spot is the bottleneck, and a fix there pays back first.
      </p>
    ),
  },
  {
    id: "machine",
    title: "A mechanical fix at the worst spot",
    body: (
      <p>
        Some of our fixes were mechanical changes to the lines themselves. A change at the
        bottleneck helps the whole line, since every machine after it gets a steady feed again.
        The part swapped in this drawing is a stand-in for the real ones.
      </p>
    ),
  },
  {
    id: "routine",
    title: "A written way to run the line",
    body: (
      <p>
        The other half of the fix was written standard procedures for the crews who ran the lines.
        A standard procedure puts the steps on paper, so every crew runs the line and restarts it
        after a stop the same way.
      </p>
    ),
  },
  {
    id: "result",
    title: "35% less downtime on both lines",
    body: (
      <p>
        In 8 weeks we cut downtime on both lines by 35%, in Texas and in California. That&rsquo;s
        time each line now spends making product, and it came from the machine changes and the
        written procedures together.
      </p>
    ),
  },
];

const TAGS = [
  { key: "stopped", text: "Stopped" },
  { key: "bottleneck", text: "Bottleneck" },
  { key: "change", text: "Mechanical change" },
  { key: "texas", text: "Texas" },
  { key: "california", text: "California" },
] as const;

const NOTES = [
  { key: "backup", text: "Backed up", tone: "muted" },
  { key: "dry", text: "Running dry", tone: "muted" },
  { key: "stopTime", text: "Stop time", tone: "muted" },
  { key: "cutA", text: "−35%", tone: "blue" },
  { key: "cutB", text: "−35%", tone: "blue" },
] as const;

function Visual({ api }: { api: BreakdownApi }) {
  const load = async (): Promise<SceneFactory> => {
    const mod = await import("./linesScene");
    return (T, ctx) => mod.createLinesScene(T, ctx);
  };

  return (
    <BreakdownCanvas api={api} load={load} fallback="The 3D drawing of the line needs WebGL." className={styles.host}>
      <svg className={styles.overlay} aria-hidden="true">
        <path data-dim="backup" className={styles.dim} />
        <path data-dim="dry" className={styles.dim} />
        {[...TAGS.map((t) => t.key), "card"].map((key) => (
          <g key={key} className={styles.leader}>
            <line data-line={key} />
            <circle r={2.5} data-dot={key} />
          </g>
        ))}
      </svg>
      {TAGS.map((t) => (
        <span key={t.key} data-tag={t.key} className={styles.tag} aria-hidden="true">
          {t.text}
        </span>
      ))}
      {NOTES.map((n) => (
        <span
          key={n.key}
          data-note={n.key}
          className={n.tone === "blue" ? `${styles.note} ${styles.cut}` : styles.note}
          aria-hidden="true"
        >
          {n.text}
        </span>
      ))}
      <div data-k="card" className={styles.card} aria-hidden="true">
        <span className={styles.cardTitle}>Restart</span>
        <ul>
          {[72, 88, 60].map((w, i) => (
            <li key={i} data-row="">
              <i />
              <b style={{ width: `${w}%` }} />
            </li>
          ))}
        </ul>
      </div>
    </BreakdownCanvas>
  );
}

/** The production-lines project's scroll breakdown: a packaging line on the left, five steps on the right. */
export default function LinesBreakdown({ className }: { className?: string }) {
  return (
    <ScrollBreakdown
      className={className}
      label="How the downtime came down"
      steps={STEPS}
      visual={(api) => <Visual api={api} />}
      caption="A simplified drawing made for this page, with stand-in machines."
    />
  );
}
