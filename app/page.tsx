import Link from "next/link";
import Portrait from "@/components/Portrait";
import ProjectGrid from "@/components/ProjectGrid";
import Stage, { type Slide } from "@/components/Stage";
import { mediaFor } from "@/lib/media";
import { stage, work } from "@/lib/work";
import styles from "./home.module.css";

const jobs = [
  {
    years: "2026 to now",
    role: "Senior software engineer, AI",
    place: "GovTech startup, backed by Y Combinator",
    note: "Voice and chat agents that answer residents\u2019 questions, on phone lines that take more than 100,000 calls a year.",
  },
  {
    years: "2023 to 2026",
    role: "AI growth engineer",
    place: "Disco",
    note: "Built the AI course builder and the automation behind sales and marketing. Cut chat response times 75% and cost 58%.",
  },
  {
    years: "2021 to 2023",
    role: "Engineering consultant",
    place: "Energy and manufacturing projects",
    note: "Led the design sessions that cut $300M+ from a hydrogen plant\u2019s budget, and cut downtime 35% on two production lines.",
  },
  {
    years: "2020 to 2021",
    role: "Chief technical officer, satellite project",
    place: "Queen\u2019s Space Engineering Team",
    note: "Led 35 students designing and building a CubeSat.",
  },
  {
    years: "2019 to 2020",
    role: "Software developer",
    place: "Centre for Advanced Computing",
    note: "Led the build and launch of a mental health startup\u2019s web platform in four months.",
  },
  {
    years: "2016 to 2021",
    role: "B.A.Sc., Computer Engineering and Applied Mathematics",
    place: "Queen\u2019s University",
    note: "",
  },
];

export default function Home() {
  const slides: Slide[] = stage.flatMap((slug) => {
    const item = work.find((w) => w.slug === slug);
    if (!item?.image) return [];
    const media = mediaFor(slug);
    return [
      {
        slug,
        title: item.title,
        summary: item.summary,
        kind: item.kind,
        image: media.hero ? { ...media.hero, alt: item.image.alt } : item.image,
        video: media.video,
      },
    ];
  });

  const more = work.filter((w) => !stage.includes(w.slug)).slice(0, 9);

  return (
    <>
      <section className={`wrap ${styles.top}`}>
        <div className={styles.intro}>
          <h1 className={styles.hello}>Hi, I&rsquo;m Josh.</h1>
          <p className="lede">
            I&rsquo;m an AI engineer in Toronto. I build voice and chat agents at work, and on my
            own time I make products, research projects, games and the odd painting. Here are
            some of them.
          </p>
        </div>
        <Stage slides={slides} />
      </section>

      <section className={`wrap ${styles.more}`}>
        <div className={styles.head}>
          <h2 className="h2">More projects</h2>
          <Link className="link" href="/projects">
            See all {work.length}
          </Link>
        </div>
        <ProjectGrid items={more} />
        <p className={styles.all}>
          <Link className="btn" href="/projects">
            See all {work.length} projects
          </Link>
        </p>
      </section>

      <section className="wrap section rule">
        <div className={styles.about}>
          <figure className={styles.portrait}>
            <Portrait className={styles.photo} />
            <figcaption className="small muted">
              The background moves on the shader I wrote for{" "}
              <Link className="link" href="/projects/in-search-of-light">
                In Search of Light
              </Link>
              .
            </figcaption>
          </figure>
          <div className={styles.aboutText}>
            <h2 className="h2">About me</h2>
            <div className="prose">
              <p>
                I studied computer engineering and applied math at Queen&rsquo;s, and spent my
                last year there as CTO of a 35-student team building a satellite. After school I
                worked as an engineering consultant on a hydrogen plant, a ship refit and a
                couple of factory lines, then moved into AI at Disco, an ed-tech startup.
              </p>
              <p>
                These days I build voice and chat agents for local governments at a Y
                Combinator-backed startup. Outside of work I&rsquo;m usually making something,
                and lately that&rsquo;s been games and a simulation of how societies form. I
                also paint, mostly by pouring acrylics and seeing what gravity does.
              </p>
            </div>
            <Link className="link" href="/about">
              More about me
            </Link>
          </div>
        </div>
      </section>

      <section className="wrap section rule">
        <div className={styles.head}>
          <h2 className="h2">Experience</h2>
          <Link className="link" href="/resume">
            Read the resume
          </Link>
        </div>
        <ol className={styles.jobs}>
          {jobs.map((job) => (
            <li key={job.years + job.role}>
              <span className={`muted ${styles.years}`}>{job.years}</span>
              <span className={styles.role}>
                <strong>{job.role}</strong>
                <span className="muted">{job.place}</span>
              </span>
              <span className={styles.result}>{job.note}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
