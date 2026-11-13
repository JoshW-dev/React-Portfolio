"use client";

import { useRef } from "react";
import ScrollBreakdown, {
  BreakdownCanvas,
  type BreakdownApi,
  type BreakdownStep,
  type SceneFactory,
} from "@/components/breakdown/ScrollBreakdown";
import type { Callout } from "@/components/breakdown/kit";
import type { BoseDom, CalloutKey, NoteKey, PathKey } from "./boseScene";
import styles from "./BoseBreakdown.module.css";

const STEPS: BreakdownStep[] = [
  {
    id: "sense",
    title: "The glasses know which way they face",
    body: (
      <p>
        Bose Frames have motion sensors in their arms, and the glasses send their orientation to the
        phone over Bluetooth. Each reading comes in as a quaternion, four numbers that together
        describe which way the glasses are pointing in 3D, and everything our app does starts from
        those readings.
      </p>
    ),
  },
  {
    id: "forward",
    title: "Remembering forward",
    body: (
      <p>
        When the app starts, it stores the first reading it gets as forward, and every reading after
        that is compared against it. I multiply the new quaternion by the conjugate of the stored one
        and convert the result to angles, which gives how far the head has turned and tilted away
        from forward. A double tap on the glasses sets forward again to wherever you&rsquo;re facing.
      </p>
    ),
  },
  {
    id: "aware",
    title: "Turn to look, and the music drops",
    body: (
      <p>
        If you turn your head more than 40 degrees to either side, the way you would to look at
        someone talking to you, the app turns the music down so you can hear them. The phone shows
        Aware while you&rsquo;re turned away. Face forward again and the volume goes back to where it
        was, with the phone back on Focused.
      </p>
    ),
  },
  {
    id: "tilt",
    title: "Tilt for volume",
    body: (
      <p>
        The app also reads how far your head leans toward a shoulder. Lean one way and the music gets
        louder, and lean the other way to bring it back down.
      </p>
    ),
  },
  {
    id: "nod",
    title: "Nod to pause",
    body: (
      <p>
        A nod pauses the music, and nodding again starts it back up. Along with the turn and the
        tilt, that lets you run your music hands-free, without touching the phone or saying a word.
      </p>
    ),
  },
];

const CALLOUTS: { key: CalloutKey; text: string }[] = [
  { key: "frames", text: "Bose Frames" },
  { key: "sensors", text: "Motion sensors" },
  { key: "tap", text: "Double tap resets forward" },
];

const NOTES: { key: NoteKey; text: string }[] = [
  { key: "bluetooth", text: "Bluetooth" },
  { key: "forward", text: "Forward" },
  { key: "edgeL", text: "40°" },
  { key: "edgeR", text: "40°" },
  { key: "louder", text: "Louder" },
  { key: "quieter", text: "Quieter" },
  { key: "nod", text: "Nod" },
  { key: "focused", text: "Focused" },
  { key: "aware", text: "Aware" },
  { key: "volume", text: "Volume" },
  { key: "paused", text: "Paused" },
];

/** Drawn behind the canvas, so the head and shoulders sit over them. */
const GROUND: PathKey[] = ["wedgeFill", "wedgeEdge", "angles"];
/** Drawn over the canvas. */
const FRONT: PathKey[] = ["link", "axes", "tap", "forward", "facing", "tiltLeft", "tiltRight", "nod"];

type Refs = {
  paths: Partial<Record<PathKey, SVGPathElement>>;
  lines: Partial<Record<CalloutKey, SVGLineElement>>;
  dots: Partial<Record<CalloutKey, SVGCircleElement>>;
  tags: Partial<Record<CalloutKey, HTMLSpanElement>>;
  notes: Partial<Record<NoteKey, HTMLSpanElement>>;
};

function collect(r: Refs): BoseDom {
  const need = <E,>(el: E | undefined | null, name: string): E => {
    if (!el) throw new Error(`Bose overlay is missing ${name}`);
    return el;
  };
  const paths = {} as Record<PathKey, SVGPathElement>;
  for (const key of [...GROUND, ...FRONT]) paths[key] = need(r.paths[key], key);
  const callouts = {} as Record<CalloutKey, Callout>;
  for (const { key } of CALLOUTS)
    callouts[key] = { el: need(r.tags[key], key), line: need(r.lines[key], key), dot: r.dots[key] ?? null };
  const notes = {} as Record<NoteKey, HTMLElement>;
  for (const { key } of NOTES) notes[key] = need(r.notes[key], key);
  return { paths, callouts, notes };
}

function Visual({ api }: { api: BreakdownApi }) {
  const refs = useRef<Refs>({ paths: {}, lines: {}, dots: {}, tags: {}, notes: {} });
  const r = refs.current;
  const path = (key: PathKey) => (
    <path
      key={key}
      className={styles[key]}
      ref={(el) => {
        if (el) r.paths[key] = el;
      }}
    />
  );

  const load = async (): Promise<SceneFactory> => {
    const [mod, seg, geo, mat] = await Promise.all([
      import("./boseScene"),
      import("three/examples/jsm/lines/LineSegments2.js"),
      import("three/examples/jsm/lines/LineSegmentsGeometry.js"),
      import("three/examples/jsm/lines/LineMaterial.js"),
    ]);
    const fat = { LineSegments2: seg.LineSegments2, LineSegmentsGeometry: geo.LineSegmentsGeometry, LineMaterial: mat.LineMaterial };
    return (T, ctx) => mod.createBoseBreakdown(T, ctx, collect(refs.current), fat);
  };

  return (
    <BreakdownCanvas api={api} load={load} fallback="The 3D drawing of the glasses needs WebGL." className={styles.host}>
      <svg className={styles.ground} aria-hidden="true">
        {GROUND.map(path)}
      </svg>
      <svg className={styles.overlay} aria-hidden="true">
        {FRONT.map(path)}
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

/** The Bose AR project's scroll breakdown: a head in Bose Frames on the left, the five steps on the right. */
export default function BoseBreakdown({ className }: { className?: string }) {
  return (
    <ScrollBreakdown
      className={className}
      label="How a turn of the head becomes a volume change"
      steps={STEPS}
      visual={(api) => <Visual api={api} />}
      caption="A simplified model drawn for this page. Drag it to turn it."
    />
  );
}
