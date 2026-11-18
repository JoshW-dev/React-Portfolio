"use client";

import { useRef, type CSSProperties } from "react";
import ScrollBreakdown, {
  BreakdownCanvas,
  type BreakdownApi,
  type BreakdownStep,
  type SceneFactory,
} from "@/components/breakdown/ScrollBreakdown";
import type { GrowthDom, NoteKey, PanelKey } from "./growthScene";
import styles from "./DiscoBreakdown.module.css";

const STEPS: BreakdownStep[] = [
  {
    id: "audit",
    title: "Find the bottleneck first",
    body: (
      <p>
        Disco had hundreds of ideas for AI, so I started by asking where the business was stuck.
        I connected an AI research tool to the CRM, email, calendar, team chat and call
        recordings, and it wrote one report on where revenue came from. The bottleneck was
        finding new customers.
      </p>
    ),
  },
  {
    id: "glass",
    title: "Every lead under the glass",
    body: (
      <p>
        A sales funnel works a lot like a production line: leads come in at one end and revenue
        comes out the other. With every lead and sales call in front of it, the AI found that
        enterprise buyers were worth about 10 times more than smaller companies, yet most of the
        sales time went to the smaller ones. Most enterprise buyers had found Disco through AI
        chat.
      </p>
    ),
  },
  {
    id: "discovered",
    title: "Get found by the right buyers",
    body: (
      <p>
        We pointed all our content at four topics that enterprise buyers kept raising on sales
        calls, as articles and videos. AI chat tools started to recommend Disco when buyers asked
        about them. AI search went from about 30% of our new leads to about 60%.
      </p>
    ),
  },
  {
    id: "research",
    title: "Research every lead before the first message",
    body: (
      <p>
        Researching a new lead used to take a few hours by hand. Now AI reads the company&rsquo;s
        website, the CRM and any past conversations, and sorts the lead into one of three kinds of
        buyer. The first message talks about what that kind of buyer cares about, and the
        salesperson knows it before the call.
      </p>
    ),
  },
  {
    id: "qualify",
    title: "Qualify before the sales call",
    body: (
      <p>
        A fit check runs before anyone books a call. Enterprise buyers who match go to a
        salesperson. Smaller companies get pointed to the self-serve demo, and leads that
        don&rsquo;t fit are told so, which leaves the sales team&rsquo;s time for the deals that
        bring in revenue.
      </p>
    ),
  },
  {
    id: "results",
    title: "What changed",
    body: (
      <p>
        Enterprise leads roughly doubled in under two months, and annual recurring revenue from
        those customers roughly tripled in five. They were also easier to manage, churned less and
        signed annual contracts.
      </p>
    ),
  },
];

/** blue: the part a step is about. wrap: one or two words a line. */
const NOTES: { key: NoteKey; text: string; blue?: boolean; wrap?: boolean; quiet?: boolean }[] = [
  { key: "tool0", text: "CRM", quiet: true },
  { key: "tool1", text: "Email", quiet: true },
  { key: "tool2", text: "Calendar", quiet: true },
  { key: "tool3", text: "Team chat", quiet: true },
  { key: "tool4", text: "Call recordings", quiet: true },
  { key: "tool5", text: "Meeting notes", quiet: true },
  { key: "ai", text: "AI research" },
  { key: "bar0", text: "Find new customers", blue: true, wrap: true },
  { key: "bar1", text: "Serve customers", wrap: true },
  { key: "bar2", text: "Handle admin", wrap: true },
  { key: "bar3", text: "Follow up", wrap: true },
  { key: "bar4", text: "Hire people", wrap: true },
  { key: "bottleneck", text: "Bottleneck", blue: true },
  { key: "src0", text: "AI chat", blue: true, quiet: true },
  { key: "src1", text: "Google search", quiet: true },
  { key: "src2", text: "Organic content", quiet: true },
  { key: "src3", text: "Paid ads", quiet: true },
  { key: "src4", text: "Referrals", quiet: true },
  { key: "src5", text: "Conferences", quiet: true },
  { key: "stage0", text: "New leads", wrap: true },
  { key: "stage1", text: "Qualified", wrap: true },
  { key: "stage2", text: "Segmented", wrap: true },
  { key: "stage3", text: "Contacted", wrap: true },
  { key: "stage4", text: "Sales call", wrap: true },
  { key: "revenue", text: "Revenue" },
  { key: "lost", text: "Lost along the way", quiet: true },
  { key: "cards", text: "Articles and videos on four buyer topics" },
  { key: "research", text: "AI research", blue: true },
  { key: "lane0", text: "Learning business", blue: true },
  { key: "lane1", text: "L&D team", blue: true },
  { key: "lane2", text: "Smaller company" },
  { key: "message", text: "A first message for each kind of buyer" },
  { key: "fit", text: "Fit check", blue: true },
  { key: "call", text: "Sales call", blue: true },
  { key: "demo", text: "Self-serve demo" },
  { key: "poor", text: "Poor fit: no sales time", quiet: true },
];

type Refs = { notes: Partial<Record<NoteKey, HTMLSpanElement>>; panels: Partial<Record<PanelKey, HTMLDivElement>> };

function collect(r: Refs): GrowthDom {
  const notes = {} as Record<NoteKey, HTMLElement>;
  for (const { key } of NOTES) {
    const el = r.notes[key];
    if (!el) throw new Error(`Disco overlay is missing ${key}`);
    notes[key] = el;
  }
  const panels = {} as Record<PanelKey, HTMLElement>;
  for (const key of ["key", "share", "results"] as const) {
    const el = r.panels[key];
    if (!el) throw new Error(`Disco overlay is missing the ${key} panel`);
    panels[key] = el;
  }
  return { notes, panels };
}

function Visual({ api }: { api: BreakdownApi }) {
  const refs = useRef<Refs>({ notes: {}, panels: {} });
  const panel = (key: PanelKey) => (el: HTMLDivElement | null) => {
    if (el) refs.current.panels[key] = el;
  };

  const load = async (): Promise<SceneFactory> => {
    const mod = await import("./growthScene");
    return (T, ctx) => mod.createGrowthScene(T, ctx, collect(refs.current));
  };

  return (
    <BreakdownCanvas api={api} load={load} fallback="The 3D drawing of the sales line needs WebGL." className={styles.host}>
      {NOTES.map((n) => (
        <span
          key={n.key}
          className={[styles.note, n.blue && styles.blue, n.wrap && styles.wrap, n.quiet && styles.quiet].filter(Boolean).join(" ")}
          aria-hidden="true"
          ref={(el) => {
            if (el) refs.current.notes[n.key] = el;
          }}
        >
          {n.text}
        </span>
      ))}

      <div className={`${styles.panel} ${styles.key}`} aria-hidden="true" ref={panel("key")}>
        <span className={styles.keyRow}>
          <i className={`${styles.swatch} ${styles.tall}`} />
          Enterprise lead, worth about 10× a smaller one
        </span>
        <span className={styles.keyRow}>
          <i className={`${styles.swatch} ${styles.flat}`} />
          Smaller company
        </span>
      </div>

      <div className={`${styles.panel} ${styles.share}`} aria-hidden="true" ref={panel("share")}>
        <span className={styles.shareLabel}>New leads from AI search</span>
        <span className={styles.track}>
          <span className={styles.fill} />
        </span>
        <span className={styles.shareValue}>
          <span className={styles.from}>~30%</span>
          <span className={styles.to}>~60%</span>
        </span>
      </div>

      <div className={`${styles.panel} ${styles.results}`} aria-hidden="true" ref={panel("results")}>
        <div className={styles.result}>
          <span className={styles.bars}>
            <i className={styles.before} />
            <i className={styles.after} style={{ "--k": 2 } as CSSProperties} />
          </span>
          <span className={styles.figure}>~2×</span>
          <span className={styles.what}>
            Enterprise leads
            <br />
            <span className={styles.when}>in under 2 months</span>
          </span>
        </div>
        <div className={styles.result}>
          <span className={styles.bars}>
            <i className={styles.before} />
            <i className={styles.after} style={{ "--k": 3 } as CSSProperties} />
          </span>
          <span className={styles.figure}>~3×</span>
          <span className={styles.what}>
            ARR from them
            <br />
            <span className={styles.when}>in 5 months</span>
          </span>
        </div>
      </div>
    </BreakdownCanvas>
  );
}

/** Disco's scroll breakdown: the sales funnel drawn as a production line, six steps. */
export default function DiscoBreakdown({ className }: { className?: string }) {
  return (
    <ScrollBreakdown
      className={className}
      label="How the AI growth system at Disco works"
      steps={STEPS}
      visual={(api) => <Visual api={api} />}
    />
  );
}
