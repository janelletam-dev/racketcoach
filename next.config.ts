import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack does not infer it from a parent
  // lockfile (silences the "inferred workspace root" warning).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
