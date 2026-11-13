"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ViewerScene } from "./viewerScene";
import styles from "./CubeSatViewer.module.css";

type Props = {
  /** 0 to 1. When set, it drives the take-apart (for scroll control) and the slider follows. */
  explode?: number;
  className?: string;
};

type Mode = "loading" | "live" | "fallback";

const PARTS: { name: string; rest?: string }[] = [
  { name: "Payload", rest: "the camera" },
  { name: "ADCS", rest: "4 reaction wheels and 3 magnetorquers" },
  { name: "Power and computer" },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The project page's CubeSat, which a visitor can turn and take apart. three.js loads
 * inside the effect, so it stays out of the first bundle.
 */
export default function CubeSatViewer({ explode, className }: Props) {
  const id = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const tagRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const lineRefs = useRef<(SVGLineElement | null)[]>([]);
  const dotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const sceneRef = useRef<ViewerScene | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [value, setValue] = useState(() => clamp01(explode ?? 0) * 100);
  const valueRef = useRef(value);

  useEffect(() => {
    if (explode !== undefined) setValue(clamp01(explode) * 100);
  }, [explode]);

  useEffect(() => {
    valueRef.current = value;
    sceneRef.current?.setExplode(value / 100);
  }, [value]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cancelled = false;
    let scene: ViewerScene | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let io: IntersectionObserver | null = null;
    let ro: ResizeObserver | null = null;
    let onVisibility: (() => void) | null = null;
    const sizes = [0, 0, 0].map(() => ({ w: 0, h: 0 }));
    let labelsOn = false;

    const toFallback = () => {
      if (cancelled) return;
      setMode("fallback");
      canvas?.remove();
      canvas = null;
    };

    // Labels: ADCS above the drawing, payload and power below, each joined to its unit by
    // a thin leader line.
    const place = (anchors: { x: number; y: number }[], e: number) => {
      const on = e > 0.4;
      if (on !== labelsOn) {
        labelsOn = on;
        stage.dataset.labels = on ? "on" : "off";
      }
      if (!on && e < 0.3) return;
      const W = stage.clientWidth;
      const H = stage.clientHeight;
      anchors.forEach((a, i) => {
        const tag = tagRefs.current[i];
        const line = lineRefs.current[i];
        const dot = dotRefs.current[i];
        if (!tag || !line || !dot) return;
        if (!sizes[i].w) {
          sizes[i].w = tag.offsetWidth;
          sizes[i].h = tag.offsetHeight;
        }
        const { w, h } = sizes[i];
        const above = i === 1;
        const left = Math.min(Math.max(a.x - w / 2, 4), W - w - 4);
        const top = above ? 6 : H - h - 6;
        tag.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
        const ex = Math.min(Math.max(a.x, left + 8), left + w - 8);
        const ey = above ? top + h + 2 : top - 2;
        line.setAttribute("x1", a.x.toFixed(1));
        line.setAttribute("y1", a.y.toFixed(1));
        line.setAttribute("x2", ex.toFixed(1));
        line.setAttribute("y2", ey.toFixed(1));
        dot.setAttribute("cx", a.x.toFixed(1));
        dot.setAttribute("cy", a.y.toFixed(1));
      });
    };

    (async () => {
      let T: typeof import("three");
      let mod: typeof import("./viewerScene");
      try {
        [T, mod] = await Promise.all([import("three"), import("./viewerScene")]);
      } catch (err) {
        console.warn("CubeSat viewer failed to load", err);
        toFallback();
        return;
      }
      if (cancelled) return;

      canvas = document.createElement("canvas");
      canvas.className = styles.canvas;
      canvas.setAttribute("aria-hidden", "true");
      stage.insertBefore(canvas, stage.firstChild);
      const ink = getComputedStyle(stage).getPropertyValue("--ink").trim() || "#000000";

      try {
        scene = mod.createViewerScene(T, {
          canvas,
          ink,
          reduceMotion: reduce,
          onReady: () => {
            if (!cancelled) setMode("live");
          },
          onFail: toFallback,
          onFrame: place,
        });
      } catch (err) {
        if (!(err instanceof mod.ViewerUnsupportedError)) console.warn("CubeSat viewer unavailable", err);
        toFallback();
        return;
      }
      sceneRef.current = scene;
      const s = scene;
      s.setExplode(valueRef.current / 100);

      let onScreen = false;
      let shown = document.visibilityState === "visible";
      const sync = () => s.setActive(onScreen && shown);
      io = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      });
      io.observe(stage);
      onVisibility = () => {
        shown = document.visibilityState === "visible";
        sync();
      };
      document.addEventListener("visibilitychange", onVisibility);
      ro = new ResizeObserver(() => {
        sizes.forEach((z) => (z.w = 0));
        s.resize();
      });
      ro.observe(stage);
    })();

    return () => {
      cancelled = true;
      io?.disconnect();
      ro?.disconnect();
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      scene?.dispose();
      sceneRef.current = null;
      canvas?.remove();
    };
  }, []);

  return (
    <figure className={className ? `${styles.figure} ${className}` : styles.figure}>
      <div ref={stageRef} className={styles.stage} data-mode={mode} data-labels="off">
        <svg className={styles.leaders} aria-hidden="true">
          {PARTS.map((p, i) => (
            <g key={p.name}>
              <line
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
              />
              <circle
                r={2.5}
                ref={(el) => {
                  dotRefs.current[i] = el;
                }}
              />
            </g>
          ))}
        </svg>
        {PARTS.map((p, i) => (
          <span
            key={p.name}
            className={styles.tag}
            aria-hidden="true"
            ref={(el) => {
              tagRefs.current[i] = el;
            }}
          >
            <strong>{p.name}</strong>
            {p.rest ? `: ${p.rest}` : null}
          </span>
        ))}
        {mode === "fallback" ? <p className={styles.fallback}>The 3D view of the CubeSat needs WebGL.</p> : null}
      </div>
      <div className={styles.controls}>
        <label htmlFor={id}>Take it apart</label>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(value)}
          onChange={(e) => setValue(Number(e.target.value))}
        />
      </div>
      <ul className={styles.list}>
        {PARTS.map((p) => (
          <li key={p.name}>
            <strong>{p.name}</strong>
            {p.rest ? `: ${p.rest}` : null}
          </li>
        ))}
      </ul>
    </figure>
  );
}
