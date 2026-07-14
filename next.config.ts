import type { NextConfig } from "next";

// GitHub Pages serves a project repo from a subpath (/solar-system-atlas), so the
// deploy workflow sets NEXT_PUBLIC_BASE_PATH. Local builds default to the root path.
// The same value is read at runtime in SolarSystem.tsx to prefix texture URLs, which
// Three.js loads by raw string and Next therefore cannot rewrite for us.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  // No server means no on-demand image optimization. Nothing here uses next/image
  // anyway (Three.js loads textures directly), but export requires this to be set.
  images: { unoptimized: true },
};

export default nextConfig;
