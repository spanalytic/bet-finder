import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export so the site can be hosted on GitHub Pages; the backtest runs in the browser.
  output: "export",
  // Set by the Pages workflow to "/<repo-name>"; empty for local dev.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  images: { unoptimized: true },
};

export default nextConfig;
