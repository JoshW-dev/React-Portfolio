"use client";

import { useState } from "react";
import WorkIndex from "@/components/WorkIndex";
import type { Work, WorkKind } from "@/lib/work";
import styles from "./work.module.css";

type Filter = WorkKind | "All";

export default function Browser({ items, kinds }: { items: Work[]; kinds: WorkKind[] }) {
  const [filter, setFilter] = useState<Filter>("All");
  const shown = filter === "All" ? items : items.filter((w) => w.kind === filter);
  const options: Filter[] = ["All", ...kinds];

  return (
    <>
      <div className={styles.filter} role="group" aria-label="Filter work by kind">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={styles.option}
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <WorkIndex items={shown} />
    </>
  );
}
