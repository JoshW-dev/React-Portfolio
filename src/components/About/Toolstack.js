import React from "react";
import { Col, Row } from "react-bootstrap";
import {
  SiVisualstudiocode,
  SiAmazonaws,
  SiTensorflow,
  SiZapier,
  SiAdobephotoshop,
  SiOpenai,
  SiVercel,
} from "react-icons/si";
import { ClaudeIcon, N8nIcon, MakeIcon, McpIcon, ApifyIcon } from "./BrandIcons";

function Toolstack() {
  return (
    <Row style={{ justifyContent: "center", paddingBottom: "50px" }}>
      <Col xs={4} md={2} className="tech-icons">
        <SiOpenai />
      </Col>
      <Col xs={4} md={2} className="tech-icons">
        <ClaudeIcon />
      </Col>
      <Col xs={4} md={2} className="tech-icons">
        <McpIcon />
      </Col>
      <Col xs={4} md={2} className="tech-icons">
        <N8nIcon />
      </Col>
      <Col xs={4} md={2} className="tech-icons">
        <MakeIcon />
      </Col>
      <Col xs={4} md={2} className="tech-icons">
        <ApifyIcon />
      </Col>
      <Col xs={4} md={2} className="tech-icons">
        <SiVercel />
      </Col>
      <Col xs={4} md={2} className="tech-icons">
        <SiZapier />
      </Col>
      <Col xs={4} md={2} className="tech-icons">
        <SiAmazonaws />
      </Col>
      <Col xs={4} md={2} className="tech-icons">
        <SiVisualstudiocode />
      </Col>
      <Col xs={4} md={2} className="tech-icons">
        <SiTensorflow />
      </Col>
      <Col xs={4} md={2} className="tech-icons">
        <SiAdobephotoshop />
      </Col>
    </Row>
  );
}

export default Toolstack;
