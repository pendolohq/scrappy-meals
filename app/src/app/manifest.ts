import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scrappy Meals",
    short_name: "Meals",
    description: "Shared weekly meal planner on top of Mealie",
    start_url: "/week",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#15803d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
