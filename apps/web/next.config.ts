import type { NextConfig } from "next";

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

export default config;
