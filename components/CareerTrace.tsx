import type { CSSProperties } from "react";
import styles from "./CareerTrace.module.css";

/*
  Josh's career drawn like a trace waterfall: one row per span, each bar placed
  by start and end month on a shared axis. Pure HTML and CSS, no client JS.
*/

type Month = { year: number; month: number }; // month is 1 to 12

export type Span = {
  name: string;
  role: string;
  start: Month;
  end: Month | "now";
  result?: string;
  /** 1 nests the row under the span above it, like a child span in a trace. */
  depth?: 0 | 1;
};

const AXIS_START = 2016; // January 2016
const AXIS_END = 2027; // January 2027
const AXIS_MONTHS = (AXIS_END - AXIS_START) * 12;

// The open end of the current job. Move this forward when the site is updated.
const NOW: Month = { year: 2026, month: 11 };

export const spans: Span[] = [
  {
    name: "Queen’s University",
    role: "B.A.Sc., Computer Engineering and Applied Mathematics",
    start: { year: 2016, month: 9 },
    end: { year: 2021, month: 5 },
  },
  {
    name: "Centre for Advanced Computing",
    role: "Software developer",
    start: { year: 2019, month: 5 },
    end: { year: 2020, month: 11 },
    result: "Led the build and launch of a mental health startup’s web platform in four months.",
    depth: 1,
  },
  {
    name: "Queen’s Space Engineering Team",
    role: "Chief technical officer, satellite project",
    start: { year: 2020, month: 4 },
    end: { year: 2021, month: 5 },
    result: "Led 35 students designing and building a CubeSat.",
    depth: 1,
  },
  {
    name: "Engineering consulting",
    role: "Energy and manufacturing projects",
    start: { year: 2021, month: 9 },
    end: { year: 2023, month: 8 },
    result:
      "Cut $300M+ from a hydrogen plant’s capital budget and 35% of downtime on two production lines.",
  },
  {
    name: "Disco",
    role: "AI growth engineer",
    start: { year: 2023, month: 9 },
    end: { year: 2026, month: 6 },
    result:
      "Built the AI course builder that helped close enterprise deals. Cut chat response times 75% and cost 58%.",
  },
  {
    name: "GovTech startup, backed by Y Combinator",
    role: "Senior software engineer, AI",
    start: { year: 2026, month: 7 },
    end: "now",
    result: "Voice agents on lines that take more than 100,000 calls a year.",
  },
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const monthName = (m: Month) => `${MONTHS[m.month - 1]} ${m.year}`;

/** "September 2016 to May 2021", or "July 2026 to now" for the current job. */
export function formatRange(span: Span): string {
  const end = span.end === "now" ? "now" : monthName(span.end);
  return `${monthName(span.start)} to ${end}`;
}

// Months since January 2016. Starts count from the first of the month, ends
// from the last day of the month, and "now" sits mid-month.
const fromStart = (m: Month) => (m.year - AXIS_START) * 12 + (m.month - 1);
const fromEnd = (m: Month | "now") =>
  m === "now" ? fromStart(NOW) + 0.5 : fromStart(m) + 1;

const pct = (months: number) =>
  `${(Math.min(Math.max(months, 0), AXIS_MONTHS) / AXIS_MONTHS) * 100}%`;

const years = Array.from(
  { length: AXIS_END - AXIS_START + 1 },
  (_, i) => AXIS_START + i,
);

function Gridlines() {
  return (
    <span className={styles.lines} aria-hidden="true">
      {years.map((y) => (
        <span key={y} style={{ left: pct((y - AXIS_START) * 12) }} />
      ))}
    </span>
  );
}

export default function CareerTrace() {
  return (
    <figure className={styles.trace}>
      <div className={styles.axis} aria-hidden="true">
        <span />
        <div className={styles.scale}>
          {years.map((y) => (
            <span
              key={y}
              className={`${styles.year} ${(y - AXIS_START) % 2 ? styles.odd : ""}`}
              style={{ left: pct((y - AXIS_START) * 12) }}
            >
              {y}
            </span>
          ))}
        </div>
      </div>

      <ol className={styles.rows}>
        {spans.map((s) => {
          const start = fromStart(s.start);
          const end = fromEnd(s.end);
          const live = s.end === "now";
          const bar: CSSProperties = { left: pct(start), width: pct(end - start) };

          return (
            <li key={s.name} className={`${styles.row} ${s.depth ? styles.child : ""}`}>
              <div className={styles.label}>
                <p className={styles.name}>{s.name}</p>
                <p className="small muted">{s.role}</p>
                <p className="sr">{formatRange(s)}</p>
                {s.result && <p className={`small muted ${styles.result}`}>{s.result}</p>}
              </div>
              <div className={styles.track} aria-hidden="true">
                <Gridlines />
                <span className={styles.bar} style={bar} />
                {live && <span className={styles.live} style={{ left: pct(end) }} />}
              </div>
            </li>
          );
        })}
      </ol>

      <figcaption className="small muted">
        My degree overlapped with two other roles from 2019 to 2021, and since
        then I&rsquo;ve moved from engineering consulting into building AI at
        startups.
      </figcaption>
    </figure>
  );
}
