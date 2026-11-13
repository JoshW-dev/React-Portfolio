import type { Metadata } from "next";
import Link from "next/link";
import Portrait from "@/components/Portrait";
import CareerTrace from "@/components/CareerTrace";
import styles from "./about.module.css";

export const metadata: Metadata = {
  title: "About",
  description:
    "Josh Wade's background, from applied mathematics at Queen's University to building voice and chat agents for government teams.",
  alternates: { canonical: "/about" },
};

const facts = [
  {
    term: "Education",
    value:
      "B.A.Sc., Computer Engineering and Applied Mathematics, with Professional Internship. Queen’s University, 2016 to 2021.",
  },
  {
    term: "Languages I write",
    value: "Python, TypeScript and JavaScript (Node, React), Java, Go.",
  },
  {
    term: "Tools I reach for",
    value: "Claude, Twilio, ElevenLabs, Langfuse, LangChain and LangSmith, Cursor, MATLAB.",
  },
  {
    term: "Languages I speak",
    value: "English (native), French (professional).",
  },
  {
    term: "Hackathons",
    value:
      "Won Bose AR app development at BostonHacks 2019. Won product design at the Secure IoT Hackathon 2020 with Pill-O-Talk.",
  },
  {
    term: "Interests",
    value:
      "Generative AI, information theory, digital education, process automation, AI ethics.",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className={`wrap ${styles.intro}`}>
        <div className={styles.text}>
          <h1 className="title">About me</h1>
          <div className={`prose ${styles.copy}`}>
            <p>
              I&rsquo;m a customer-facing AI engineer from Toronto. Right now I
              work at Alltus, a GovTech company, where I build voice and chat agents that answer residents&rsquo; questions and
              run launches with government teams in Texas and California.
            </p>
            <p>
              Before that I spent almost three years at Disco, an ed-tech
              startup. The AI course builder I designed there helped close
              enterprise deals, and I built the automation their sales and
              marketing teams ran on.
            </p>
            <p>
              I started out as an engineering consultant on energy and
              manufacturing projects. On a clean hydrogen plant, the design
              sessions I led cut more than $300M from the capital budget.
            </p>
            <p>
              My background is in applied mathematics, information theory and
              machine learning, and my first work in AI was research on natural
              language processing and digital education.
            </p>
          </div>
        </div>
        <Portrait className={styles.portrait} priority />
      </section>

      <section className="rule section" aria-labelledby="trace-title">
        <div className="wrap">
          <h2 id="trace-title" className="h2">
            Ten years, as a trace
          </h2>
          <p className={`muted ${styles.how}`}>
            Each bar is a job or a degree, and bars that overlap ran at the same
            time, the way spans do in a call trace.
          </p>
          <div className={styles.trace}>
            <CareerTrace />
          </div>
        </div>
      </section>

      <section className="rule section" aria-labelledby="facts-title">
        <div className="wrap">
          <h2 id="facts-title" className="sr">
            Details
          </h2>
          <dl className={styles.facts}>
            {facts.map((f) => (
              <div key={f.term} className={styles.fact}>
                <dt>{f.term}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="rule section--tight">
        <div className="wrap">
          <p className="lede">
            The projects behind these bars are on the projects page, and my resume
            has the same history with exact dates.
          </p>
          <p className={styles.next}>
            <Link className="link" href="/projects">
              See the projects
            </Link>
            <Link className="link" href="/resume">
              Read the resume
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
