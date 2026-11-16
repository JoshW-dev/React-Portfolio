"use client";

import { useEffect, useId, useRef, useState } from "react";
import ScrollBreakdown, {
  BreakdownCanvas,
  type BreakdownApi,
  type BreakdownStep,
  type SceneFactory,
} from "@/components/breakdown/ScrollBreakdown";
import type { Callout } from "@/components/breakdown/kit";
import type { CalloutKey, CubeSatDom, NoteKey } from "./cubesatBreakdownScene";
import { createBlueprint, steerBlueprint } from "./blueprint";
import styles from "./CubeSatBreakdown.module.css";

const STEPS: BreakdownStep[] = [
  {
    id: "task",
    title: "A photo on the next pass",
    body: (
      <p>
        Operators on the ground send the satellite a pair of coordinates by radio. It holds on to
        them, and the next time its orbit carries it over that place it points its camera at the
        ground and takes a photo. The camera is fixed to the body, so pointing it means turning
        the whole satellite.
      </p>
    ),
  },
  {
    id: "power",
    title: "Power from one flat array",
    body: (
      <p>
        Solar cells cover one long face, and two wings hinged on its long edges fold out flat
        beside it, so the array is a single plane of nine cells, three by three and about 30 cm
        square. A cell makes less power the further it tilts away from the sun, which is why one
        flat array that can be aimed beats cells spread over every face. In its power mode the
        satellite turns until the array faces the sun to within 10 degrees.
      </p>
    ),
  },
  {
    id: "pointing",
    title: "Pointing, my part of the design",
    body: (
      <p>
        The middle unit holds four small reaction wheels: spin one up and the satellite turns the
        other way, which gives fine control from electricity alone. Three wheels cover three axes,
        so the fourth is a spare, and it also lets the controller keep every wheel away from zero
        speed, where bearing friction makes the torque hard to control. A wheel can only spin so
        fast, so three magnetorquers push against Earth&rsquo;s magnetic field to bleed off the
        momentum the wheels build up, with no fuel. Right after release they also run a{" "}
        <span className={styles.nowrap}>B-dot</span> law that slows the tumble.
      </p>
    ),
  },
  {
    id: "computer",
    title: "A computer that rides out radiation",
    body: (
      <p>
        Even in low Earth orbit, charged particles from the sun and from deep space pass straight
        through the electronics. One hit can flip a bit in memory, which is a single-event upset, or
        start a latch-up that draws current until the power is cut, while the total dose slowly wears
        parts down. Radiation-hardened chips resist this but cost more than a student team can
        spend, so our computer was built with redundancy: a spare copy of a part or a piece of data
        lets the system catch a fault in one and carry on.
      </p>
    ),
  },
  {
    id: "photo",
    title: "Holding the camera on target",
    body: (
      <p>
        Over the target, the controller compares the attitude it wants with the one its sensors
        measure and turns the error into wheel torques. It does that maths in quaternions, four
        numbers that describe any orientation without the gimbal lock that three angles run into,
        and they&rsquo;re cheap to compute. The wheels slew the satellite until the camera points
        at the coordinates and hold it there, within 6.5 degrees, for the photo.
      </p>
    ),
  },
  {
    id: "camera",
    title: "The camera, looking straight down the body",
    body: (
      <p>
        The camera is the payload, and the team built it for this satellite. It sits in the end
        unit that faces Earth, with the lens looking out through the end plate and an image sensor
        on a board behind it. Nothing on it moves. Light from the ground comes up through the lens
        and falls on the sensor, the computer saves the frame, and the radio sends it down on a
        later pass over the ground station.
      </p>
    ),
  },
];

const CALLOUTS: { key: CalloutKey; text: string }[] = [
  { key: "antenna", text: "Radio antennas" },
  { key: "camera", text: "Camera" },
  { key: "array", text: "Solar array, 3 × 3 cells" },
  { key: "wheels", text: "4 reaction wheels" },
  { key: "torquers", text: "3 magnetorquers" },
  { key: "computer", text: "Flight computer" },
  { key: "lens", text: "Lens" },
  { key: "sensor", text: "Image sensor" },
];

const NOTES: { key: NoteKey; text: string }[] = [
  { key: "station", text: "Ground station" },
  { key: "sun", text: "Sun" },
  { key: "angle10", text: "10°" },
  { key: "particles", text: "Charged particles" },
  { key: "target", text: "Target" },
  { key: "angle65", text: "6.5°" },
];

type Refs = {
  limbs: (SVGPathElement | null)[];
  earthImage: (SVGGraphicsElement | null)[];
  stars: (HTMLCanvasElement | null)[];
  svg: Partial<Record<"earth" | "grid" | "air" | "station" | "uplink" | "rays" | "wedge" | "tracks" | "sight" | "cone" | "light", SVGPathElement>> & {
    sun?: SVGGElement;
    target?: SVGGElement;
  };
  particles: (SVGCircleElement | null)[];
  lines: Partial<Record<CalloutKey, SVGLineElement>>;
  dots: Partial<Record<CalloutKey, SVGCircleElement>>;
  tags: Partial<Record<CalloutKey, HTMLSpanElement>>;
  notes: Partial<Record<NoteKey, HTMLSpanElement>>;
};

function collect(r: Refs): CubeSatDom {
  const need = <E,>(el: E | undefined | null, name: string): E => {
    if (!el) throw new Error(`CubeSat overlay is missing ${name}`);
    return el;
  };
  const callouts = {} as Record<CalloutKey, Callout>;
  for (const { key } of CALLOUTS)
    callouts[key] = { el: need(r.tags[key], key), line: need(r.lines[key], key), dot: r.dots[key] ?? null };
  const notes = {} as Record<NoteKey, HTMLElement>;
  for (const { key } of NOTES) notes[key] = need(r.notes[key], key);
  const limbs = r.limbs.filter((l): l is SVGPathElement => !!l);
  const earthImage = r.earthImage.filter((l): l is SVGGraphicsElement => !!l);
  const [s0, s1] = r.stars;
  return {
    earth: need(r.svg.earth, "earth"),
    limbs,
    earthImage,
    stars: s0 && s1 ? [s0, s1] : undefined,
    globe: r.svg.grid && r.svg.air ? { grid: r.svg.grid, air: r.svg.air } : undefined,
    station: need(r.svg.station, "station"),
    uplink: need(r.svg.uplink, "uplink"),
    sun: need(r.svg.sun, "sun"),
    rays: need(r.svg.rays, "rays"),
    wedge: need(r.svg.wedge, "wedge"),
    tracks: need(r.svg.tracks, "tracks"),
    particles: r.particles.map((p, i) => need(p, `particle ${i}`)),
    sight: need(r.svg.sight, "sight"),
    cone: need(r.svg.cone, "cone"),
    target: need(r.svg.target, "target"),
    light: need(r.svg.light, "light"),
    callouts,
    notes,
  };
}

/** Eight short ticks around the sun's disc. */
const SUN_TICKS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return `M ${(c * 15).toFixed(1)} ${(s * 15).toFixed(1)} L ${(c * 20).toFixed(1)} ${(s * 20).toFixed(1)}`;
}).join(" ");

/** The drawing's grid: a line every 24px, a heavier one every 120px. */
const GRID_MINOR = [1, 2, 3, 4].map((i) => `M ${i * 24 + 0.5} 0 V 120 M 0 ${i * 24 + 0.5} H 120`).join(" ");
const GRID_MAJOR = "M 0.5 0 V 120 M 0 0.5 H 120";

function Visual({ api }: { api: BreakdownApi }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [blueprint] = useState(createBlueprint);
  const { position, subscribe } = api;

  // Space at the first step, the drawing from there on: the article's mark turns the page's
  // colours (globals.css), and the scene follows the same switch.
  useEffect(() => {
    const article = hostRef.current?.closest("article");
    if (!article) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const steer = () => {
      blueprint.reduced = reduce.matches;
      steerBlueprint(blueprint, position.current ?? 0, performance.now());
      article.dataset.blueprint = blueprint.on ? "on" : "off";
    };
    steer();
    const off = subscribe(steer);
    return () => {
      off();
      delete article.dataset.blueprint;
    };
  }, [blueprint, position, subscribe]);

  const refs = useRef<Refs>({ limbs: [null, null, null, null], earthImage: [null, null], stars: [null, null], svg: {}, particles: [null, null, null], lines: {}, dots: {}, tags: {}, notes: {} });
  const r = refs.current;
  const path = (name: keyof Refs["svg"]) => (el: SVGPathElement | null) => {
    if (el) (r.svg as Record<string, unknown>)[name] = el;
  };

  const load = async (): Promise<SceneFactory> => {
    const [mod, seg, geo, mat] = await Promise.all([
      import("./cubesatBreakdownScene"),
      import("three/examples/jsm/lines/LineSegments2.js"),
      import("three/examples/jsm/lines/LineSegmentsGeometry.js"),
      import("three/examples/jsm/lines/LineMaterial.js"),
    ]);
    const fat = { LineSegments2: seg.LineSegments2, LineSegmentsGeometry: geo.LineSegmentsGeometry, LineMaterial: mat.LineMaterial };
    return (T, ctx) => mod.createCubeSatBreakdown(T, ctx, collect(refs.current), fat, blueprint);
  };
  // Ids in url() references must be plain.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const tintId = `limb-${uid}`;
  const clipId = `earth-${uid}`;
  const shadeId = `shade-${uid}`;
  const glowId = `glow-${uid}`;
  const gridId = `grid-${uid}`;

  return (
    <BreakdownCanvas
      api={api}
      load={load}
      fallback="The 3D drawing of the satellite needs WebGL."
      className={styles.host}
      hostRef={hostRef}
    >
      {/* Stars, on a dark page only. The second canvas holds the few that twinkle. */}
      <div className={styles.sky} aria-hidden="true">
        {[0, 1].map((i) => (
          <canvas
            key={i}
            className={i === 0 ? styles.stars : `${styles.stars} ${styles.twinkle}`}
            ref={(el) => {
              r.stars[i] = el;
            }}
          />
        ))}
      </div>
      {/* Earth's limb, behind the canvas. In space it shows the planet from orbit: the day side
          over the Rockies, the night side's city lights to the east, and a thin atmosphere
          along the edge. In the drawing it is a globe's grid on a gridded sheet. */}
      <svg className={styles.ground} aria-hidden="true">
        <defs>
          <linearGradient id={tintId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className={styles.tintTop} />
            <stop offset="0.6" className={styles.tintBottom} />
          </linearGradient>
          <clipPath id={clipId}>
            <path
              ref={(el) => {
                r.limbs[0] = el;
              }}
            />
          </clipPath>
          {/* Haze near the edge, where you look through more air, and shade further down. */}
          <linearGradient id={shadeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fb8ff" stopOpacity="0.55" />
            <stop offset="0.16" stopColor="#5c8de0" stopOpacity="0.18" />
            <stop offset="0.5" stopColor="#05070b" stopOpacity="0" />
            <stop offset="1" stopColor="#05070b" stopOpacity="0.55" />
          </linearGradient>
          <filter id={glowId} x="-5%" y="-50%" width="110%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <pattern id={gridId} width="120" height="120" patternUnits="userSpaceOnUse">
            <path d={GRID_MINOR} className={styles.gridMinor} />
            <path d={GRID_MAJOR} className={styles.gridMajor} />
          </pattern>
        </defs>
        <g className={styles.space}>
          <g className={styles.planet} clipPath={`url(#${clipId})`}>
            <image
              href="/work/cubesat/earth-strip.webp"
              preserveAspectRatio="xMidYMin slice"
              ref={(el) => {
                r.earthImage[0] = el;
              }}
            />
            <rect
              fill={`url(#${shadeId})`}
              ref={(el) => {
                r.earthImage[1] = el;
              }}
            />
          </g>
          <path
            className={styles.atmosphere}
            filter={`url(#${glowId})`}
            ref={(el) => {
              r.limbs[1] = el;
            }}
          />
          <path ref={path("earth")} className={styles.earth} fill={`url(#${tintId})`} />
        </g>
        <g className={styles.sheet}>
          <rect width="100%" height="100%" fill={`url(#${gridId})`} className={styles.paperGrid} />
          <path
            className={styles.globe}
            ref={(el) => {
              r.limbs[2] = el;
            }}
          />
          <path ref={path("grid")} className={styles.graticule} />
          <path
            className={styles.horizon}
            ref={(el) => {
              r.limbs[3] = el;
            }}
          />
          <path ref={path("air")} className={styles.air} />
        </g>
      </svg>
      <svg className={styles.overlay} aria-hidden="true">
        <path ref={path("station")} className={styles.station} />
        <path ref={path("uplink")} className={styles.uplink} />
        <path ref={path("rays")} className={styles.rays} />
        <path ref={path("wedge")} className={styles.wedge} />
        <g
          ref={(el) => {
            if (el) r.svg.sun = el;
          }}
          className={styles.sun}
        >
          <circle r={10} />
          <path d={SUN_TICKS} />
        </g>
        <path ref={path("tracks")} className={styles.tracks} />
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            r={2.6}
            className={styles.particle}
            ref={(el) => {
              r.particles[i] = el;
            }}
          />
        ))}
        <path ref={path("cone")} className={styles.cone} />
        <path ref={path("sight")} className={styles.sight} />
        <g
          ref={(el) => {
            if (el) r.svg.target = el;
          }}
          className={styles.target}
        >
          <circle r={8} />
          <circle r={2} className={styles.targetDot} />
        </g>
        <path ref={path("light")} className={styles.light} />
        {CALLOUTS.map((c) => (
          <g key={c.key} className={styles.leader}>
            <line
              ref={(el) => {
                if (el) r.lines[c.key] = el;
              }}
            />
            <circle
              r={2.5}
              ref={(el) => {
                if (el) r.dots[c.key] = el;
              }}
            />
          </g>
        ))}
      </svg>
      {CALLOUTS.map((c) => (
        <span
          key={c.key}
          className={styles.tag}
          aria-hidden="true"
          ref={(el) => {
            if (el) r.tags[c.key] = el;
          }}
        >
          {c.text}
        </span>
      ))}
      {NOTES.map((n) => (
        <span
          key={n.key}
          className={styles.note}
          aria-hidden="true"
          ref={(el) => {
            if (el) r.notes[n.key] = el;
          }}
        >
          {n.text}
        </span>
      ))}
    </BreakdownCanvas>
  );
}

/** The CubeSat project's scroll breakdown: the model on the left, the six steps on the right. */
export default function CubeSatBreakdown({ className }: { className?: string }) {
  return (
    <ScrollBreakdown
      className={className}
      label="How the satellite does its job"
      steps={STEPS}
      visual={(api) => <Visual api={api} />}
      caption="A simplified model drawn for this page. Drag it to turn it."
    />
  );
}
