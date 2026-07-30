import React, { useState, useEffect, useCallback } from "react";
import Navbar from "react-bootstrap/Navbar";
import Nav from "react-bootstrap/Nav";
import Container from "react-bootstrap/Container";
import logo from "../Assets/logo.png";
import { Link, useLocation } from "react-router-dom";
import { ImBlog } from "react-icons/im";
import {
  AiOutlineHome,
  AiOutlineFundProjectionScreen,
  AiOutlineUser,
  AiOutlineRight,
  AiOutlineArrowRight,
  AiFillGithub,
  AiOutlineMedium,
} from "react-icons/ai";
import { FaLinkedinIn } from "react-icons/fa";
import { HiOutlineSparkles } from "react-icons/hi";
import { CgFileDocument } from "react-icons/cg";

const LINKS = [
  { to: "/", label: "Home", Icon: AiOutlineHome },
  { to: "/about", label: "About", Icon: AiOutlineUser },
  { to: "/projects", label: "Projects", Icon: AiOutlineFundProjectionScreen },
  { to: "/resume", label: "Resume", Icon: CgFileDocument },
];

const EXTERNAL = [
  { href: "https://medium.com/@wadan", label: "Blog", Icon: ImBlog },
  { href: "https://method-ai.com/", label: "Method AI", Icon: HiOutlineSparkles },
];

function NavBar() {
  const [expanded, setExpanded] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  const close = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    function scrollHandler() {
      setScrolled(window.scrollY >= 20);
    }
    scrollHandler();
    window.addEventListener("scroll", scrollHandler, { passive: true });
    return () => window.removeEventListener("scroll", scrollHandler);
  }, []);

  // Close the sheet on navigation and lock the page behind it while open.
  useEffect(close, [pathname, close]);

  useEffect(() => {
    document.body.classList.toggle("nav-open", expanded);
    if (!expanded) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, close]);

  useEffect(() => () => document.body.classList.remove("nav-open"), []);

  return (
    <>
      {expanded && (
        <button
          type="button"
          className="nav-scrim d-lg-none"
          aria-label="Close menu"
          onClick={close}
        />
      )}

      <Navbar
        expanded={expanded}
        fixed="top"
        expand="lg"
        className={scrolled || expanded ? "navbar sticky" : "navbar"}
      >
        <Container>
          <Navbar.Brand as={Link} to="/" onClick={close}>
            <img src={logo} className="img-fluid logo" alt="" />
            <span className="brand-name">
              Josh<span>.</span>
            </span>
          </Navbar.Brand>

          <Navbar.Toggle
            aria-controls="responsive-navbar-nav"
            label={expanded ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            <span></span>
            <span></span>
            <span></span>
          </Navbar.Toggle>

          <Navbar.Collapse id="responsive-navbar-nav">
            <Nav className="ms-auto">
              {LINKS.map(({ to, label, Icon }) => (
                <Nav.Item key={to}>
                  <Nav.Link
                    as={Link}
                    to={to}
                    onClick={close}
                    className={pathname === to ? "is-active" : ""}
                    aria-current={pathname === to ? "page" : undefined}
                  >
                    <Icon aria-hidden="true" /> {label}
                    <AiOutlineRight className="nav-chevron d-lg-none" aria-hidden="true" />
                  </Nav.Link>
                </Nav.Item>
              ))}

              {EXTERNAL.map(({ href, label, Icon }) => (
                <Nav.Item key={href}>
                  <Nav.Link href={href} target="_blank" rel="noreferrer" onClick={close}>
                    <Icon aria-hidden="true" /> {label}
                    <AiOutlineRight className="nav-chevron d-lg-none" aria-hidden="true" />
                  </Nav.Link>
                </Nav.Item>
              ))}
            </Nav>

            {/* Primary call to action: pill on desktop, full-width on the sheet */}
            <div className="nav-sheet-cta">
              <Link to="/projects" className="nav-cta" onClick={close}>
                See my work
                <AiOutlineArrowRight aria-hidden="true" />
              </Link>
            </div>

            <div className="nav-divider d-lg-none" />

            <div className="nav-sheet-foot d-lg-none">
              <a
                href="https://github.com/JoshW-dev"
                target="_blank"
                rel="noreferrer"
                className="social-btn social-btn--sm"
                aria-label="GitHub"
                onClick={close}
              >
                <AiFillGithub />
              </a>
              <a
                href="https://www.linkedin.com/in/joshua-f-wade/"
                target="_blank"
                rel="noreferrer"
                className="social-btn social-btn--sm"
                aria-label="LinkedIn"
                onClick={close}
              >
                <FaLinkedinIn />
              </a>
              <a
                href="https://medium.com/@wadan"
                target="_blank"
                rel="noreferrer"
                className="social-btn social-btn--sm"
                aria-label="Medium"
                onClick={close}
              >
                <AiOutlineMedium />
              </a>
            </div>
          </Navbar.Collapse>
        </Container>
      </Navbar>
    </>
  );
}

export default NavBar;
