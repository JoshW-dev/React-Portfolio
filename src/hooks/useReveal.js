import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Fades an element in as it enters the viewport and back out once it has left,
 * so scrolling in either direction feels animated.
 *
 * Two observers, because enter and exit want different boundaries: it fades in
 * the moment any part crosses the viewport edge (so you actually see the
 * animation), and only fades out well past the edge. One shared boundary would
 * either hide content that is still on screen or finish the fade before it
 * came into view.
 */
export default function useReveal({ exitMargin = "15% 0px 15% 0px" } = {}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const enter = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          setEntered(true);
        }
      },
      { threshold: 0, rootMargin: "0px" }
    );

    const exit = new IntersectionObserver(
      (entries) => {
        if (entries.every((entry) => !entry.isIntersecting)) setVisible(false);
      },
      { threshold: 0, rootMargin: exitMargin }
    );

    enter.observe(el);
    exit.observe(el);
    return () => {
      enter.disconnect();
      exit.disconnect();
    };
  }, [exitMargin]);

  return [ref, visible, entered];
}
