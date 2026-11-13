import Image from "next/image";
import CallFlow from "@/components/CallFlow";
import HoverClip from "@/components/HoverClip";
import TransitionLink from "@/components/TransitionLink";
import { mediaFor } from "@/lib/media";
import type { Work } from "@/lib/work";
import styles from "./ProjectGrid.module.css";

/** Projects as pictures: one tile each, with the name and a line about it underneath. */
export default function ProjectGrid({ items, eager = 0 }: { items: Work[]; eager?: number }) {
  return (
    <ul className={styles.grid}>
      {items.map((item, i) => {
        const media = mediaFor(item.slug);
        return (
        <li key={item.slug}>
          <TransitionLink href={`/projects/${item.slug}`} className={styles.tile}>
            <span className={styles.media}>
              {item.image ? (
                <Image
                  src={item.image.src}
                  alt={item.image.alt}
                  width={item.image.width}
                  height={item.image.height}
                  sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 420px"
                  loading={i < eager ? "eager" : "lazy"}
                />
              ) : (
                <span className={styles.drawing}>
                  <CallFlow />
                </span>
              )}
              {media.video ? <HoverClip src={media.video} /> : null}
            </span>
            <span className={styles.line}>
              <span className={styles.name}>{item.title}</span>
              <span className={styles.kind}>{item.kind}</span>
            </span>
            <span className={styles.summary}>{item.summary}</span>
          </TransitionLink>
        </li>
        );
      })}
    </ul>
  );
}
