import type { Metadata } from "next";
import Image from "next/image";
import Link from "@/components/TransitionLink";
import { formatRange, spans } from "@/components/CareerTrace";
import { site } from "@/lib/site";
import styles from "./resume.module.css";

export const metadata: Metadata = {
  title: "Resume",
  description:
    "Josh Wade's resume as a customer-facing AI engineer, with a PDF to download.",
  alternates: { canonical: "/resume" },
};

const pages = [
  { src: "/img/resume-1.webp", alt: "Josh Wade’s resume, page 1 of 2" },
  { src: "/img/resume-2.webp", alt: "Josh Wade’s resume, page 2 of 2" },
];

export default function ResumePage() {
  // Newest first, the way a resume reads.
  const roles = [...spans].reverse();

  return (
    <section className={`wrap ${styles.page}`}>
      <h1 className="title">Resume</h1>

      <div className={styles.actions}>
        <a className="btn" href={site.resumePdf} download>
          Download the PDF
        </a>
        <Link className={`link ${styles.short}`} href="/about">
          Read the short version
        </Link>
      </div>

      <div className={styles.sheets}>
        {pages.map((p, i) => (
          <div key={p.src} className={styles.frame}>
            <Image
              src={p.src}
              width={1445}
              height={1870}
              sizes="(max-width: 960px) 100vw, 880px"
              alt={p.alt}
              priority={i === 0}
              className={styles.sheet}
            />
          </div>
        ))}
      </div>

      <section className="sr" aria-labelledby="resume-text">
        <h2 id="resume-text">Resume in plain text</h2>
        <ul>
          {roles.map((r) => (
            <li key={r.name}>
              <h3>{r.name}</h3>
              <p>
                {r.role}. {formatRange(r)}.
              </p>
              {r.result && <p>{r.result}</p>}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
