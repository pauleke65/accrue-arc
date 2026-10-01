import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The server talks to Arc and the Proof Engine fetches evidence; nothing
  // needs image optimisation or the edge runtime.
  poweredByHeader: false,
  // This folder may sit inside another checkout with its own lockfile.
  turbopack: { root: process.cwd() },
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
