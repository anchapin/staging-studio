import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Issue #264: allow next/image optimizer to fetch from loopback private IPs
    // in the e2e harness. The mock Supabase storage runs on 127.0.0.1 and the
    // seeded fixture URLs resolve to it; without this the optimizer SSRF guard
    // blocks the fetch and renders every <next/image> broken in e2e runs.
    // Security contract: remotePatterns still restricts which URLs can be
    // fetched, so this flag only widens the IP space for already-matched hosts.
    dangerouslyAllowLocalIP: true,
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
