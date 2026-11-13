import Image from "next/image";
import Link from "next/link";
import CallFlow from "@/components/CallFlow";
import CallReplay from "@/components/CallReplay";
import Portrait from "@/components/Portrait";
import WorkIndex from "@/components/WorkIndex";
import { featured, work } from "@/lib/work";
import styles from "./home.module.css";

const proof = [
  {
    value: "100,000+",
    label: "calls a year on the phone lines my agents answer",
    where: "Government",
  },
  {
    value: "$300M+",
    label: "cut from a hydrogen plant's capital budget",
    where: "Energy",
  },
  {
    value: "75%",
    label: "faster replies from an AI chat agent",
    where: "Education",
  },
  {
    value: "58%",
    label: "lower cost to run that same agent",
    where: "Education",
  },
  {
    value: "35%",
    label: "less downtime on two production lines",
    where: "Manufacturing",
  },
];

export default function Home() {
  const rest = work.filter((w) => !w.featured);

  return (
    <>
      <section className={`wrap ${styles.hero}`}>
        <h1 className={`display ${styles.headline}`}>
          <span>AI agents that pick up</span> <span>100,000 calls a year.</span>
        </h1>

        <div className={styles.intro}>
          <p className="lede">
            I&rsquo;m Josh Wade. I build them, and I&rsquo;m the engineer on the call with
            your team from kickoff to go-live.
          </p>
          <div className={styles.actions}>
            <Link className="btn" href="/work">
              See the work
            </Link>
            <Link className="btn btn--quiet" href="/resume">
              Read the resume
            </Link>
          </div>
        </div>

        <div className={styles.replay}>
          <CallReplay />
          <p className={`small muted ${styles.disclosure}`}>
            A made-up caller with made-up details, replayed to show how a call runs. The
            real agents run on Twilio and ElevenLabs.
          </p>
        </div>

        <dl className={styles.proof}>
          {proof.map((p) => (
            <div key={p.value}>
              <dt>{p.value}</dt>
              <dd>{p.label}</dd>
              <dd className="small muted">{p.where}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="wrap section">
        <h2 className="h2">Selected work</h2>
        <div className={styles.studies}>
          {featured.map((item) => (
            <article key={item.slug} className={styles.study}>
              <div className={styles.studyText}>
                <h3 className={styles.studyTitle}>
                  <Link href={`/work/${item.slug}`}>{item.title}</Link>
                </h3>
                <p className="lede">{item.summary}</p>
                <p className="small muted">
                  {item.industry}, {item.years}
                </p>
                <Link className="link" href={`/work/${item.slug}`}>
                  Read the case study
                </Link>
              </div>
              <Link
                href={`/work/${item.slug}`}
                className={styles.studyFigure}
                tabIndex={-1}
                aria-hidden="true"
              >
                {item.image ? (
                  <Image
                    src={item.image.src}
                    alt=""
                    width={item.image.width}
                    height={item.image.height}
                    sizes="(max-width: 900px) 100vw, 720px"
                  />
                ) : (
                  <CallFlow />
                )}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="wrap section rule">
        <div className={styles.indexHead}>
          <h2 className="h2">The rest of what I&rsquo;ve built</h2>
          <Link className="link" href="/work">
            See all {work.length}
          </Link>
        </div>
        <WorkIndex items={rest.slice(0, 8)} />
      </section>

      <section className="wrap section rule">
        <div className={styles.about}>
          <figure className={styles.portrait}>
            <Portrait className={styles.photo} />
            <figcaption className="small muted">
              The sky moves on the shader I wrote for{" "}
              <Link className="link" href="/work/in-search-of-light">
                In Search of Light
              </Link>
              .
            </figcaption>
          </figure>
          <div className={styles.aboutText}>
            <h2 className="h2">Who you&rsquo;d be working with</h2>
            <div className="prose">
              <p className="lede">
                I&rsquo;m a customer-facing AI engineer in Toronto. I write the agent, and
                then I&rsquo;m in the kickoff, the test calls and the go-live with the
                people who&rsquo;ll depend on it.
              </p>
              <p>
                Before this I spent almost three years building AI features at an ed-tech
                startup, and two before that as an engineering consultant on energy and
                manufacturing projects, so I&rsquo;m used to walking into an operation I
                don&rsquo;t know yet.
              </p>
            </div>
            <Link className="link" href="/about">
              More about me
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
