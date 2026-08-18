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
    // Default is 10MB. proxy.ts buffers every request body it passes through
    // (e.g. the photo-upload Server Action, which POSTs back to the /audit
    // page it was invoked from), so this needs to match bodySizeLimit above
    // or large uploads get silently truncated before they reach the route.
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
