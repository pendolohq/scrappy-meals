import type { MetadataRoute } from "next";

import { BAR_COLOR } from "@/lib/theme";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // The id installs before it existed got from start_url: keeping it the
    // same keeps them the same app.
    id: "/week",
    name: "Scrappy Meals",
    short_name: "Meals",
    description: "Shared weekly meal planner on top of Mealie",
    start_url: "/week",
    scope: "/",
    display: "standalone",
    // The page's own colour, so the splash screen and title bar don't flash
    // another one before the page sets theme-color (light or dark) itself.
    background_color: BAR_COLOR.light,
    theme_color: BAR_COLOR.light,
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
    // Android and desktop Chrome show these in a richer install dialog.
    screenshots: [
      {
        src: "/screenshots/week-narrow.png",
        sizes: "824x1830",
        type: "image/png",
        form_factor: "narrow",
        label: "This week's meals, one day at a time",
      },
      {
        src: "/screenshots/week-wide.png",
        sizes: "1440x900",
        type: "image/png",
        form_factor: "wide",
        label: "The whole week at a glance",
      },
    ],
    shortcuts: [
      {
        name: "This week",
        url: "/week",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Shopping list",
        url: "/shopping",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Add recipe",
        url: "/recipes/new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
