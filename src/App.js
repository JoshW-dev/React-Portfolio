import React, { useState, useEffect } from "react";
import Preloader from "../src/components/Pre";
import Navbar from "./components/Navbar";
import Home from "./components/Home/Home";
import About from "./components/About/About";
import Projects from "./components/Projects/Projects";
import Footer from "./components/Footer";
import Resume from "./components/Resume/ResumeNew";
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
  useLocation,
} from "react-router-dom";
import ScrollToTop from "./components/ScrollToTop";
import ScrollProgress from "./components/ScrollProgress";
import MobileDock from "./components/MobileDock";
// Bootstrap first so the design system below can override it without
// leaning on !important everywhere.
import "bootstrap/dist/css/bootstrap.min.css";
import "./style.css";
import "./App.css";

/** Re-keyed on every route change so each page fades in on arrival. */
function AnimatedRoutes() {
  const { pathname } = useLocation();

  return (
    <div className="page" key={pathname}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/about" element={<About />} />
        <Route path="/resume" element={<Resume />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </div>
  );
}

function App() {
  const [load, upadateLoad] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      upadateLoad(false);
    }, 900);

    return () => clearTimeout(timer);
  }, []);

  return (
    <Router>
      <Preloader load={load} />
      <div className="App" id={load ? "no-scroll" : "scroll"}>
        <ScrollProgress />
        <Navbar />
        <ScrollToTop />
        <AnimatedRoutes />
        <Footer />
        <MobileDock />
      </div>
    </Router>
  );
}

export default App;
