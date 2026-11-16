/*
  The hand-off from the film to a project page.

  A ring or a caption button in the film opens its project with the site's top-down wipe. The
  project's hero frames its picture the way the film frames it (the full screen, under
  object-fit: cover), so the wipe changes the words and the shade, and the picture stays put.
  When the film was showing a loop or a moving still that the hero plays too, the hero carries
  it on from the same moment at full strength, from the file the film already loaded.

  FilmScroll sets the hand-off on the click. HeroFrame takes it once on mount and holds the
  film's push-in. Both run in one document, so this module's state carries across the navigation.
*/

export type Handoff = {
  /** The film's push-in on the picture when the link was clicked. */
  scale: number;
  /** The loop that showed at full strength: its base path, the file it played, and where. */
  loop?: { src: string; url: string; time: number };
  /** The moving still that showed at full strength: its map, and its clock in seconds. */
  motion?: { map: string; time: number };
  at: number;
};

let pending: Handoff | null = null;
let shown: Promise<unknown> = Promise.resolve();

export function setHandoff(h: Handoff) {
  pending = h;
}

/** The hand-off for the page that just opened, if a film link was clicked a moment ago. */
export function takeHandoff(): Handoff | null {
  const h = pending;
  pending = null;
  return h && performance.now() - h.at < 4000 ? h : null;
}

/** A moving still's map, the same for the film's arrival frame and the stop's own still. */
export const sameMotion = (a: string, b: string) => a.replace(/-still\.png$/, ".png") === b.replace(/-still\.png$/, ".png");

/** Set by TransitionLink: settles when the page transition starts showing the new page. */
export function setShown(p: Promise<unknown>) {
  shown = p.catch(() => undefined);
}

export function whenShown() {
  return shown;
}
