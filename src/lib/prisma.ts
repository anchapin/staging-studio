import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
  return client;
}

/**
 * Shared Prisma client singleton.
 *
 * Purpose: the single sanctioned Prisma construction site for the whole app.
 * Import `prisma` from `@/lib/prisma` everywhere; never call
 * `new PrismaClient()` outside this module, or you get un-pooled
 * connections and duplicate query engines per route.
 *
 * Contract:
 * - `DATABASE_URL` must be set (Supabase Postgres connection string).
 * - In development (`NODE_ENV === "development"`) the client logs all
 *   queries, errors, and warnings; in every other environment it logs
 *   errors only.
 * - Cached on `globalThis` outside production so Next.js hot reloads
 *   reuse one client instead of exhausting the connection pool.
 *
 * Side effects: constructs the client (and connects lazily on first
 * query) at import time; throws at first use if `DATABASE_URL` is unset.
 */
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
