import React, { useState } from "react";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import { CgWebsite } from "react-icons/cg";
import { BsGithub } from "react-icons/bs";
import useReveal from "../../hooks/useReveal";
import useSpotlight from "../../hooks/useSpotlight";

const CLAMP_AT = 240;

function ProjectCards(props) {
  const [revealRef, visible] = useReveal();
  const spotlightRef = useSpotlight();
  const [open, setOpen] = useState(false);

  const description = props.description || "";
  const isLong = description.length > CLAMP_AT;

  const setRefs = (node) => {
    revealRef.current = node;
    spotlightRef.current = node;
  };

  return (
    <Card
      ref={setRefs}
      className={`project-card-view reveal ${visible ? "is-visible" : ""}`}
    >
      <div className="project-card__media">
        <img src={props.imgPath} alt={props.title} loading="lazy" />
      </div>
      <Card.Body>
        <Card.Title>{props.title}</Card.Title>
        <Card.Text
          className={`project-card__text ${
            isLong && !open ? "project-card__text--clamped" : ""
          }`}
        >
          {description}
        </Card.Text>

        {isLong && (
          <button
            type="button"
            className="project-card__toggle"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {open ? "Show less" : "Read more"}
          </button>
        )}

        <div className="project-card__actions">
          {props.type && (
            <Button
              variant="primary"
              className="btn-quiet"
              href={props.ghLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              <BsGithub aria-hidden="true" />
              {props.type}
            </Button>
          )}

          {!props.isBlog && props.demoLink && (
            <Button
              variant="primary"
              href={props.demoLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              <CgWebsite aria-hidden="true" />
              Demo
            </Button>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
export default ProjectCards;
