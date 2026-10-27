import type { MetadataRoute } from "next";

/**
 * Lets the portal be added to a phone's home screen as an app (Android: "Install app"; iPhone: Share -> "Add to Home
 * Screen"): its own icon, full screen without the browser bar, opening on the user's home page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MG Warranty Management",
    short_name: "MG Warranty",
    description: "Warranty claims, audits and evidence - Jiad Modern Motors",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
    icons: [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
