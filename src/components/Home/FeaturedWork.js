import React from "react";
import { Container, Row, Col } from "react-bootstrap";
import { Link } from "react-router-dom";
import { AiOutlineArrowRight } from "react-icons/ai";
import openaffect from "../../Assets/Projects/openaffect.webp";
import highstyle from "../../Assets/Projects/highstyle.webp";
import mcnicoll from "../../Assets/Projects/mcnicoll.webp";
import Reveal from "../Reveal";
import useSpotlight from "../../hooks/useSpotlight";

const FEATURED = [
  {
    img: openaffect,
    tag: "AI · Product",
    title: "OpenAffect",
    blurb:
      "Predictive AI for virality that maps a script second by second to the emotion viewers feel and the action they take next.",
    href: "https://www.openaffect.ai/",
  },
  {
    img: highstyle,
    tag: "AI · Video",
    title: "Highstyle",
    blurb:
      "Drop in a long podcast or interview and get back ranked, captioned clips, reframed and ready for every platform.",
    href: "https://highstyle.ai/",
  },
  {
    img: mcnicoll,
    tag: "WebGL · Art",
    title: "In Search of Light",
    blurb:
      "Eighteen Helen McNicoll paintings animated live in the browser, with every pixel moving along the direction of her own brushstrokes.",
    href: "https://mcnicoll-light.vercel.app/",
  },
];

function FeaturedCard({ item }) {
  const ref = useSpotlight();

  return (
    <a
      ref={ref}
      href={item.href}
      target="_blank"
      rel="noreferrer"
      className="featured-card glass"
    >
      <div className="featured-card__media">
        <img src={item.img} alt={item.title} loading="lazy" />
      </div>
      <div className="featured-card__body">
        <span className="featured-card__tag">{item.tag}</span>
        <h3>{item.title}</h3>
        <p>{item.blurb}</p>
        <span className="featured-card__more">
          Open it
          <AiOutlineArrowRight aria-hidden="true" />
        </span>
      </div>
    </a>
  );
}

/** Three pieces up front, then a straight path to the full list. */
function FeaturedWork() {
  return (
    <Container fluid className="featured">
      <Container>
        <Reveal className="featured__head">
          <div>
            <span className="eyebrow">Selected work</span>
            <h2>Things I've built lately</h2>
            <p>Art, research and products, mostly with AI somewhere inside.</p>
          </div>
          <Link to="/projects" className="btn-ghost d-none d-md-inline-flex">
            All projects
            <AiOutlineArrowRight className="arrow" aria-hidden="true" />
          </Link>
        </Reveal>

        <Row>
          {FEATURED.map((item, index) => (
            <Col md={4} className="mb-4" key={item.title}>
              <Reveal delay={index * 90} style={{ height: "100%" }}>
                <FeaturedCard item={item} />
              </Reveal>
            </Col>
          ))}
        </Row>

        <Reveal className="featured__foot">
          <Link to="/projects" className="btn-solid">
            Browse all 20 projects
            <AiOutlineArrowRight className="arrow" aria-hidden="true" />
          </Link>
        </Reveal>
      </Container>
    </Container>
  );
}

export default FeaturedWork;
