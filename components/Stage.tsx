"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./Stage.module.css";

export type Slide = {
  slug: string;
  title: string;
  summary: string;
  kind: string;
  image: { src: string; width: number; height: number; alt: string };
  video?: string;
};

/*
  One project at a time, like a screen in a gallery. The bar under the active
  name is the timer: when its animation ends the next project comes up, so the
  bar and the change can't drift apart, and pausing the bar pauses the show.
*/
export default function Stage({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hover, setHover] = useState(false);
  const [seen, setSeen] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const running = playing && !hover && seen;
  const slide = slides[index];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), {
      threshold: 0.25,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    setVideoReady(false);
  }, [index]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (seen && playing) video.play().catch(() => {});
    else video.pause();
  }, [seen, playing, index]);

  const go = (i: number) => setIndex((i + slides.length) % slides.length);

  return (
    <div
      className={styles.stage}
      ref={wrapRef}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(index + 1);
        if (e.key === "ArrowLeft") go(index - 1);
      }}
    >
      <div className={styles.frame}>
        {slides.map((s, i) => (
          <div
            key={s.slug}
            aria-hidden="true"
            className={styles.glow}
            data-active={i === index}
            style={{
              backgroundImage: `url(/_next/image?url=${encodeURIComponent(s.image.src)}&w=64&q=75)`,
            }}
          />
        ))}

        <Link
          href={`/projects/${slide.slug}`}
          className={styles.screen}
          aria-label={`${slide.title}: open the project`}
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => setHover(false)}
        >
          {slides.map((s, i) => (
            <div
              key={s.slug}
              className={styles.slide}
              data-active={i === index}
              data-still={!s.video}
            >
              <Image
                src={s.image.src}
                alt={i === index ? s.image.alt : ""}
                width={s.image.width}
                height={s.image.height}
                sizes="(max-width: 1400px) 100vw, 1272px"
                preload={i === 0}
                loading={i === 0 ? "eager" : "lazy"}
                className={styles.media}
              />
              {i === index && s.video ? (
                <video
                  ref={videoRef}
                  key={s.video}
                  className={styles.media}
                  data-ready={videoReady}
                  src={s.video}
                  muted
                  loop
                  playsInline
                  autoPlay
                  preload="auto"
                  onCanPlay={() => setVideoReady(true)}
                />
              ) : null}
            </div>
          ))}
        </Link>
      </div>

      <div className={styles.caption}>
        <div className={styles.words} key={slide.slug}>
          <h2 className={styles.title}>
            <Link href={`/projects/${slide.slug}`}>{slide.title}</Link>
          </h2>
          <p className={styles.summary}>{slide.summary}</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause the slideshow" : "Play the slideshow"}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <Link className="btn" href={`/projects/${slide.slug}`}>
            View project
          </Link>
        </div>
      </div>

      <ol className={styles.tabs}>
        {slides.map((s, i) => (
          <li key={s.slug}>
            <button
              type="button"
              className={styles.tab}
              aria-current={i === index ? "true" : undefined}
              onClick={() => go(i)}
            >
              <span className={styles.bar}>
                {i === index ? (
                  <span
                    key={`${s.slug}-${playing}`}
                    className={styles.fill}
                    data-running={running}
                    data-on={playing}
                    onAnimationEnd={() => {
                      if (playing) go(index + 1);
                    }}
                  />
                ) : null}
              </span>
              <span className={styles.name}>{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
