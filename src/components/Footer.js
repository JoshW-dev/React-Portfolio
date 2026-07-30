import React from "react";
import { Container, Row, Col } from "react-bootstrap";
import { AiFillGithub, AiOutlineTwitter, AiOutlineUp } from "react-icons/ai";
import { FaLinkedinIn } from "react-icons/fa";

function Footer() {
  const year = new Date().getFullYear();

  const toTop = () =>
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });

  return (
    <Container fluid className="footer">
      <Container>
        <Row className="footer-row">
          <Col md="4" className="footer-copywright">
            <div className="footer-brand">
              Josh Wade<span>.</span>
            </div>
            <h3>© {year} · Built in Toronto</h3>
          </Col>

          <Col md="4" className="footer-body">
            <ul className="footer-icons">
              <li className="social-icons">
                <a
                  href="https://github.com/JoshW-dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-btn social-btn--sm"
                  aria-label="GitHub"
                >
                  <AiFillGithub />
                </a>
              </li>
              <li className="social-icons">
                <a
                  href="https://twitter.com/ai_adam_"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-btn social-btn--sm"
                  aria-label="Twitter"
                >
                  <AiOutlineTwitter />
                </a>
              </li>
              <li className="social-icons">
                <a
                  href="https://www.linkedin.com/in/joshua-f-wade/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-btn social-btn--sm"
                  aria-label="LinkedIn"
                >
                  <FaLinkedinIn />
                </a>
              </li>
            </ul>
          </Col>

          <Col md="4" className="footer-copywright">
            <button type="button" className="footer-top" onClick={toTop}>
              <AiOutlineUp aria-hidden="true" />
              Back to top
            </button>
          </Col>
        </Row>
      </Container>
    </Container>
  );
}

export default Footer;
