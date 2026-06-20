import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions default to a 1MB request body, which rejects most phone
    // photos before the avatar upload action even runs. Raise it to cover the
    // 5MB cap enforced in actions/profile.ts (plus FormData overhead).
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
