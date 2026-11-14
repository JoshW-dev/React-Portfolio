/*
  The scroll film on the home page: the stops it holds on, and the hops that fly between them.
  components/FilmScroll.tsx plays it. The scroll sets where the film should be, and a playhead
  follows at a speed that keeps every flight watchable, waiting at a clip until it has loaded.

  To add a clip to a hop:
    1. scripts/film-encode.sh <source.mp4> <name>   (writes public/film/clips/<name>-*)
    2. On that hop below, set kind "video" and clip "<name>".
  A hop with no clip, or whose files are missing, falls back to a still cross-fade.

  The first stop is the live planet with the CubeSat, framed exactly as the first clip's
  first frame. Its still is that frame, used by reduced motion and when WebGL can't run.

  A pass stop is a place the film flies through without resting: a short hold that blends
  one clip's last frame into the next clip's first frame. Its words ride along on the flight.

  Hotspots (spots) are rings on things in a stop's picture that open a project. x and y are
  shares of the picture's width and height, read off the frame the hold shows.
*/

export type Stop = {
  /** The stop's own frame, used by the still fallback and reduced motion. */
  still: string;
  place: string;
  /** The stop's name on the side map, a word or two. */
  short: string;
  /** The caption. A pass stop has none. */
  text?: string;
  /** The project this stop opens, as the caption's button. */
  link?: { href: string; label: string };
  /** Up to two hotspots on things in the picture, each opening a project. */
  spots?: Spot[];
  /** Flown through without a rest or a push-in; its words show during the flight. */
  pass?: boolean;
};

export type Spot = {
  /** Where the thing is, as shares of the picture's width and height. */
  x: number;
  y: number;
  label: string;
  href: string;
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
    short: "Orbit",
    text: "Hi, I’m Josh. I’m an AI engineer, and I’ve built things in a lot of places. Scroll and I’ll take you to them.",
  },
  {
    still: "/film/02-rockies.webp",
    link: { href: "/projects/ai-education-assistant", label: "Open the education assistant project" },
    spots: [{ x: 0.6, y: 0.27, label: "AI tutor, 2019", href: "/projects/ai-education-assistant" }],
    place: "Alberta, Canada",
    short: "Alberta",
    text: "In 2019, three years before ChatGPT, I built an AI tutor for the University of Alberta. It wrote quiz questions from course material and answered students\u2019 questions.",
  },
  {
    still: "/film/03-plant.webp",
    link: { href: "/projects/hydrogen-plant", label: "Open the hydrogen plant project" },
    spots: [{ x: 0.458, y: 0.25, label: "Clean hydrogen plant", href: "/projects/hydrogen-plant" }],
    place: "Hydrogen plant, Alberta",
    short: "Hydrogen plant",
    text: "After school I moved to Alberta as an engineering consultant. The design sessions I led on a clean hydrogen plant cut more than $300M from its budget.",
  },
  {
    still: "/film/04-line.webp",
    link: { href: "/projects/production-lines", label: "Open the production lines project" },
    spots: [{ x: 0.46, y: 0.15, label: "Two production lines", href: "/projects/production-lines" }],
    place: "Production lines, Texas and California",
    short: "Production lines",
    text: "On two production lines we cut downtime 35% in 8 weeks.",
  },
  {
    still: "/film/05-twin.webp",
    link: { href: "/projects/disco", label: "Open the Disco project" },
    spots: [{ x: 0.457, y: 0.14, label: "Disco", href: "/projects/disco" }],
    place: "The same line, as software",
    short: "Disco",
    text: "Then I moved to the software side. At Disco I built AI features and the automation behind sales and marketing, across more than 80,000 contacts.",
  },
  {
    still: "/film/06-sf.webp",
    link: { href: "/projects/alltus", label: "Open the Alltus project" },
    spots: [{ x: 0.612, y: 0.35, label: "Alltus", href: "/projects/alltus" }],
    place: "San Francisco Bay",
    short: "San Francisco",
    text: "Now I work at Alltus, which makes AI for local government.",
  },
  {
    still: "/film/07-towns.webp",
    link: { href: "/projects/alltus", label: "Open the Alltus project" },
    spots: [
      { x: 0.868, y: 0.665, label: "Alltus", href: "/projects/alltus" },
      { x: 0.597, y: 0.582, label: "Crimsonlead", href: "/projects/crimsonlead" },
    ],
    place: "Counties across the U.S.",
    short: "Counties",
    text: "Our agents answer phone lines that take more than 100,000 calls a year, and one deployment helped run elections in North Carolina.",
  },
  {
    still: "/film/08-nyc.webp",
    link: { href: "/projects", label: "See all my projects" },
    spots: [
      { x: 0.57, y: 0.205, label: "Bottleneck Radar", href: "/projects/bottleneck-radar" },
      { x: 0.414, y: 0.4, label: "Insider Signal", href: "/projects/insider-signal" },
    ],
    place: "New York, at night",
    short: "New York",
    text: "Nights are for my own projects: products, research, games and art.",
  },
  {
    still: "/film/09-doha.webp",
    link: { href: "/about", label: "More about me" },
    spots: [{ x: 0.54, y: 0.37, label: "About me", href: "/about" }],
    place: "Doha, November 2026",
    short: "Doha",
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
