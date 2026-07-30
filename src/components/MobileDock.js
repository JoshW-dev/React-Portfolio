import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AiOutlineHome,
  AiOutlineFundProjectionScreen,
  AiOutlineUser,
} from "react-icons/ai";
import { CgFileDocument } from "react-icons/cg";

const ITEMS = [
  { to: "/", label: "Home", Icon: AiOutlineHome },
  { to: "/projects", label: "Work", Icon: AiOutlineFundProjectionScreen },
  { to: "/about", label: "About", Icon: AiOutlineUser },
  { to: "/resume", label: "Resume", Icon: CgFileDocument },
];

/**
 * Thumb-reachable bottom navigation for phones. It ducks out of the way while
 * you read down a page and slides back the moment you scroll up.
 */
function MobileDock() {
  const { pathname } = useLocation();
  const [hidden, setHidden] = useState(false);

  // A new page always starts with the dock in reach.
  useEffect(() => setHidden(false), [pathname]);

  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;

    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const goingDown = y > lastY;
      const nearTop = y < 140;
      const nearBottom =
        y + window.innerHeight >= document.documentElement.scrollHeight - 80;

      if (Math.abs(y - lastY) > 6) {
        setHidden(goingDown && !nearTop && !nearBottom);
        lastY = y;
      }
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <nav
      className={`dock ${hidden ? "dock--hidden" : ""}`}
      aria-label="Quick navigation"
    >
      <ul className="dock__list">
        {ITEMS.map(({ to, label, Icon }) => {
          const active = pathname === to;
          return (
            <li key={to}>
              <Link
                to={to}
                className={`dock__item ${active ? "dock__item--active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default MobileDock;
