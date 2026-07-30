import React from "react";
import useReveal from "../hooks/useReveal";

/**
 * Wraps children in an element that fades and rises into place on scroll, and
 * fades back out past the viewport edge. `delay` staggers siblings.
 */
function Reveal({ as: Tag = "div", delay = 0, className = "", style, children, ...rest }) {
  const [ref, visible, entered] = useReveal();

  return (
    <Tag
      ref={ref}
      className={[
        "reveal",
        visible ? "is-visible" : "",
        entered ? "has-entered" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--reveal-delay": `${delay}ms`, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export default Reveal;
