import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
      {
        protocol: "https",
        hostname: "*.fal.ai",
      },
      // Issue #165 e2e harness: the local mock Supabase storage and fake
      // provider fixtures serve images over http loopback so the suite
      // never contacts real services. Loopback-only, dev/harness concern.
      {
        protocol: "http",
        hostname: "127.0.0.1",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
    ],
  },
};

export default nextConfig;
