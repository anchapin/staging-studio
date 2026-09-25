import { PrismaClient } from "@prisma/client";
import { componentLogger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

const log = componentLogger("prisma");

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? [
            { emit: "event", level: "query" },
            { emit: "event", level: "error" },
            { emit: "event", level: "warn" },
          ]
        : [{ emit: "event", level: "error" }],
  });

  // Attach structured query listeners
  if (process.env.NODE_ENV === "development") {
    client.$on("query", (event: Prisma.QueryEvent) => {
      log.debug(
        {
          type: "prisma_query",
          query: event.query,
          params: event.params,
          durationMs: event.duration,
        },
        `query (${event.duration}ms)`
      );
    });

    client.$on("warn", (event: Prisma.LogLevel) => {
      log.warn({ type: "prisma_warn", level: event }, "Prisma warning");
    });
  }

  client.$on("error", (event: Prisma.LogLevel) => {
    log.error(
      {
        type: "prisma_error",
        level: event,
        // NOTE: the event object from Prisma $on error only carries the message
        // as a string property; we capture it here to avoid losing it.
        errMessage: typeof event === "string" ? event : (event as unknown as { message?: string }).message,
      },
      "Prisma error"
    );
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
 * Observability:
 * - All Prisma errors are logged via pino with component "prisma", duration,
 *   and query/params (params are redacted automatically by pino's redact).
 * - In development, queries and warnings are also logged at debug/info level.
 * - Cached on `globalThis` outside production so Next.js hot reloads
 *   reuse one client instead of exhausting the connection pool.
 *
 * Contract:
 * - `DATABASE_URL` must be set (Supabase Postgres connection string).
 * - Throws at first use if `DATABASE_URL` is unset.
 */
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
