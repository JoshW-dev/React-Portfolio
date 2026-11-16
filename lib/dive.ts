/*
  The dive: a click on a ring in the film zooms the film into the ring, and the project page
  opens on its hero frame zoomed into the same point, which then eases back out.

  FilmScroll sets the dive before it navigates. HeroFrame takes it once on mount and waits for
  the page transition to show the new page before it eases out. Both run in one document, so
  this module's state carries across the navigation.
*/

export type Dive = {
  /** The ring's point, as shares of the picture's width and height. */
  x: number;
  y: number;
  /** How far the film zoomed in. */
  scale: number;
  at: number;
};

let pending: Dive | null = null;
let shown: Promise<unknown> = Promise.resolve();

export function setDive(d: Dive) {
  pending = d;
}

/** The dive for the page that just opened, if it came from a ring a moment ago. */
export function takeDive(): Dive | null {
  const d = pending;
  pending = null;
  return d && performance.now() - d.at < 4000 ? d : null;
}

/** Set by TransitionLink: settles when the page transition starts showing the new page. */
export function setShown(p: Promise<unknown>) {
  shown = p.catch(() => undefined);
}

export function whenShown() {
  return shown;
}
