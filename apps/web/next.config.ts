import type { NextConfig } from "next";

const config: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  transpilePackages: ["@dishes/ui", "@dishes/db", "@dishes/shared", "@dishes/api"],

  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
      },
    ],
  },
};

export default config;
