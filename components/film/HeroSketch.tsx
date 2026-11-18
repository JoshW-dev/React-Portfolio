import type { CSSProperties } from "react";
import sketches from "@/lib/heroSketches.json";
import SketchScript from "./SketchScript";
import styles from "./HeroSketch.module.css";

/*
  A project hero's picture as a vector sketch, in the page's HTML, so the hero shows a picture
  at first paint. scripts/hero-sketch.py makes the sketches: a low-poly fill and the picture's
  main contours as lines. On a fresh visit the lines draw in, the fill fades up under them, and
  the real picture fades in over both once it has loaded (sketchReveal.ts).

  It is framed like the picture: object-fit: cover at `position`, so the two line up exactly.

  A server component only: it reads every sketch, and only the one it renders goes to the page.
*/

/** The lines' box (w, h), the fill's (fw, fh), the picture's width over height, and the paths. */
type Sketch = { w: number; h: number; fw: number; fh: number; a: number; fill: [string, string][]; lines: string[] };

const all = sketches as unknown as Record<string, Sketch>;

/** The sketch for a hero picture, or null when the picture has none yet. */
export function heroSketch(src: string, position: [number, number] = [0.5, 0.5]) {
  const s = all[src];
  return s ? <HeroSketch s={s} position={position} /> : null;
}

function HeroSketch({ s, position }: { s: Sketch; position: [number, number] }) {
  const frame = { "--a": s.a, "--px": position[0], "--py": position[1] } as CSSProperties;
  return (
    <div className={styles.art} style={frame} aria-hidden="true" data-sketch-art="">
      <svg className={styles.fill} viewBox={`0 0 ${s.fw} ${s.fh}`} preserveAspectRatio="xMidYMid slice">
        {s.fill.map(([colour, d]) => (
          <path key={colour} fill={colour} stroke={colour} d={d} />
        ))}
      </svg>
      <svg className={styles.lines} viewBox={`0 0 ${s.w} ${s.h}`} preserveAspectRatio="xMidYMid slice">
        {/* One path per wave of lines; each line is a piece of it. */}
        {s.lines.map((d, i) => (
          <path key={i} pathLength={1} d={d} />
        ))}
      </svg>
      <SketchScript />
      {/* Without scripts the picture shows as soon as it loads, over the sketch. */}
      <noscript>
        <style>{"[data-sketch] img{opacity:1!important;animation:none!important}"}</style>
      </noscript>
    </div>
  );
}
