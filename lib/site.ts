export const site = {
  name: "Josh Wade",
  url: "https://joshwade.site",
  role: "Customer-facing AI engineer",
  location: "Toronto, Canada",
  description:
    "Josh Wade builds voice and chat agents for government teams, on lines that take more than 100,000 calls a year, and stays on the call with the customer from kickoff to go-live.",
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
  { href: "/work", label: "Work" },
  { href: "/about", label: "About" },
  { href: "/resume", label: "Resume" },
] as const;
