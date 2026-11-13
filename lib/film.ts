/*
  The scroll film on /film: the stops it holds on, and the hops that fly between them.

  To add a clip to a hop:
    1. scripts/film-encode.sh <source.mp4> <name>   (writes public/film/clips/<name>-*)
    2. On that hop below, set kind "video" and clip "<name>".
  A hop with no clip, or whose files are missing, falls back to a still cross-fade.
*/

export type Stop = {
  /** The stop's own frame, used by the still fallback and reduced motion. */
  still: string;
  place: string;
  text: string;
  /** The project this stop opens. */
  link?: { href: string; label: string };
};

export type Veil = "cloud" | "steam" | "fog" | "dark";

export type Hop = {
  from: number;
  to: number;
  /** "video" scrubs the clip, "wipe" reveals the next frame from the left, "fade" cross-fades. */
  kind: "video" | "wipe" | "fade";
  /** Base name of the clip in public/film/clips (from scripts/film-encode.sh). */
  clip?: string;
  /** Colour the still fade passes through. Not used while a clip plays. */
  veil?: Veil;
};

export const STOPS: Stop[] = [
  {
    still: "/film/00-orbit-live.webp",
    link: { href: "/projects/cubesat", label: "Open the CubeSat project" },
    place: "Low Earth orbit",
    text: "Hi, I’m Josh. I’m an AI engineer, and I’ve built things in a lot of places. Scroll and I’ll take you to them.",
  },
  {
    still: "/film/02-rockies.webp",
    place: "Alberta Rockies",
    text: "After school I moved to Alberta and spent two years as an engineering consultant.",
  },
  {
    still: "/film/03-plant.webp",
    link: { href: "/projects/hydrogen-plant", label: "Open the hydrogen plant project" },
    place: "Hydrogen plant, Alberta",
    text: "On a clean hydrogen plant, the design sessions I led cut more than $300M from the capital budget.",
  },
  {
    still: "/film/04-line.webp",
    link: { href: "/projects/production-lines", label: "Open the production lines project" },
    place: "Production lines, Texas and California",
    text: "On two production lines we cut downtime 35% in 8 weeks.",
  },
  {
    still: "/film/05-twin.webp",
    link: { href: "/projects/disco", label: "Open the Disco project" },
    place: "The same line, as software",
    text: "Then I moved to the software side. At Disco I built AI features and the automation behind sales and marketing, across more than 80,000 contacts.",
  },
  {
    still: "/film/06-sf.webp",
    link: { href: "/projects/alltus", label: "Open the Alltus project" },
    place: "San Francisco Bay",
    text: "Now I work at Alltus, which makes AI for local government.",
  },
  {
    still: "/film/07-towns.webp",
    link: { href: "/projects/alltus", label: "Open the Alltus project" },
    place: "Counties across the U.S.",
    text: "Our agents answer phone lines that take more than 100,000 calls a year, and one deployment helped run elections in North Carolina.",
  },
  {
    still: "/film/08-nyc.webp",
    link: { href: "/projects", label: "See all my projects" },
    place: "New York, at night",
    text: "Nights are for my own projects: products, research, games and art.",
  },
  {
    still: "/film/09-doha.webp",
    link: { href: "/about", label: "More about me" },
    place: "Doha, November 2026",
    text: "I’m writing this from Doha. I’m based in Toronto and usually somewhere else.",
  },
];

/** One hop per pair of neighbouring stops, in order. */
export const HOPS: Hop[] = [
  { from: 0, to: 1, kind: "video", clip: "orbit-rockies" },
  { from: 1, to: 2, kind: "fade" },
  { from: 2, to: 3, kind: "fade", veil: "steam" },
  { from: 3, to: 4, kind: "wipe" }, // the real line turns into its model; stays a wipe
  { from: 4, to: 5, kind: "fade", veil: "fog" },
  { from: 5, to: 6, kind: "fade" },
  { from: 6, to: 7, kind: "fade" },
  { from: 7, to: 8, kind: "fade", veil: "dark" },
];

export const VEILS: Record<Veil, string> = {
  cloud: "#f4f6f8",
  steam: "#ffffff",
  fog: "#8b98a8",
  dark: "#05070b",
};

/** Scroll distance of each part, in viewport heights. */
export const SCROLL = {
  /** The opening hold on the live Earth, shorter so the first scroll starts moving. */
  firstHold: 40,
  hold: 70,
  video: 170,
  fade: 100,
  wipe: 110,
};

/** Seconds the tour spends on each part. A clip plays at its own length when known. */
export const TOUR = {
  hold: 2.5,
  video: 10,
  fade: 3,
  wipe: 4,
};

export const clipFile = (clip: string, part: "d.mp4" | "m.mp4" | "first.webp" | "last.webp") =>
  `/film/clips/${clip}-${part}`;
