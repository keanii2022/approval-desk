import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Several dev servers can run on this folder at once (for example while browser
  // tests and a hand check both run) if each gets its own build folder.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
