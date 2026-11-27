import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pit en línea",
    short_name: "Pit en línea",
    description: "Telemetría en vivo y tu ingeniero de pista por radio. Compatible con la telemetría de los juegos EA SPORTS F1®.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#14161a",
    theme_color: "#14161a",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
