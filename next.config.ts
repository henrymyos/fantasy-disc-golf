import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    // Baseline hardening: no MIME sniffing, no framing by other sites (nothing embeds this app).
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
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
