import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.supabase.co https://*.fal.ai https://*.openai.com https://*.openai-api.com https://picsum.photos https://browserless.io; connect-src 'self' https://*.supabase.co https://*.fal.ai https://api.openai.com https://api.openai-api.com wss://*.supabase.co; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  // @ts-expect-error maxDuration is a valid Next.js config key but may not be in the published types yet
  maxDuration: 90,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
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
