import type { NextConfig } from "next";

const config: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  // Allow large .crumb zip uploads (Crouton exports can be several hundred MB)
  experimental: {
    middlewareClientMaxBodySize: 1024 * 1024 * 1024, // 1 GB
  },

  serverActions: {
    // Base64-encoded recipe photos can be several MB after client-side resize
    bodySizeLimit: "10mb",
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
