import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@dishes/ui", "@dishes/db", "@dishes/shared", "@dishes/api"],

  images: {
    remotePatterns: [
      {
        // MinIO / S3-compatible storage
        protocol: "http",
        hostname: "localhost",
        port: "9000",
      },
    ],
  },

  experimental: {
    // Enables server actions
  },
};

export default config;
