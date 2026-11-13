import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { work } from "@/lib/work";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/projects", "/about", "/resume"].map((path) => ({
    url: `${site.url}${path}`,
    changeFrequency: "monthly" as const,
    priority: path === "" ? 1 : 0.8,
  }));
  const projects = work.map((w) => ({
    url: `${site.url}/projects/${w.slug}`,
    changeFrequency: "yearly" as const,
    priority: 0.6,
  }));
  return [...pages, ...projects];
}
