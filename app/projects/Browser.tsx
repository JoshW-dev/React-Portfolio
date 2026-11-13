"use client";

import { useState, type ReactNode } from "react";
import type { WorkKind } from "@/lib/work";
import styles from "./projects.module.css";

type Filter = WorkKind | "All";

/** Filter buttons. The grids are rendered on the server and passed in, one per kind. */
export default function Browser({
  kinds,
  views,
}: {
  kinds: WorkKind[];
  views: Record<string, ReactNode>;
}) {
  const [filter, setFilter] = useState<Filter>("All");
  const options: Filter[] = ["All", ...kinds];

  return (
    <>
      <div className={styles.filter} role="group" aria-label="Filter projects by kind">
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
      {views[filter]}
    </>
  );
}
