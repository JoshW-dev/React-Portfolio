import React from "react";
import { Container, Row, Col } from "react-bootstrap";
import ProjectCard from "./ProjectCards";
import Particle from "../Particle";
import adam from "../../Assets/Projects/adam.png";
import aiChatBot from "../../Assets/Projects/aiChatBot.png";
import investor from "../../Assets/Projects/investorchatbot.png";
import insider from "../../Assets/Projects/insider-trader.png";
import cubesat from "../../Assets/Projects/cubesat.png";
import paints from "../../Assets/Projects/paints.jpg";
import localLLM from "../../Assets/Projects/localLLM.png";

function Projects() {
  return (
    <Container fluid className="project-section">
      <Particle />
      <Container>
        <h1 className="project-heading">
          Recent <strong className="purple">Work </strong>
        </h1>
        <p style={{ color: "white" }}>
          Here some projects I've worked on recently.
        </p>
        <Row style={{ justifyContent: "center", paddingBottom: "10px" }}>
          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={insider}
              type={"Github"}
              title="Insider Trader Watchlist"
              description="Flask app that tracks stock purchases by high-level insiders by webscraping SEC data. It blends data science with financial insights, making it a valuable tool for investors. Planned back-testing optimization."
              ghLink="https://github.com/JoshW-dev/insider-alert"
              demoLink="http://joshwdev.pythonanywhere.com/"
            />
          </Col>
          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={localLLM}
              type={"Github"}
              title="Local LLM"
              description="Lightweight chatbot designed to allow users to run an open-source Large Language Model (LLM) with GPT4All, locally via a Python API. This makes it possible to chat with the LLM directly from the command line without an internet connection or external bias."
              ghLink="https://github.com/JoshW-dev/local-LLM"
              demoLink="https://youtu.be/CL8GoBnLB90"
            />
          </Col>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={adam}
              type={"Github"}
              title="AI News Artist - Adam Project"
              description="Fully autonomous AI  agent, sharing digital paintings and daily news. The Adam bot webscrapes and reads news articles, creates art and shares relevant content on social media platforms. Operation and social media posting created with python, using Twitter API, stable diffusion and GPT."
              ghLink="https://github.com/JoshW-dev/adam"
              demoLink="https://twitter.com/ai_adam_"
            />
          </Col>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={investor}
              title="Investor Assistant AI"
              description="Invest Assistant is a custom-made chatbot designed to guide you in personal investing. Trained on an extensive investment knowledge base, it can answer queries from 'What is a mutual fund?' to 'How does compound interest work?'. Capable of communicating in English, Spanish, French, Chinese, and Russian, Invest Assistant is your multilingual guide to the world of investing."
              demoLink="https://investor-assistant.zapier.app/"              
            />
          </Col>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={aiChatBot}
              title="AI Education Assistant Chatbot"
              description="Full stack design and development of an AI-assisted academic learning web platform (2019). Created with React.js, Node.js, Kubernetes, Docker, IBM-Watson and python NPL libraries. Created for the Centre for Advanced Computing."
              demoLink="https://cac.queensu.ca/"
            />
          </Col>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={cubesat}
              type={"Github"}
              title="Microsatellite CubeSat"
              description="Design and development of a microsatellite's attitude determination and control system. Developed real-time satellite orientation control simulation with MATLAB and Simulink. Presented design plan at the Canadian Satellite Design Challenge, Critical Design Review 2019."
              ghLink="https://github.com/queens-satellite-team"
              demoLink="https://qset.ca/satellite/"
           />
          </Col>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={paints}
              title="Abstract Painting"
              description="Making spontaneous, unpredictable pieces with acrylics, latex, canvas and gravity. A great way to relax while being creative!"
              demoLink="https://www.instagram.com/paintsepii/"
            />
          </Col>
        </Row>
      </Container>
    </Container>
  );
}

export default Projects;
