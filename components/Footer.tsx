import { site } from "@/lib/site";
import styles from "./Footer.module.css";

export default function Footer() {
  const links = [
    ...(site.email ? [{ label: site.email, href: `mailto:${site.email}` }] : []),
    { label: "LinkedIn", href: site.links.linkedin },
    { label: "GitHub", href: site.links.github },
    { label: "Medium", href: site.links.medium },
  ];

  return (
    <footer id="contact" className={styles.footer}>
      <div className={`wrap rule ${styles.grid}`}>
        <div>
          <h2 className="title">Say hi.</h2>
          <p className={`lede ${styles.note}`}>
            LinkedIn is the easiest place to reach me, and my code is on GitHub.
          </p>
        </div>
        <ul className={styles.links}>
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            </li>
          ))}
          <li>
            <a href={site.resumePdf}>Resume (PDF)</a>
          </li>
        </ul>
      </div>
      <div className={`wrap ${styles.base}`}>
        <span>{site.name}</span>
        <span>Earth imagery: NASA Visible Earth</span>
        <span>{site.location}</span>
      </div>
    </footer>
  );
}
