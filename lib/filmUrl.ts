/*
  Film files load from URLs that carry their content hash (next.config.ts works it out at
  build), and those URLs are cached for a year. The site keeps plain paths everywhere else
  (lib/film.ts, lib/work.ts, the keys of every in-memory store), so comparing two pictures
  never trips on a hash; only the request itself goes through filmUrl().
*/

const versions: Record<string, string> = JSON.parse(process.env.FILM_VERSIONS || "{}");

/** The URL to load a file from: its path with ?v=<content hash>, or the path as it is. */
export function filmUrl(path: string): string {
  const v = versions[path];
  return v ? `${path}?v=${v}` : path;
}
