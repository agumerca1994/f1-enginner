import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ingeniero de carrera",
    short_name: "Ingeniero",
    description: "Telemetría en vivo y tu ingeniero de IA para EA SPORTS F1® 24",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#07090c",
    theme_color: "#07090c",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
