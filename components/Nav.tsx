import TransitionLink from "@/components/TransitionLink";
import { nav, site } from "@/lib/site";
import styles from "./Nav.module.css";

export default function Nav() {
  return (
    <header className={styles.bar}>
      <div className={`wrap ${styles.row}`}>
        <TransitionLink href="/" className={styles.mark} aria-label={`${site.name}, home`}>
          {site.name}
        </TransitionLink>
        <nav aria-label="Main">
          <ul className={styles.links}>
            {nav.map((item) => (
              <li key={item.href}>
                <TransitionLink href={item.href}>{item.label}</TransitionLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
