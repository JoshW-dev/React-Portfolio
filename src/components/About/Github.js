import React from "react";
import GitHubCalendar from "react-github-calendar";
import { Row } from "react-bootstrap";
import Reveal from "../Reveal";

function Github() {
  return (
    <Row style={{ justifyContent: "center", paddingBottom: "10px" }}>
      <Reveal className="glass github-panel">
        <GitHubCalendar
          username="joshW-dev"
          blockSize={12}
          blockMargin={4}
          color="#ffcb74"
          fontSize={14}
        />
      </Reveal>
    </Row>
  );
}

export default Github;
