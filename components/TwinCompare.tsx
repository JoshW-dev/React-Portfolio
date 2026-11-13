"use client";

/* eslint-disable @next/next/no-img-element */
import { useState, type CSSProperties } from "react";
import styles from "./TwinCompare.module.css";

/** One frame, twice: the line as a photograph and as its model. Drag to move between them. */
export default function TwinCompare() {
  const [split, setSplit] = useState(55);

  return (
    <div className={styles.compare} style={{ "--split": `${split}%` } as CSSProperties}>
      <img
        src="/film/04-line.webp"
        width={1344}
        height={752}
        alt="A carton line in a packaging plant, seen low along the conveyor"
      />
      <img
        className={styles.model}
        src="/film/05-twin.webp"
        width={1344}
        height={752}
        alt="The same line drawn as a wireframe model, with a cluster of cartons marked in amber"
      />
      <span className={styles.edge} aria-hidden="true" />
      <span className={`${styles.tag} ${styles.left}`} aria-hidden="true">
        The model
      </span>
      <span className={`${styles.tag} ${styles.right}`} aria-hidden="true">
        The line
      </span>
      <input
        className={styles.range}
        type="range"
        min={0}
        max={100}
        value={split}
        onChange={(e) => setSplit(Number(e.target.value))}
        aria-label="Slide between the line and its model"
      />
    </div>
  );
}
