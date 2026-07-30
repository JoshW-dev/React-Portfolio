import React from "react";
import { Container, Row, Col } from "react-bootstrap";
import myImg from "../../Assets/avatar.webp";
import Tilt from "react-parallax-tilt";
import {
  AiFillGithub,
  AiFillInstagram,
  AiOutlineMedium,
} from "react-icons/ai";
import { FaLinkedinIn } from "react-icons/fa";
import Reveal from "../Reveal";
import useSpotlight from "../../hooks/useSpotlight";

function Home2() {
  const cardRef = useSpotlight();

  return (
    <Container fluid className="home-about-section" id="about">
      <Container>
        <Reveal>
          <div className="glass glass-panel" ref={cardRef}>
            <Row>
              <Col md={8} className="home-about-description">
                <span className="eyebrow">A quick introduction</span>
                <h1>
                  Welcome to my <span className="gold">Website</span>
                </h1>
                <p className="home-about-body">
                  I am a software developer, engineer, and artist, passionate
                  about using new technology to build ideas and solve complex
                  problems.
                  <br />
                  <br />
                  I am fluent in multiple languages, focused on{" "}
                  <b className="gold">TypeScript, Javascript and Python.</b>
                  <br />
                  Big fan of <b className="gold">React and Node JS</b>
                  <br />
                  <br />
                  I specialize in <b>analyzing data</b> and{" "}
                  <b>developing tools</b> to identify and implement{" "}
                  <b className="gold">key opportunities</b> in tech and
                  engineering projects.
                  <br />
                  <br />
                  I'm passionate about using <b className="gold">AI</b> to solve
                  unique challenges and explore its{" "}
                  <b className="gold">immense potential for humanity.</b>
                </p>
              </Col>
              <Col md={4} className="myAvtar">
                <Tilt tiltMaxAngleX={12} tiltMaxAngleY={12} glareEnable={false}>
                  <img src={myImg} className="img-fluid" alt="avatar" />
                </Tilt>
              </Col>
            </Row>
          </div>
        </Reveal>

        <Row>
          <Col md={12} className="home-about-social">
            <Reveal>
              <h1>Let's get in touch</h1>
              <p>The fastest ways to reach me.</p>
            </Reveal>
            <Reveal delay={80}>
              <ul className="home-about-social-links">
                <li className="social-icons">
                  <a
                    href="https://github.com/JoshW-dev"
                    target="_blank"
                    rel="noreferrer"
                    className="social-btn"
                    aria-label="GitHub"
                  >
                    <AiFillGithub />
                  </a>
                </li>
                <li className="social-icons">
                  <a
                    href="https://medium.com/@wadan"
                    target="_blank"
                    rel="noreferrer"
                    className="social-btn"
                    aria-label="Medium"
                  >
                    <AiOutlineMedium />
                  </a>
                </li>
                <li className="social-icons">
                  <a
                    href="https://www.linkedin.com/in/joshua-f-wade/"
                    target="_blank"
                    rel="noreferrer"
                    className="social-btn"
                    aria-label="LinkedIn"
                  >
                    <FaLinkedinIn />
                  </a>
                </li>
                <li className="social-icons">
                  <a
                    href="https://www.instagram.com/josh.wade_/"
                    target="_blank"
                    rel="noreferrer"
                    className="social-btn"
                    aria-label="Instagram"
                  >
                    <AiFillInstagram />
                  </a>
                </li>
              </ul>
            </Reveal>
          </Col>
        </Row>
      </Container>
    </Container>
  );
}
export default Home2;
