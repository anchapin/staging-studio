import type { NextConfig } from "next";

import {
  buildLoopbackRemotePatterns,
  E2E_HERMETIC_ENV_VAR,
  shouldAllowLocalIp,
} from "./src/lib/image-remote-patterns";
import { SECURITY_HEADERS } from "./src/lib/security-headers";

// Issue #1112: the loopback `remotePatterns` entries and
// `dangerouslyAllowLocalIP` are ONLY included when the hermetic e2e
// harness is active. NODE_ENV cannot be used as the gate — the e2e
// suite runs a production build (`next build && next start`), so
// NODE_ENV is "production" in exactly the run that needs the
// relaxation. The helpers are shared with `room-patch-schema.ts` so
// both cannot drift.
const hermetic = process.env[E2E_HERMETIC_ENV_VAR];
const loopbackRemotePatterns = buildLoopbackRemotePatterns(hermetic);
const dangerouslyAllowLocalIP = shouldAllowLocalIp(hermetic);

const nextConfig: NextConfig = {
  // @ts-expect-error maxDuration is a valid Next.js config key but may not be in the published types yet
  maxDuration: 90,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...SECURITY_HEADERS],
      },
    ];
  },
  images: {
    // Issue #264: the e2e harness needs the next/image optimizer to
    // fetch from loopback private IPs — the mock Supabase storage
    // runs on 127.0.0.1 and the seeded fixture URLs resolve to it.
    // Gated by E2E_HERMETIC=1 (issue #1112) so this widens the IP
    // space ONLY in test builds; production keeps the SSRF guard on.
    // remotePatterns still restricts which URLs are fetched; this flag
    // only widens the IP space for already-matched hosts.
    ...(dangerouslyAllowLocalIP ? { dangerouslyAllowLocalIP: true } : {}),
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
      {
        protocol: "https",
        hostname: "*.fal.ai",
      },
      // Issue #165 e2e harness: the local mock Supabase storage and
      // fake provider fixtures serve images over http loopback so the
      // suite never contacts real services. Loopback-only, hermetic
      // concern — gated by E2E_HERMETIC=1 (issue #1112) so production
      // builds never include these.
      ...loopbackRemotePatterns,
    ],
  },
};

export default nextConfig;