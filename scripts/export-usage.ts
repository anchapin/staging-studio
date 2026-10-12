#!/usr/bin/env tsx
/**
 * Daily Usage Report Script (issue #1130)
 *
 * Read-only report over the usage counters the app already keeps but nothing
 * read: today's per-surface request counts (DailyApiUsage) and the
 * InpaintRequest outcome split. This is the "manual daily usage check" the
 * spend-alert procedure (docs/ops/217-spend-alerts-config.md) falls back to
 * when a provider dashboard offers no alert UI.
 *
 * Safe to run repeatedly; writes nothing.
 *
 * Usage:
 *   # Today's numbers (server-local calendar day, same window the quota
 *   # counter uses):
 *   npx tsx scripts/export-usage.ts
 *
 *   # A specific day:
 *   npx tsx scripts/export-usage.ts --date 2026-10-12
 *
 *   # Add the all-time inpaint outcome split:
 *   npx tsx scripts/export-usage.ts --all-time
 *
 * Environment:
 *   DATABASE_URL must be set (Supabase Postgres connection string).
 *   The script reads .env.local via Prisma but also respects a .env symlink
 *   (same as other Prisma CLI commands - see AGENTS.md).
 *
 * Output (console, human-readable):
 *   Per-surface usage counts for the day, then the inpaint outcome split for
 *   the day (and all time with --all-time).
 */

import { PrismaClient } from "@prisma/client";

interface UsageOptions {
  date: string; // YYYY-MM-DD, server-local calendar day (mirrors dailyWindow in src/lib/api-quota.ts)
  allTime: boolean;
}

function parseArgs(): UsageOptions {
  const args = process.argv.slice(2);
  const options: UsageOptions = {
    date: localDayKey(new Date()),
    allTime: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--date": {
        const value = args[++i];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          console.error("--date expects YYYY-MM-DD");
          process.exit(1);
        }
        options.date = value;
        break;
      }
      case "--all-time":
        options.allTime = true;
        break;
      case "--help":
        console.log(
          "Usage: npx tsx scripts/export-usage.ts [--date YYYY-MM-DD] [--all-time]"
        );
        process.exit(0);
    }
  }

  return options;
}

/**
 * Same server-local YYYY-MM-DD key the quota counter writes, so this report
 * reads exactly the rows today's traffic produces. Mirrors dailyWindow() in
 * src/lib/api-quota.ts (duplicated here to keep the script standalone).
 */
function localDayKey(now: Date): string {
  return [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Start/end Date pair for a YYYY-MM-DD key, in server-local time. */
function localDayBounds(dayKey: string): { startAt: Date; endAt: Date } {
  const [year, month, day] = dayKey.split("-").map(Number);
  return {
    startAt: new Date(year, month - 1, day, 0, 0, 0, 0),
    endAt: new Date(year, month - 1, day + 1, 0, 0, 0, 0),
  };
}

async function main() {
  const options = parseArgs();
  const prisma = new PrismaClient();

  try {
    const { startAt, endAt } = localDayBounds(options.date);

    console.log(`Usage report for ${options.date} (server-local day)\n`);

    // ---- Per-surface daily usage counts (DailyApiUsage) --------------------
    const surfaceRows = await prisma.dailyApiUsage.groupBy({
      by: ["surface"],
      where: { dayKey: options.date },
      _sum: { count: true },
      _count: { _all: true },
    });

    if (surfaceRows.length === 0) {
      console.log("DailyApiUsage: no usage recorded for this day.");
    } else {
      console.log("Per-surface usage (DailyApiUsage):");
      for (const row of surfaceRows.sort((a, b) =>
        a.surface.localeCompare(b.surface)
      )) {
        const total = row._sum.count ?? 0;
        console.log(
          `  ${row.surface.padEnd(12)} requests: ${String(total).padStart(6)}   rows: ${row._count._all}`
        );
      }
      console.log(
        "  (rows = distinct user/surface counters; each user counts separately)"
      );
    }

    // ---- InpaintRequest outcome split --------------------------------------
    const splitFor = async (where: { createdAt?: { gte: Date; lt: Date } }) =>
      await prisma.inpaintRequest.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      });

    const printSplit = (title: string, rows: { status: string; _count: { _all: number } }[]) => {
      console.log(`\n${title}`);
      if (rows.length === 0) {
        console.log("  (no requests)");
        return;
      }
      const total = rows.reduce((sum, r) => sum + r._count._all, 0);
      for (const row of rows.sort((a, b) =>
        a.status.localeCompare(b.status)
      )) {
        const n = row._count._all;
        const pct = total > 0 ? ` (${Math.round((n / total) * 100)}%)` : "";
        console.log(`  ${row.status.padEnd(20)} ${String(n).padStart(6)}${pct}`);
      }
      console.log(`  ${"TOTAL".padEnd(20)} ${String(total).padStart(6)}`);
    };

    printSplit(
      `InpaintRequest outcome split for ${options.date}:`,
      await splitFor({ createdAt: { gte: startAt, lt: endAt } })
    );

    if (options.allTime) {
      printSplit("\nInpaintRequest outcome split (all time):", await splitFor({}));
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log("\nDone. This report is read-only; nothing was written.");
}

main().catch((err) => {
  console.error("Usage export failed:", err);
  process.exit(1);
});
