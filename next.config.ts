import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel builds its own serverless output and does not need (or want) the
  // standalone bundle. Keep emitting it everywhere else, because
  // .zscripts/build.sh deploys .next/standalone/server.js and re-injects this
  // option if it is missing.
  output: process.env.VERCEL ? undefined : "standalone",
  /* config options here */
  // Type errors fail the build on purpose. The standalone socket.io samples in
  // examples/ are excluded in tsconfig.json instead of muting the whole check.
  reactStrictMode: false,
};

export default nextConfig;
