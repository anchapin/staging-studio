import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Issue #783: Vercel Pro+ default serverless timeout is 10s, which is too
  // short for PDF export (Browserless fetch + auth/DB overhead comfortably fit
  // under 90s). The per-route `export const maxDuration = 90` in
  // src/app/api/export-pdf/route.ts handles the lambda budget; this key handles
  // the platform-level request timeout. Requires Vercel Pro or Enterprise.
  maxDuration: 90,
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
