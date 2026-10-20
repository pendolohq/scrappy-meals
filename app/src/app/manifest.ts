import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scrappy Meals",
    short_name: "Meals",
    description: "Shared weekly meal planner on top of Mealie",
    start_url: "/week",
    scope: "/",
    display: "standalone",
    background_color: "#f6efe0",
    theme_color: "#4f6b30",
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
