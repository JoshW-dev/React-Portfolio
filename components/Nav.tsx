import Link from "next/link";
import { nav, site } from "@/lib/site";
import styles from "./Nav.module.css";

export default function Nav() {
  return (
    <header className={styles.bar}>
      <div className={`wrap ${styles.row}`}>
        <Link href="/" className={styles.mark} aria-label={`${site.name}, home`}>
          {site.name}
        </Link>
        <nav aria-label="Main">
          <ul className={styles.links}>
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
            <li className={styles.cta}>
              <a href="#contact">Get in touch</a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
