import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/projects", destination: "/work", permanent: true },
      { source: "/project", destination: "/work", permanent: true },
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
