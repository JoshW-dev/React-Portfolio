"use client";

import { useRef } from "react";
import ScrollBreakdown, {
  BreakdownCanvas,
  type BreakdownApi,
  type BreakdownStep,
  type SceneFactory,
} from "@/components/breakdown/ScrollBreakdown";
import type { EducationDom, NoteKey } from "./educationScene";
import styles from "./EducationBreakdown.module.css";

const STEPS: BreakdownStep[] = [
  {
    id: "material",
    title: "It starts with course material",
    body: (
      <p>
        In 2019 I directed the design and full-stack build of a pilot AI tutor for the University of
        Alberta, made at Queen&rsquo;s University&rsquo;s Centre for Advanced Computing with IBM. That
        was three years before ChatGPT came out. Everything the tutor did started from a
        course&rsquo;s own material.
      </p>
    ),
  },
  {
    id: "ideas",
    title: "Pulling out the key ideas",
    body: (
      <p>
        A Python NLP engine reads the material, and Watson NLU, part of IBM Watson, analyzes the same
        text to pull out its metadata. Between them they pick out the key ideas on the page.
      </p>
    ),
  },
  {
    id: "quiz",
    title: "Ideas become quiz questions",
    body: (
      <p>
        The Content Generation service turns those ideas into quiz questions. It&rsquo;s one of three
        Node.js microservices, each running in Docker containers on Kubernetes.
      </p>
    ),
  },
  {
    id: "tutor",
    title: "A student asks, and the tutor answers",
    body: (
      <p>
        When a student asks the tutor something, the Conversation Generation service works with
        Watson Assistant, which handles the chatbot&rsquo;s conversation and its training, to reply
        the way a tutor would.
      </p>
    ),
  },
  {
    id: "system",
    title: "The whole system",
    body: (
      <p>
        Students and educators each get their own view in the React front end, and Nginx sits in
        front of it for security and caching. Behind it are the three microservices, with MongoDB as
        the central database. They call on the NLP engine and on Watson, with Watson Discovery
        handling and storing the data.
      </p>
    ),
  },
];

/**
 * free: sits on the white page, so it gets a white ground. wrap: one word a line on a phone.
 * split: one word a line everywhere, to fit on top of its block.
 */
const NOTES: { key: NoteKey; text: string; free?: boolean; wrap?: boolean; split?: boolean }[] = [
  { key: "page", text: "Course material", free: true },
  { key: "ideas", text: "Key ideas", free: true },
  { key: "nlp", text: "Python NLP", wrap: true },
  { key: "nlu", text: "Watson NLU", wrap: true },
  { key: "content", text: "Content Generation", split: true },
  { key: "quiz", text: "Quiz questions", free: true },
  { key: "response", text: "Response Extraction", split: true },
  { key: "conversation", text: "Conversation Generation", split: true },
  { key: "assistant", text: "Watson Assistant", wrap: true },
  { key: "watson", text: "IBM Watson", free: true },
  { key: "tileNlu", text: "NLU" },
  { key: "tileDiscovery", text: "Discovery" },
  { key: "tileAssistant", text: "Assistant" },
  { key: "students", text: "Students", free: true },
  { key: "educators", text: "Educators", free: true },
  { key: "react", text: "React", free: true },
  { key: "nginx", text: "Nginx", free: true },
  { key: "kube", text: "Node.js on Kubernetes", free: true },
  { key: "mongo", text: "MongoDB", free: true },
];

function collect(notes: Partial<Record<NoteKey, HTMLSpanElement>>): EducationDom {
  const out = {} as Record<NoteKey, HTMLElement>;
  for (const { key } of NOTES) {
    const el = notes[key];
    if (!el) throw new Error(`Education overlay is missing ${key}`);
    out[key] = el;
  }
  return { notes: out };
}

function Visual({ api }: { api: BreakdownApi }) {
  const notes = useRef<Partial<Record<NoteKey, HTMLSpanElement>>>({});

  const load = async (): Promise<SceneFactory> => {
    const [mod, seg, geo, mat] = await Promise.all([
      import("./educationScene"),
      import("three/examples/jsm/lines/LineSegments2.js"),
      import("three/examples/jsm/lines/LineSegmentsGeometry.js"),
      import("three/examples/jsm/lines/LineMaterial.js"),
    ]);
    const fat = { LineSegments2: seg.LineSegments2, LineSegmentsGeometry: geo.LineSegmentsGeometry, LineMaterial: mat.LineMaterial };
    return (T, ctx) => mod.createEducationBreakdown(T, ctx, collect(notes.current), fat);
  };

  return (
    <BreakdownCanvas api={api} load={load} fallback="The 3D drawing of the platform needs WebGL." className={styles.host}>
      {NOTES.map((n) => (
        <span
          key={n.key}
          className={[styles.note, n.free && styles.free, n.wrap && styles.wrap, n.split && styles.split].filter(Boolean).join(" ")}
          aria-hidden="true"
          ref={(el) => {
            if (el) notes.current[n.key] = el;
          }}
        >
          {n.text}
        </span>
      ))}
    </BreakdownCanvas>
  );
}

/** The AI Education Assistant's scroll breakdown: one page of course material followed through the platform. */
export default function EducationBreakdown({ className }: { className?: string }) {
  return (
    <ScrollBreakdown
      className={className}
      label="How course material becomes quiz questions and tutor replies"
      steps={STEPS}
      visual={(api) => <Visual api={api} />}
      caption="A simplified model drawn for this page. Drag it to turn it."
    />
  );
}
