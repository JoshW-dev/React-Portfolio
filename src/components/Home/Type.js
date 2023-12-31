import React from "react";
import Typewriter from "typewriter-effect";

function Type() {
  return (
    <Typewriter
      options={{
        strings: [
          "Software Developer",
          "Engineering Consultant",
          "AI Automation Designer",
          "Writer",
          "Artist"
        ],
        autoStart: true,
        loop: true,
        deleteSpeed: 10,
        delay: 50
      }}
    />
  );
}

export default Type;
