import fs from "node:fs";
import path from "node:path";

const pub = path.join(process.cwd(), "public");
const has = (file: string) => fs.existsSync(path.join(pub, file));

/*
  Projects whose live site no longer matches what the project page says. Their
  older capture stays until Josh decides which one is right.
*/
const hold = new Set(["openaffect"]);

/** Optional richer media for a project: a looping clip and a sharper still. Server only. */
export function mediaFor(slug: string) {
  if (hold.has(slug)) return { video: undefined, hero: undefined };
  const video = `/work/video/${slug}.mp4`;
  const hero = `/work/hero/${slug}.webp`;
  return {
    video: has(video) ? video : undefined,
    hero: has(hero) ? { src: hero, width: 2000, height: 1250 } : undefined,
  };
}
