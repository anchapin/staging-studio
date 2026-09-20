import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";

/**
 * Shared server-side loaders for the (dashboard) route group (issue #83).
 *
 * Each loader is wrapped in React `cache()`, so the (dashboard) layout and
 * the pages it wraps — /projects and /projects/[id] — can all await the
 * same loader within one request and receive ONE shared result instead of
 * each re-running the auth round-trip and Prisma query. React dedupes
 * `cache()`d calls per request; a `router.refresh()` or a fresh navigation
 * starts a new request and re-runs them.
 *
 * Ownership contract (mirrors GET /api/projects and GET /api/projects/[id]):
 * the real JWT is validated via `supabase.auth.getUser()` (fails closed),
 * the Prisma `User` row is resolved by verified email, and every project
 * lookup is scoped to that user's id. Uses the request-scoped Supabase
 * client, whose cookie writes are swallowed in Server Components —
 * middleware performs the refresh.
 *
 * Server-component-only module: importing it from a client component would
 * pull `next/headers` into the browser bundle.
 */

const dashboardUserSelect = {
  id: true,
  projects: {
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      propertyAddress: true,
      clientName: true,
      stagingAesthetic: true,
      createdAt: true,
      updatedAt: true,
      rooms: {
        select: { id: true, name: true, afterImageUrl: true, afterImageUrl2: true },
      },
    },
  },
} satisfies Prisma.UserSelect;

export type DashboardUserWithProjects = Prisma.UserGetPayload<{
  select: typeof dashboardUserSelect;
}>;

export interface DashboardUserResult {
  /** Verified email from the Supabase JWT, or null when unauthenticated. */
  sessionEmail: string | null;
  /** Prisma `User` row (with owned projects), or null when unprovisioned. */
  userRow: DashboardUserWithProjects | null;
}

/**
 * Resolves the authed user plus all their projects — the sidebar and
 * /projects list in a single query, shared across the layout and pages via
 * `cache()`. Does not redirect; callers decide (layout: /login vs /setup).
 */
export const getDashboardUserWithProjects = cache(
  async (): Promise<DashboardUserResult> => {
    const supabase = await createSupabaseRequestClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      return { sessionEmail: null, userRow: null };
    }

    const userRow = await prisma.user.findUnique({
      where: { email: user.email },
      select: dashboardUserSelect,
    });

    return { sessionEmail: user.email, userRow };
  }
);

const projectDetailSelect = {
  id: true,
  propertyAddress: true,
  clientName: true,
  targetBuyer: true,
  stagingAesthetic: true,
  createdAt: true,
  user: {
    select: {
      firmName: true,
      ownerName: true,
      psychologyPageContent: true,
      signoffContent: true,
    },
  },
  rooms: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      name: true,
      beforeImageUrl: true,
      afterImageUrl: true,
      beforeImageUrl2: true,
      afterImageUrl2: true,
      selectedVariantIndex: true,
      // Issue #169: the focused editor's directives textarea initializes
      // from the room's saved directives when nothing was typed in-session.
      rawDirectives: true,
      observedChallenge: true,
      recommendation: true,
      buyerPsychology: true,
      checklistItems: true,
      inpaintRequests: {
        where: { status: { in: ["IN_QUEUE", "IN_PROGRESS"] } },
        orderBy: { createdAt: "desc" as const },
        take: 1,
        // sourceSlot (issue #170) lets a pendingRequestId resume persist the
        // result with the same source semantics the run was started with.
        select: { id: true, variantSlot: true, sourceSlot: true },
      },
    },
  },
} satisfies Prisma.ProjectSelect;

export type ProjectDetail = Prisma.ProjectGetPayload<{
  select: typeof projectDetailSelect;
}>;

/**
 * Fetches one owned project with its rooms — shared by generateMetadata
 * and the page body via `cache()`, so the project is queried once per
 * request. Returns null for unauthenticated, unprovisioned, or not-owned
 * ids (same three-cases-collapse as the API's 404, except that the
 * layout's redirect guarantees auth before this runs in practice).
 */
export const getProjectDetailForUser = cache(
  async (projectId: string): Promise<ProjectDetail | null> => {
    const { sessionEmail, userRow } = await getDashboardUserWithProjects();
    if (!sessionEmail || !userRow) return null;

    return prisma.project.findUnique({
      where: { id: projectId, userId: userRow.id },
      select: projectDetailSelect,
    });
  }
);
