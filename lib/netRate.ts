/*
  How fast the page's own files have come in, read from the browser's resource timings. The
  film and the planet ask before their first big download, so a slow link starts on the small
  files instead of finding out halfway through a big one.
*/

/** Below this many bits a second, the link counts as slow. */
const SLOW_BITS = 3e6;
/** Too few bytes say nothing about the link. */
const MIN_BYTES = 300_000;

/**
 * Bits a second over the time any response was arriving, so parallel downloads count once
 * and idle gaps don't count. 0 when there is too little to tell (a page from the cache, say).
 */
export function measuredRate(): number {
  if (typeof performance === "undefined") return 0;
  const spans: [number, number][] = [];
  let bytes = 0;
  for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    // transferSize is 0 for a file from the cache; small files mostly measure latency.
    if (e.transferSize < 4000 || !e.responseStart || e.responseEnd <= e.responseStart) continue;
    bytes += e.transferSize;
    spans.push([e.responseStart, e.responseEnd]);
  }
  if (bytes < MIN_BYTES) return 0;
  spans.sort((a, b) => a[0] - b[0]);
  let busy = 0;
  let [from, to] = spans[0];
  for (const [a, b] of spans.slice(1)) {
    if (a > to) {
      busy += to - from;
      [from, to] = [a, b];
    } else to = Math.max(to, b);
  }
  busy += to - from;
  return busy > 0 ? (bytes * 8) / (busy / 1000) : 0;
}

/** True when the page has measured its link as slow. Unknown counts as not slow. */
export function slowLink(): boolean {
  const r = measuredRate();
  return r > 0 && r < SLOW_BITS;
}
