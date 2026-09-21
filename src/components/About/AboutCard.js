import React from "react";
import Card from "react-bootstrap/Card";

function AboutCard() {
  return (
    <Card className="quote-card-view">
      <Card.Body>
        <blockquote className="blockquote mb-0">
          <p style={{ textAlign: "justify" }}>

            I'm a customer-facing AI engineer from{" "}
            <span className="gold">Toronto, Canada.</span>
            <br />
            <br />

            Right now I work in <span className="gold">GovTech</span> at a Y Combinator-backed startup. I build voice and chat agents that answer residents' questions, and I run launches with government teams in Texas and California.
            <br />
            <br />

            Before that I spent almost three years at <span className="gold">Disco</span>, an ed-tech startup. The AI course builder I designed there became the #1 driver of their enterprise deals.
            <br />
            <br />

            I've also worked as an <span className="gold">Engineering Consultant</span> on energy and manufacturing projects. On a clean hydrogen plant, the design sessions I led cut more than $300M from the capital budget.
            <br />
            <br />

            My background is in <span className="gold">Applied Mathematics</span>, information theory and machine learning. I got my start doing AI research on natural language processing and digital education.
          </p>

        </blockquote>
      </Card.Body>
    </Card>
  );
}

export default AboutCard;
