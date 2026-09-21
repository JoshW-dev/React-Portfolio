import React from "react";
import Typewriter from "typewriter-effect";

function Type() {
  return (
    <Typewriter
      options={{
        strings: [
          "Customer-Facing AI Engineer",
          "Forward Deployed Engineer",
          "Engineering Consultant",
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
