import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * A short hash of each file under public/film, by URL path. lib/filmUrl.ts adds it to the
 * file's URL as ?v=, so browsers can keep the film's files for a year (headers below) and a
 * changed file still loads at once under its new URL. About 0.2 s for the 150 MB there.
 */
function filmVersions() {
  const pub = path.join(process.cwd(), "public");
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const url = "/" + path.relative(pub, full).split(path.sep).join("/");
        out[url] = createHash("sha1").update(readFileSync(full)).digest("hex").slice(0, 10);
      }
    }
  };
  walk(path.join(pub, "film"));
  return out;
}

const config: NextConfig = {
  reactStrictMode: true,
  env: {
    FILM_VERSIONS: JSON.stringify(filmVersions()),
  },
  async headers() {
    return [
      {
        // Only a URL with its content hash: the same URL always means the same bytes.
        source: "/film/:path*",
        has: [{ type: "query", key: "v" }],
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/project", destination: "/projects", permanent: true },
      { source: "/work", destination: "/projects", permanent: true },
    ];
  },
  async rewrites() {
    // The App Store listing for Simple Vault points at these two URLs.
    return [
      { source: "/apps/vault/privacy", destination: "/apps/vault/privacy/index.html" },
      { source: "/apps/vault/support", destination: "/apps/vault/support/index.html" },
    ];
  },
};

export default config;
