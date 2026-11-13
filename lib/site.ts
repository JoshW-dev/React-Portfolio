export const site = {
  name: "Josh Wade",
  url: "https://joshwade.site",
  role: "Customer-facing AI engineer",
  location: "Toronto, Canada",
  description:
    "Josh Wade is an AI engineer in Toronto. This is his portfolio: products, research, games and art, with his resume.",
  // Leave empty to hide the email link in the footer.
  email: "",
  resumePdf: "/WadeJoshua_Resume.pdf",
  links: {
    linkedin: "https://www.linkedin.com/in/joshua-f-wade/",
    github: "https://github.com/JoshW-dev",
    medium: "https://medium.com/@wadan",
  },
} as const;

export const nav = [
  { href: "/projects", label: "Projects" },
  { href: "/about", label: "About" },
  { href: "/resume", label: "Resume" },
] as const;
