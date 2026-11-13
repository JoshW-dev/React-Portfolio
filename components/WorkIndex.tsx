"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Work } from "@/lib/work";
import styles from "./WorkIndex.module.css";

// Floating preview: size, offset from the cursor, and how far it keeps from the viewport edge.
const PREVIEW_W = 340;
const PREVIEW_H = 212;
const OFFSET = 28;
const EDGE = 16;
const LERP = 0.18;
const PREVIEW_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 900px)";

export default function WorkIndex({ items }: { items: Work[] }) {
  const [canPreview, setCanPreview] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const frame = useRef<number | null>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const factor = useRef(LERP);
  const preloaded = useRef(new Set<string>());

  function stop() {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }

  // Turn the preview on only for a fine pointer on a wide screen, and follow changes.
  useEffect(() => {
    const mq = window.matchMedia(PREVIEW_QUERY);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setCanPreview(mq.matches);
      if (!mq.matches) {
        stop();
        setShown(false);
      }
      factor.current = reduce.matches ? 1 : LERP;
    };
    sync();
    mq.addEventListener("change", sync);
    reduce.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      reduce.removeEventListener("change", sync);
      stop();
    };
  }, []);

  // Where the preview should sit for a cursor at (x, y): lower right, flipped near the edges.
  function place(x: number, y: number) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let px = x + OFFSET;
    let py = y + OFFSET;
    if (px + PREVIEW_W + EDGE > vw) px = x - OFFSET - PREVIEW_W;
    if (py + PREVIEW_H + EDGE > vh) py = y - OFFSET - PREVIEW_H;
    px = Math.min(Math.max(px, EDGE), vw - PREVIEW_W - EDGE);
    py = Math.min(Math.max(py, EDGE), vh - PREVIEW_H - EDGE);
    return { x: px, y: py };
  }

  function apply() {
    const el = imgRef.current;
    if (el) el.style.transform = `translate3d(${current.current.x}px, ${current.current.y}px, 0)`;
  }

  function tick() {
    const c = current.current;
    const t = place(target.current.x, target.current.y);
    c.x += (t.x - c.x) * factor.current;
    c.y += (t.y - c.y) * factor.current;
    apply();
    frame.current = requestAnimationFrame(tick);
  }

  function preload() {
    for (const item of items) {
      const s = item.image?.src;
      if (!s || preloaded.current.has(s)) continue;
      preloaded.current.add(s);
      const img = new Image();
      img.src = s;
    }
  }

  function onEnter(e: PointerEvent) {
    if (!canPreview || e.pointerType !== "mouse") return;
    preload();
    target.current = { x: e.clientX, y: e.clientY };
    // Start at the cursor so the preview doesn't fly in from the corner.
    current.current = place(e.clientX, e.clientY);
    apply();
    stop();
    frame.current = requestAnimationFrame(tick);
  }

  function onMove(e: PointerEvent) {
    if (!canPreview || e.pointerType !== "mouse") return;
    target.current = { x: e.clientX, y: e.clientY };
  }

  function onLeave() {
    stop();
    setShown(false);
  }

  function onRow(e: PointerEvent, item: Work) {
    if (!canPreview || e.pointerType !== "mouse") return;
    if (item.image) {
      setSrc(item.image.src);
      setShown(true);
    } else {
      setShown(false);
    }
  }

  return (
    <>
      <ul
        className={styles.list}
        onPointerEnter={onEnter}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
      >
        {items.map((item) => (
          <li key={item.slug} className={styles.item}>
            <Link
              href={`/work/${item.slug}`}
              className={styles.row}
              onPointerEnter={(e) => onRow(e, item)}
            >
              <span className={styles.title}>{item.title}</span>
              <span className={styles.summary}>{item.summary}</span>
              <span className={styles.kind}>{item.kind}</span>
            </Link>
          </li>
        ))}
      </ul>
      {canPreview ? (
        // One plain img whose src swaps as the pointer moves between rows.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={src ?? undefined}
          alt=""
          aria-hidden="true"
          width={PREVIEW_W}
          height={PREVIEW_H}
          decoding="async"
          className={`${styles.preview} ${shown && src ? styles.shown : ""}`}
        />
      ) : null}
    </>
  );
}
