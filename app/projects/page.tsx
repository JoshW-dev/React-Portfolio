import type { Metadata } from "next";
import type { ReactNode } from "react";
import ProjectGrid from "@/components/ProjectGrid";
import { work, kinds } from "@/lib/work";
import Browser from "./Browser";
import styles from "./projects.module.css";

export const metadata: Metadata = {
  title: "Projects",
  description:
    "Everything Josh Wade has built that he can show: products, research, games, art and work projects.",
  alternates: { canonical: "/projects" },
};

export default function ProjectsPage() {
  const views: Record<string, ReactNode> = { All: <ProjectGrid items={work} eager={3} /> };
  for (const kind of kinds) {
    views[kind] = <ProjectGrid items={work.filter((w) => w.kind === kind)} eager={3} />;
  }

  return (
    <div className="wrap section--tight">
      <header className={styles.head}>
        <h1 className="title">Projects</h1>
        <p className={`lede ${styles.lede}`}>
          {work.length} things I&rsquo;ve made, most of them on my own time and a few at work. The
          ones I&rsquo;d show you first are at the top.
        </p>
      </header>
      <Browser kinds={kinds} views={views} />
    </div>
  );
}
