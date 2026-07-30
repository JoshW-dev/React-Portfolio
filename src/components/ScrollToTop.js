import { useEffect } from "react";
import { useLocation } from "react-router-dom";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Jump, don't glide: html has scroll-behavior smooth for in-page anchors,
    // and animating the whole page on every route change feels wrong.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}

export default ScrollToTop;
