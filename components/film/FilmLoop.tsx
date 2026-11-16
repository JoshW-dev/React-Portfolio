import type { Ref } from "react";
import type { Loop } from "@/lib/film";
import styles from "./FilmLoop.module.css";

/*
  A cinemagraph loop (scripts/film-loop.py): a short clip of the part of a picture that moves,
  laid over the same spot and shown only through its mask. The picture's box is worked out
  the way object-fit: cover places it, so the loop stays on its spot at any screen shape.
  The parent loads, plays and fades the video; it starts with no source.
*/

/** className places the loop in its parent's stacking order. */
type Props = { loop: Loop; videoRef: Ref<HTMLVideoElement>; className?: string };

export default function FilmLoop({ loop, videoRef, className }: Props) {
  const [x, y, w, h] = loop.box;
  const mask = `url(${loop.src}-mask.png)`;
  const pct = (v: number) => `${(v * 100).toFixed(4)}%`;
  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap} aria-hidden="true">
      <div
        className={styles.frame}
        style={{
          width: `max(100cqw, ${(100 * loop.aspect).toFixed(3)}cqh)`,
          height: `max(100cqh, ${(100 / loop.aspect).toFixed(3)}cqw)`,
        }}
      >
        <video
          ref={videoRef}
          className={styles.video}
          style={{ left: pct(x), top: pct(y), width: pct(w), height: pct(h), maskImage: mask, WebkitMaskImage: mask }}
          muted
          loop
          playsInline
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
        />
      </div>
    </div>
  );
}

/** A loop's video file: "hd" is full size, "m" half. */
export function loopFile(loop: Loop, part: "hd" | "m") {
  return `${loop.src}-${part}.mp4`;
}

/**
 * Starts a loop's video playing: sets its source on first use and rewinds it when it was
 * hidden. "blocked" means the browser won't play it (a phone's low power mode, say);
 * "stopped" means it was paused or unloaded before it started.
 */
export function startLoop(el: HTMLVideoElement, src: string, rewind: boolean, rate = 1): Promise<"playing" | "blocked" | "stopped"> {
  if (!el.getAttribute("src")) el.src = src;
  el.defaultPlaybackRate = rate;
  el.playbackRate = rate;
  if (rewind && el.currentTime > 0) el.currentTime = 0;
  return el.play().then(
    () => "playing" as const,
    (e: unknown) => (e instanceof DOMException && e.name === "AbortError" ? "stopped" : "blocked"),
  );
}
