import type { Metadata } from "next";
import Link from "next/link";
import FilmStoryboard from "@/components/FilmStoryboard";
import ProjectGrid from "@/components/ProjectGrid";
import { work } from "@/lib/work";

export const metadata: Metadata = {
  title: "Film storyboard",
  description: "A storyboard for the scroll film on Josh Wade's home page.",
  robots: { index: false, follow: false },
};

export default function FilmPage() {
  return (
    <>
      <FilmStoryboard />
      <section className="wrap section">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "12px 32px",
            marginBottom: "clamp(28px, 3.6vw, 48px)",
          }}
        >
          <h2 className="h2">What I&rsquo;ve built</h2>
          <Link className="link" href="/projects">
            See all {work.length}
          </Link>
        </div>
        <ProjectGrid items={work.slice(0, 12)} />
      </section>
    </>
  );
}
