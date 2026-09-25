import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createInstrumentedPrismaClient> | undefined;
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
 * Wraps a PrismaClient in a Proxy that logs any error thrown by a query
 * method as a DatabaseError before re-throwing.
 */
function createInstrumentedPrismaClient(client: PrismaClient): PrismaClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return function (...args: unknown[]) {
          try {
            const result = value.apply(target, args);
            // Handle async methods (prisma queries return promises)
            if (result && typeof result.then === "function") {
              return result
                .then((resolved: unknown) => resolved)
                .catch((err: unknown) => {
                  logger.error(
                    {
                      event: "db_query_error",
                      errorType: "DatabaseError",
                      model: String(prop),
                      args: String(args),
                      error: err instanceof Error ? err.message : String(err),
                    },
                    `[DatabaseError] Prisma ${String(prop)} error: ${err instanceof Error ? err.message : String(err)}`
                  );
                  throw err;
                });
            }
            return result;
          } catch (err) {
            logger.error(
              {
                event: "db_query_error",
                errorType: "DatabaseError",
                model: String(prop),
                args: String(args),
                error: err instanceof Error ? err.message : String(err),
              },
              `[DatabaseError] Prisma ${String(prop)} error: ${err instanceof Error ? err.message : String(err)}`
            );
            throw err;
          }
        };
      }
      return value;
    },
  });
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
export const prisma =
  globalForPrisma.prisma ?? createInstrumentedPrismaClient(createPrismaClient());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
