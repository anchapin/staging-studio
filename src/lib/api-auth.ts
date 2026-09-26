import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createServerClientSingleton } from "@/lib/supabase";
import type { PrismaClient, Project, User } from "@prisma/client";

/**
 * Resolves the current request's authenticated user as a Prisma `User`.
 *
 * Purpose: the shared session gate for API routes and server actions
 * (which are NOT covered by root `middleware.ts`). Every mutation
 * endpoint must call this and treat `null` as "Not authenticated";
 * ownership filters are built on the returned `user.id`.
 *
 * Contract:
 * - Validates the real JWT via `supabase.auth.getUser()` (fails closed),
 *   then looks the user up in Postgres by verified email. A valid
 *   Supabase session with no matching Prisma `User` row returns `null`.
 * - `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and
 *   `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be set — `requireEnvVars`
 *   throws `MissingEnvVarsError` otherwise.
 * - Uses `createServerClientSingleton` with the exact `{ getAll, setAll }`
 *   cookie adapter; unlike Server Components, route handlers/actions CAN
 *   write cookies, so refresh happens inline here.
 *
 * Side effects: reads request cookies via `next/headers`; may refresh
 * auth cookies on the outgoing response during token rotation; performs
 * one Prisma query.
 *
 * @returns The matching Prisma `User` record, or `null` when there is no
 *   valid session or no corresponding user row.
 */
export async function getAuthedPrismaUser() {
  const cookieStore = await cookies();

  const supabase = createServerClientSingleton({
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value, options }) =>
        cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
      );
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;

  return prisma.user.findUnique({
    where: { email: user.email },
  });
}

/**
 * Verifies the authenticated user owns the given project.
 * Returns `{ ok: true, projectId }` on success.
 * Returns `{ ok: false, reason, response }` with a JSON error response on failure.
 * The caller should `return response` on failure without further processing.
 *
 * @param wrapResponse - Optional wrapper applied to the error response. For example,
 *   pass `(r) => withCors(r)` when the current code uses `withCors(NextResponse.json(...))`.
 */
export async function requireProjectOwnership(
  projectId: string,
  user: User,
  wrapResponse?: (r: NextResponse) => NextResponse,
): Promise<
  | { ok: true; projectId: string }
  | { ok: false; reason: "not_found" | "forbidden"; response: NextResponse }
> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });

  if (!project) {
    const response = NextResponse.json(
      { error: "Project not found", message: "Project does not exist" },
      { status: 404 },
    );
    return {
      ok: false,
      reason: "not_found",
      response: wrapResponse ? wrapResponse(response) : response,
    };
  }

  if (project.userId !== user.id) {
    const response = NextResponse.json(
      { error: "Forbidden", message: "You do not have permission to access this project." },
      { status: 403 },
    );
    return {
      ok: false,
      reason: "forbidden",
      response: wrapResponse ? wrapResponse(response) : response,
    };
  }

  return { ok: true, projectId };
}

/**
 * Returns the project if the user owns it, otherwise null.
 * Non-throwing variant for server actions.
 */
export async function requireProjectOwnershipSafe(
  projectId: string,
  userId: string,
  prisma: PrismaClient,
): Promise<{ project: Project } | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId, userId },
  });
  if (!project) return null;
  return { project };
}
