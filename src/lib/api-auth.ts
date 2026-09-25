import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createServerClientSingleton } from "@/lib/supabase";
import { ApiError } from "@/lib/api-error-handler";
import { API_ERROR_UNAUTHORIZED, API_ERROR_PROJECT_NOT_FOUND } from "@/lib/api-errors";

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

export async function requireUser(): Promise<NonNullable<Awaited<ReturnType<typeof getAuthedPrismaUser>>>> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    throw new ApiError({
      code: API_ERROR_UNAUTHORIZED,
      message: "Not authenticated",
      status: 401,
    });
  }
  return user;
}

/**
 * Verifies that the given project is owned by the given user.
 * Throws a typed ApiError if the project does not exist or is not owned.
 */
export async function requireProjectOwnership(projectId: string, userId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) {
    throw new ApiError({
      code: API_ERROR_PROJECT_NOT_FOUND,
      message: "Project not found or not owned by user",
      status: 404,
    });
  }
}
