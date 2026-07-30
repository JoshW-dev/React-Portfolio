import React from "react";
import { Container, Row, Col } from "react-bootstrap";
import { Link } from "react-router-dom";
import {
  AiOutlineArrowRight,
  AiOutlineDown,
  AiFillGithub,
  AiOutlineMedium,
} from "react-icons/ai";
import { FaLinkedinIn } from "react-icons/fa";
import { CgFileDocument } from "react-icons/cg";
import homeLogo from "../../Assets/home-main.webp";
import Particle from "../Particle";
import Home2 from "./Home2";
import FeaturedWork from "./FeaturedWork";
import Type from "./Type";
import Reveal from "../Reveal";

function Home() {
  return (
    <section>
      <Container fluid className="home-section" id="home">
        <Particle />
        <Container className="home-content">
          <Row className="hero-row">
            <Col md={7} className="home-header">
              <Reveal>
                <span className="eyebrow">
                  <span className="dot" />
                  Toronto, Canada
                </span>
              </Reveal>

              <Reveal delay={60}>
                <p className="hero__greeting">
                  Hello there
                  <span className="wave" role="img" aria-label="waving hand">
                    👋🏻
                  </span>
                </p>
              </Reveal>

              <Reveal delay={110} as="h1" className="hero__name">
                I'm
                <strong className="main-name text-gradient">Joshua Wade</strong>
              </Reveal>

              <Reveal delay={170} className="hero__type">
                <Type />
              </Reveal>

              <Reveal delay={220} as="p" className="hero__blurb">
                Designer, developer and engineer with a background in applied
                mathematics, working across AI research and large energy and
                manufacturing projects.
              </Reveal>

              <Reveal delay={280} className="btn-row hero__actions">
                <Link to="/projects" className="btn-solid">
                  See my work
                  <AiOutlineArrowRight className="arrow" aria-hidden="true" />
                </Link>
                <Link to="/resume" className="btn-ghost">
                  <CgFileDocument aria-hidden="true" />
                  Resume
                </Link>
              </Reveal>

              <Reveal delay={340} className="hero__socials">
                <a
                  href="https://github.com/JoshW-dev"
                  target="_blank"
                  rel="noreferrer"
                  className="social-btn social-btn--sm"
                  aria-label="GitHub"
                >
                  <AiFillGithub />
                </a>
                <a
                  href="https://www.linkedin.com/in/joshua-f-wade/"
                  target="_blank"
                  rel="noreferrer"
                  className="social-btn social-btn--sm"
                  aria-label="LinkedIn"
                >
                  <FaLinkedinIn />
                </a>
                <a
                  href="https://medium.com/@wadan"
                  target="_blank"
                  rel="noreferrer"
                  className="social-btn social-btn--sm"
                  aria-label="Medium"
                >
                  <AiOutlineMedium />
                </a>
              </Reveal>
            </Col>

            <Col md={5} className="hero__art">
              <span className="hero__halo" aria-hidden="true" />
              <img src={homeLogo} alt="" className="img-fluid" />
            </Col>
          </Row>
        </Container>

        <div className="hero__scroll-cue" aria-hidden="true">
          Scroll
          <AiOutlineDown />
        </div>
      </Container>
      <Home2 />
      <FeaturedWork />
    </section>
  );
}

export default Home;
