import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";
import {
  PREVIEW_TOKEN_QUERY_PARAM,
  verifyPreviewToken,
  type PreviewTokenVerificationResult,
} from "@/lib/preview-token";

/**
 * Lookbook preview access (issue #254).
 *
 * `/preview/:id` is reachable through two independent, intentional paths:
 *
 * 1. Signed preview token — the cookie-less Browserless PDF-export flow.
 *    `POST /api/export-pdf` mints a 5-minute HMAC token scoped to one
 *    projectId (see src/lib/preview-token.ts) and appends it to the preview
 *    URL. This path MUST stay fully cookie-independent: the cloud browser
 *    holds no session.
 * 2. Authenticated session — the human "Preview Lookbook" button links to
 *    `/preview/:id` with no token. The page grants access when the request
 *    carries a valid Supabase session whose Prisma user OWNS the project.
 *
 * Everything else is denied: anonymous visitors without a token, expired,
 * forged, or mismatched tokens, and authenticated users who do not own the
 * project. Denied access always yields a 404 (never 403) so the route
 * never leaks a project's existence.
 *
 * Middleware does NOT run this logic — `/preview/*` passes through in both
 * directions; the page self-guards here (established pattern).
 */

/** searchParams shape handed to App Router page/metadata functions. */
export type PreviewSearchParams = Record<string, string | string[] | undefined>;

/**
 * Extract the preview token from a page's resolved searchParams. Returns
 * the first value when Next hands us an array; `null` when absent.
 */
export function extractPreviewToken(
  searchParams: PreviewSearchParams,
): string | null {
  const raw = searchParams[PREVIEW_TOKEN_QUERY_PARAM];
  if (raw === undefined) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? null;
}

/**
 * Pure access decision for the preview page. Grants access when EITHER a
 * valid, unexpired token scoped to THIS projectId is present OR the
 * resolved session user id equals the project's owner id.
 *
 * The session fallback requires BOTH sides to exist: a nonexistent project
 * (null owner) and an anonymous visitor (null session) are denied
 * identically — no existence leak.
 */
export function resolvePreviewAccess(input: {
  projectId: string;
  tokenVerification: PreviewTokenVerificationResult;
  sessionUserId: string | null;
  projectOwnerId: string | null;
}): boolean {
  const tokenValid =
    input.tokenVerification.valid &&
    input.tokenVerification.projectId === input.projectId;
  if (tokenValid) return true;

  return (
    input.sessionUserId !== null &&
    input.projectOwnerId !== null &&
    input.sessionUserId === input.projectOwnerId
  );
}

/**
 * Resolves the current request's session as a Prisma user id, mirroring
 * src/lib/api-auth.ts (real-JWT `getUser()`, lookup by verified email,
 * fails closed) but built on the request-scoped Supabase client whose
 * cookie writes are try/catch-wrapped — this runs inside a Server
 * Component, which cannot set cookies, so the api-auth wiring would throw
 * mid-render on token rotation.
 */
async function getPreviewSessionUserId(): Promise<string | null> {
  const supabase = await createSupabaseRequestClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;

  const prismaUser = await prisma.user.findUnique({
    where: { email: user.email },
    select: { id: true },
  });
  return prismaUser?.id ?? null;
}

/**
 * Full access resolution for one preview request. NOT memoized — callers in
 * request scope should wrap this in React `cache()` (the preview page does)
 * so generateMetadata and the page share ONE token verification and at most
 * ONE session + ownership check. Kept react-free so vitest can import this
 * module directly (react 18.3.1 does not export `cache` outside Next's
 * bundled build).
 *
 * The token path short-circuits before any session lookup: the Browserless
 * browser is cookie-less and must not pay a pointless auth round trip on
 * every PDF export. The session path fails closed — any error resolving
 * the session or the ownership check denies access instead of leaking the
 * page.
 */
export async function getPreviewAccess(
  projectId: string,
  token: string | null
): Promise<boolean> {
  const tokenVerification = await verifyPreviewToken(token);

  // Token-only decision (no session evidence): valid + scoped wins.
  if (
    resolvePreviewAccess({
      projectId,
      tokenVerification,
      sessionUserId: null,
      projectOwnerId: null,
    })
  ) {
    return true;
  }

  try {
    const sessionUserId = await getPreviewSessionUserId();
    if (!sessionUserId) return false;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });

    return resolvePreviewAccess({
      projectId,
      tokenVerification,
      sessionUserId,
      projectOwnerId: project?.userId ?? null,
    });
  } catch (error) {
    console.error("Error resolving preview session access:", error);
    return false;
  }
}
