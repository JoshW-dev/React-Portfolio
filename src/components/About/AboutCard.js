import React from "react";
import Card from "react-bootstrap/Card";

function AboutCard() {
  return (
    <Card className="quote-card-view">
      <Card.Body>
        <blockquote className="blockquote mb-0">
          <p style={{ textAlign: "justify" }}>

            I am a designer, developer and engineer 
            from <span className="gold"> Toronto, Canada.</span>
            <br /> 
            <br /> 
            
            My background is in <span className="gold">Applied Mathematics</span>, information theory and machine learning. 						
            <br /> 
            <br /> 
            
           
            As a <span className="gold">Software Developer</span>, I've worked in AI research, focused on natural language processing and digital education. 
            <br /> 
            <br /> 
            
            I've also led teams as an <span className="gold">Engineering Consultant</span>, driving significant improvements in large energy and manufacturing projects.
            <br /> 
            <br /> 
            
            I am always looking for ways to leverage data and technology  to make a difference. 
          </p>

        </blockquote>
      </Card.Body>
    </Card>
  );
}

export default AboutCard;
