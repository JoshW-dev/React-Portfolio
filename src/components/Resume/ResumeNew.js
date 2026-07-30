import React, { useState, useEffect, useRef } from "react";
import { Container, Row } from "react-bootstrap";
import Particle from "../Particle";
import pdf from "../../Assets/WadeJoshua_Resume.pdf";
import { AiOutlineDownload } from "react-icons/ai";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import Reveal from "../Reveal";
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

const MAX_PAGE_WIDTH = 900;

function ResumeNew() {
  const shellRef = useRef(null);
  const [pageWidth, setPageWidth] = useState(null);
  const [numPages, setNumPages] = useState(null);

  // Render each page at the container's width so the PDF stays legible on a
  // phone instead of being scaled down to a thumbnail.
  useEffect(() => {
    const measure = () => {
      const el = shellRef.current;
      if (!el) return;
      setPageWidth(Math.min(el.clientWidth, MAX_PAGE_WIDTH));
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <Container fluid className="resume-section">
      <Particle />
      <Container>
        <Reveal className="section__head">
          <span className="eyebrow">
            <span className="dot" />
            Resume
          </span>
          <h1 className="section__title">The short version</h1>
          <p className="section__lede">
            Read it here, or take the PDF with you.
          </p>
          <div
            className="btn-row"
            style={{ justifyContent: "center", marginTop: "1.5rem" }}
          >
            <a
              className="btn-solid"
              href={pdf}
              target="_blank"
              rel="noopener noreferrer"
            >
              <AiOutlineDownload aria-hidden="true" />
              Download CV
            </a>
          </div>
        </Reveal>

        <Row className="resume">
          <div className="resume-doc" ref={shellRef}>
            {pageWidth && (
              <Document
                file={pdf}
                onLoadSuccess={({ numPages: count }) => setNumPages(count)}
                loading=""
              >
                {Array.from({ length: numPages || 0 }, (_, i) => (
                  <Page key={i + 1} pageNumber={i + 1} width={pageWidth} />
                ))}
              </Document>
            )}
          </div>
        </Row>

        <div className="btn-row" style={{ justifyContent: "center" }}>
          <a
            className="btn-solid"
            href={pdf}
            target="_blank"
            rel="noopener noreferrer"
          >
            <AiOutlineDownload aria-hidden="true" />
            Download CV
          </a>
        </div>
      </Container>
    </Container>
  );
}

export default ResumeNew;
