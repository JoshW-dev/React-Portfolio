import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getWork, work, type Work } from "@/lib/work";
import { site } from "@/lib/site";
import { mediaFor } from "@/lib/media";
import CallReplay from "@/components/CallReplay";
import styles from "./project.module.css";

/** The figure under the title. Returns the project image, or null when there isn't one. */
function Figure({ item }: { item: Work }) {
  if (item.slug === "voice-agents") {
    return (
      <figure className={styles.figure}>
        <CallReplay />
        <figcaption className="small muted">
          A made-up caller with made-up details, replayed to show how a call runs. The real
          agents run on Twilio and ElevenLabs.
        </figcaption>
      </figure>
    );
  }
  if (!item.image) return null;
  const media = mediaFor(item.slug);
  const still = media.hero ?? item.image;
  return (
    <figure className={styles.figure}>
      {media.video ? (
        <video
          className={styles.image}
          src={media.video}
          poster={still.src}
          width={1280}
          height={800}
          muted
          loop
          playsInline
          autoPlay
          aria-label={item.image.alt}
        />
      ) : (
        <Image
          src={still.src}
          alt={item.image.alt}
          width={still.width}
          height={still.height}
          preload
          sizes="(max-width: 1100px) 100vw, 1040px"
          className={styles.image}
        />
      )}
    </figure>
  );
}

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return work.map((w) => ({ slug: w.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = getWork(slug);
  if (!item) return {};
  const path = `/projects/${item.slug}`;
  return {
    title: item.title,
    description: item.summary,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      siteName: site.name,
      locale: "en_CA",
      url: path,
      title: item.title,
      description: item.summary,
      ...(item.image ? { images: [item.image.src] } : {}),
    },
  };
}

export default async function ProjectPage({ params }: Props) {
  const { slug } = await params;
  const item = getWork(slug);
  if (!item) notFound();

  const index = work.findIndex((w) => w.slug === item.slug);
  const next = work[(index + 1) % work.length];

  const facts: { term: string; value: string }[] = [{ term: "Kind", value: item.kind }];
  if (item.industry) facts.push({ term: "Industry", value: item.industry });
  if (item.years) facts.push({ term: "Years", value: item.years });
  if (item.stack?.length) facts.push({ term: "Built with", value: item.stack.join(", ") });

  return (
    <article className="wrap section--tight">
      <Link href="/projects" className={`link small ${styles.back}`}>
        All projects
      </Link>

      <header className={styles.head}>
        <h1 className="title">{item.title}</h1>
        <p className={`lede ${styles.summary}`}>{item.summary}</p>
      </header>

      <Figure item={item} />

      <div className={styles.cols}>
        <aside className={styles.side}>
          <dl className={styles.facts}>
            {facts.map((f) => (
              <div key={f.term} className={styles.fact}>
                <dt className="muted">{f.term}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          {item.links.length > 0 ? (
            <div className={styles.actions}>
              {item.links.map((l, i) => (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noopener"
                  className={i === 0 ? "btn" : "btn btn--quiet"}
                >
                  {l.label}
                </a>
              ))}
            </div>
          ) : null}
        </aside>

        <div className={`prose ${styles.body}`}>
          {item.body.map((p, i) => (
            <p key={i} className={i === 0 ? "lede" : undefined}>
              {p}
            </p>
          ))}
        </div>
      </div>

      <Link href={`/projects/${next.slug}`} className={styles.next}>
        <span className="small muted">Next</span>
        <span className="h2">{next.title}</span>
      </Link>
    </article>
  );
}
