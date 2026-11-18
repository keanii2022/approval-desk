import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

// This computer's own addresses on the local network, so a phone on the same Wi-Fi can
// open the dev server (next dev blocks other origins by default). Dev only.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a!.address);

const nextConfig: NextConfig = {
  // Several dev servers can run on this folder at once (for example while browser
  // tests and a hand check both run) if each gets its own build folder.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: lanAddresses,
};

export default nextConfig;
