import React from "react";
import { Container, Row, Col } from "react-bootstrap";
import Particle from "../Particle";
import Github from "./Github";
import Techstack from "./Techstack";
import Aboutcard from "./AboutCard";
import laptopImg from "../../Assets/about.webp";
import Toolstack from "./Toolstack";
import Reveal from "../Reveal";
import useSpotlight from "../../hooks/useSpotlight";

function About() {
  const bioRef = useSpotlight();

  return (
    <Container fluid className="about-section">
      <Particle />
      <Container>
        <Row style={{ justifyContent: "center" }}>
          <Col md={7} className="pb-4">
            <Reveal>
              <div className="glass glass-panel" ref={bioRef}>
                <span className="eyebrow">
                  <span className="dot" />
                  Bio
                </span>
                <h1 className="section__title">Know who I am</h1>
                <Aboutcard />
              </div>
            </Reveal>
          </Col>
          <Col md={5} className="about-img pb-4">
            <Reveal delay={120}>
              <img src={laptopImg} alt="" className="img-fluid rotating" />
            </Reveal>
          </Col>
        </Row>

        <Reveal className="section__head">
          <span className="eyebrow">Skillset</span>
          <h2 className="project-heading section__title">
            Professional <strong className="gold">Skillset</strong>
          </h2>
        </Reveal>

        <Techstack />

        <Reveal className="section__head">
          <span className="eyebrow">Toolbox</span>
          <h2 className="project-heading section__title">
            <strong className="gold">Tools</strong> I use
          </h2>
        </Reveal>

        <Toolstack />

        <Reveal className="section__head">
          <span className="eyebrow">Open source</span>
          <h2 className="project-heading section__title">
            Days I <strong className="gold">Code</strong>
          </h2>
        </Reveal>

        <Github />
      </Container>
    </Container>
  );
}

export default About;
