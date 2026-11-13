/*
  The scroll film on the home page: the stops it holds on, and the hops that fly between them.
  components/FilmScroll.tsx plays it. The scroll sets where the film should be, and a playhead
  follows at a speed that keeps every flight watchable, waiting at a clip until it has loaded.

  To add a clip to a hop:
    1. scripts/film-encode.sh <source.mp4> <name>   (writes public/film/clips/<name>-*)
    2. On that hop below, set kind "video" and clip "<name>".
  A hop with no clip, or whose files are missing, falls back to a still cross-fade.

  The first stop has no picture of its own in the film: it is the first frame of the first
  clip, with the live CubeSat drawn over it. Its still is used by reduced motion.

  A pass stop is a place the film flies through without resting: a short hold that blends
  one clip's last frame into the next clip's first frame, with no words.
*/

export type Stop = {
  /** The stop's own frame, used by the still fallback and reduced motion. */
  still: string;
  place: string;
  /** The caption. A pass stop has none. */
  text?: string;
  /** The project this stop opens. */
  link?: { href: string; label: string };
  /** Up to two more projects that belong to the same place. */
  more?: { href: string; label: string }[];
  /** Flown through without a rest, a caption or a push-in. */
  pass?: boolean;
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
  /** Scroll length in viewport heights, for a clip much longer than the usual 8 seconds. */
  scroll?: number;
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
    pass: true,
  },
  {
    still: "/film/03-plant.webp",
    link: { href: "/projects/hydrogen-plant", label: "Open the hydrogen plant project" },
    place: "Hydrogen plant, Alberta",
    text: "After school I moved to Alberta as an engineering consultant. On a clean hydrogen plant there, the design sessions I led cut more than $300M from the capital budget.",
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
    more: [{ href: "/projects/crimsonlead", label: "Crimsonlead, built on public records" }],
    place: "Counties across the U.S.",
    text: "Our agents answer phone lines that take more than 100,000 calls a year, and one deployment helped run elections in North Carolina.",
  },
  {
    still: "/film/08-nyc.webp",
    link: { href: "/projects", label: "See all my projects" },
    more: [
      { href: "/projects/bottleneck-radar", label: "Bottleneck Radar" },
      { href: "/projects/insider-signal", label: "Insider Signal" },
    ],
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
  { from: 1, to: 2, kind: "video", clip: "rockies-plant" },
  // A 13 second flight from Alberta to Texas, so it gets more scroll than an 8 second hop.
  { from: 2, to: 3, kind: "video", clip: "plant-line", veil: "steam", scroll: 260 },
  { from: 3, to: 4, kind: "wipe" }, // the real line turns into its model; stays a wipe
  { from: 4, to: 5, kind: "video", clip: "twin-sf", veil: "fog" },
  { from: 5, to: 6, kind: "video", clip: "sf-towns" },
  { from: 6, to: 7, kind: "video", clip: "towns-nyc" },
  { from: 7, to: 8, kind: "video", clip: "nyc-doha", veil: "dark" },
];

export const VEILS: Record<Veil, string> = {
  cloud: "#f4f6f8",
  steam: "#ffffff",
  fog: "#8b98a8",
  dark: "#05070b",
};

/**
 * Scroll distance of each part, in viewport heights. These set how far the scroll moves the
 * film. How fast a flight plays is set by the playhead in components/FilmScroll.tsx.
 */
export const SCROLL = {
  /** The opening hold on Earth, shorter so the first scroll starts moving. */
  firstHold: 40,
  hold: 70,
  /** A pass stop's hold: just long enough to blend one clip into the next. */
  pass: 20,
  video: 170,
  fade: 100,
  wipe: 110,
};

/** Clip files: hd (1920 wide), d (1280), m (854), and the first and last frames as stills. */
export type ClipPart = "hd.mp4" | "d.mp4" | "m.mp4" | "first.webp" | "last.webp";

export const clipFile = (clip: string, part: ClipPart) => `/film/clips/${clip}-${part}`;
