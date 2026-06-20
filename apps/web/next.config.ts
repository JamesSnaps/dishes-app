import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const config: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  experimental: {
    // Allow large .crumb zip uploads (Crouton exports can be several hundred MB)
    middlewareClientMaxBodySize: 1024 * 1024 * 1024, // 1 GB
    serverActions: {
      // Photos uploaded via cook review can be up to 15 MB (validated server-side)
      bodySizeLimit: "20mb",
    },
  },

  transpilePackages: ["@dishes/ui", "@dishes/db", "@dishes/shared", "@dishes/api"],

  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
      },
      {
        protocol: "https",
        hostname: "dishes-s3.collardserver.co.uk",
      },
    ],
  },
};

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Cache pages as the user visits them so previously-seen routes (and their RSC
  // payloads) load offline instead of hanging on a stalled fetch.
  cacheOnNavigation: true,
  // Precache the offline fallback shown when an unvisited route is opened with no
  // connection. Bump the revision whenever public/offline.html changes.
  additionalPrecacheEntries: [{ url: "/offline.html", revision: "v1" }],
  // The webpack-based SW build doesn't run under `next dev --turbopack`; only
  // generate the worker for production builds (`next build`).
  disable: process.env.NODE_ENV !== "production",
});

export default withSerwist(config);
