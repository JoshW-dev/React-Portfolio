import React from "react";
import useReveal from "../hooks/useReveal";

/**
 * Wraps children in a element that fades and rises into place on scroll.
 * `delay` staggers siblings; `as` lets it stand in for a section or li.
 */
function Reveal({ as: Tag = "div", delay = 0, className = "", style, children, ...rest }) {
  const [ref, visible] = useReveal();

  return (
    <Tag
      ref={ref}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`.trim()}
      style={{ "--reveal-delay": `${delay}ms`, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export default Reveal;
