import type { Metadata } from "next";
import { work, kinds } from "@/lib/work";
import Browser from "./Browser";
import styles from "./work.module.css";

export const metadata: Metadata = {
  title: "Work",
  description:
    "Projects by Josh Wade, from voice agents on government phone lines to browser games and paintings.",
  alternates: { canonical: "/work" },
};

export default function WorkPage() {
  return (
    <div className="wrap section--tight">
      <header className={styles.head}>
        <h1 className="title">Work</h1>
        <p className={`lede ${styles.lede}`}>
          I&apos;ve put client work at the top and the products I built myself after it, and further
          down are my research and art projects, plus a couple of games.
        </p>
      </header>
      <Browser items={work} kinds={kinds} />
    </div>
  );
}
