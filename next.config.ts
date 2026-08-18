import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    serverActions: {
      // Default is 1MB. Claims exports and phone-camera photos (up to 4 per
      // submission) both go through Server Actions and need more room.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
