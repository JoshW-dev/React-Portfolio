import React, { useMemo } from "react";
import Particles from "react-tsparticles";

function Particle() {
  // Fewer particles on phones, none at all if the visitor asked for less
  // motion. Interactivity stays off so taps always reach the content.
  const { count, animate } = useMemo(() => {
    if (typeof window === "undefined") return { count: 120, animate: true };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.innerWidth < 768;
    return { count: reduced ? 0 : small ? 45 : 140, animate: !reduced };
  }, []);

  if (!count) return null;

  return (
    <Particles
      id="tsparticles"
      params={{
        fpsLimit: 60,
        particles: {
          number: {
            value: count,
            density: { enable: true, value_area: 1500 },
          },
          color: { value: ["#ffffff", "#ffcb74"] },
          line_linked: { enable: false },
          move: {
            direction: "right",
            speed: 0.05,
            enable: animate,
          },
          size: { value: 1.2, random: true },
          opacity: {
            value: 0.5,
            random: true,
            anim: { enable: animate, speed: 1, opacity_min: 0.05 },
          },
        },
        interactivity: {
          events: {
            onclick: { enable: false },
            onhover: { enable: false },
          },
        },
        retina_detect: true,
      }}
    />
  );
}

export default Particle;
