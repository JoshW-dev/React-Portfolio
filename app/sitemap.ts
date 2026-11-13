import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { work } from "@/lib/work";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/work", "/about", "/resume"].map((path) => ({
    url: `${site.url}${path}`,
    changeFrequency: "monthly" as const,
    priority: path === "" ? 1 : 0.8,
  }));
  const projects = work.map((w) => ({
    url: `${site.url}/work/${w.slug}`,
    changeFrequency: "yearly" as const,
    priority: w.featured ? 0.8 : 0.5,
  }));
  return [...pages, ...projects];
}
