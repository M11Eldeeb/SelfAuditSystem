import path from "node:path";
import type { NextConfig } from "next";

// Security headers on every response. The CSP only sets rules that cannot break the app's own scripts: no framing by
// other sites (the app frames its own file previews), no <base> or plugin tricks, forms only post back to the site.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera and microphone: technicians record photos and videos in the site. Nothing else.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Part Return moved under Warranty Room; the old addresses (bookmarks, mails, notifications) keep working.
  async redirects() {
    return [
      { source: "/admin/part-returns", destination: "/admin/warranty-room/part-returns", permanent: true },
      { source: "/admin/part-returns/:path*", destination: "/admin/warranty-room/part-returns/:path*", permanent: true },
      { source: "/audit/part-returns", destination: "/audit/warranty-room/part-returns", permanent: true },
      { source: "/audit/part-returns/:path*", destination: "/audit/warranty-room/part-returns/:path*", permanent: true },
    ];
  },
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
