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
import H2 from "../../Assets/Projects/02.jpg";
import FPSO from "../../Assets/Projects/04.jpg";
import pets from "../../Assets/Projects/pets.png";
import EducationAI from "../../Assets/Projects/EducationAI.png";
import FeedbackerAI from "../../Assets/Projects/feedbacker.jpg";

function Projects() {
  return (
    <Container fluid className="project-section">
      <Particle />
      <Container>
        <h1 className="project-heading">
          Recent <strong className="gold">Work </strong>
        </h1>
        <p style={{ color: "white" }}>
          Here some projects I've worked on recently.
        </p>
        <Row style={{ justifyContent: "center", paddingBottom: "10px" }}>
        <Col md={4} className="project-card">
            <ProjectCard
              imgPath={FeedbackerAI}
              title="Feedbacker AI"
              description="
              Your personal writing coach, designed to help you communicate like a master. Instant expert guidance and advice for improving emails, and professional writing. "
              demoLink="https://feedbacker.ca/"
            />
          </Col>
        
        <Col md={4} className="project-card">
            <ProjectCard
              imgPath={EducationAI}
              title="AI Education Assistant"
              description="
              AI-powered web app that redefines learning and teaching. It offers advanced translation, writing aids, and interactive learning tools, serving both students and educators. With this platform, enhancing academic success and efficiency becomes effortless and accessible."
              demoLink="https://highstyle.ai/"
            />
          </Col>
        
          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={insider}
              type={"Github"}
              title="Insider Trader Watchlist"
              description="Web app that tracks stock purchases by high-level company insiders by webscraping and compiling SEC data. Blending data science with financial insights and acting as a valuable tool for independent investors."
              ghLink="https://github.com/JoshW-dev/insider-alert"
              demoLink="http://joshwdev.pythonanywhere.com/"
            />
          </Col>
          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={localLLM}
              type={"Github"}
              title="Local LLM"
              description="Lightweight chatbot designed to allow users to run an open-source Large Language Models locally via a Python API. This makes it possible to chat with the LLM directly from the command line without an internet connection or external bias."
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
              description="Custom-made chatbot designed to guide users in personal investing. Trained on an extensive investment knowledge base, it can answer queries from 'What is a mutual fund?' to 'How does compound interest work?'. Capable of communicating in English, Spanish, French, Chinese, and Russian, Invest Assistant is your multilingual guide to the world of investing."
              demoLink="https://investor-assistant.zapier.app/"              
            />
          </Col>

          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={aiChatBot}
              title="AI Education Assistant Platform"
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
              imgPath={H2}
              title="Clean Hydrogen Production Facility"
              description="Led a team to identify and develop opportunities to optimize scope and reduce capital expenditure for a blue hydrogen production project. Designed to produce more than 300,000 tonnes of clean hydrogen per year, utilizing advanced technology to capture over 90% of the generated emissions."
            />
          </Col>
          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={FPSO}
              title="Floating Production Storage and Offloading (FPSO)"
              description="Developed major logistics assessment and scheduling tools for the execution of a FPSO vessel refurbishment project, reducing project delays by over a month."
            />
          </Col>
          <Col md={4} className="project-card">
            <ProjectCard
              imgPath={pets}
              title="Masterpiece Pets"
              description="Using stable diffusion algorithms and diverse artistic styles to create bespoke portraits of pets and animals."
              demoLink="https://www.instagram.com/masterpiecepets/"
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
