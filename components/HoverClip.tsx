"use client";

import { useRef, useState } from "react";
import styles from "./ProjectGrid.module.css";

/** Plays a project's clip over its picture while the pointer is on the tile. */
export default function HoverClip({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false);
  const [on, setOn] = useState(false);

  return (
    <span
      className={styles.clip}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        setArmed(true);
        setOn(true);
        ref.current?.play().catch(() => {});
      }}
      onPointerLeave={() => {
        setOn(false);
        ref.current?.pause();
      }}
    >
      {armed ? (
        <video
          ref={ref}
          src={src}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          data-on={on}
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}
