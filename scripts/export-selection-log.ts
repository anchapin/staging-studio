#!/usr/bin/env tsx
/**
 * SelectionLog Corpus Export Script (issue #238 / wave W3)
 *
 * Dumps the SelectionLog table to CSV and JSON for the training corpus.
 * Safe to run repeatedly; read-only from the application's perspective.
 *
 * Usage:
 *   # Export both formats (default: ~/selection-log-export-{timestamp}.csv and .json)
 *   npx tsx scripts/export-selection-log.ts
 *
 *   # Export only CSV
 *   npx tsx scripts/export-selection-log.ts --format csv
 *
 *   # Export with custom output prefix
 *   npx tsx scripts/export-selection-log.ts --output /path/to/my-export
 *
 *   # Export only records for a specific room
 *   npx tsx scripts/export-selection-log.ts --room-id <roomId>
 *
 * Environment:
 *   DATABASE_URL must be set ( Supabase Postgres connection string).
 *   The script reads .env.local via Prisma but also respects a .env symlink
 *   (same as other Prisma CLI commands - see AGENTS.md).
 *
 * Output format (CSV):
 *   id,roomId,concept,instanceIndex,score,editedLabel,createdAt
 *
 * Output format (JSON):
 *   Array of objects: { id, roomId, concept, instanceIndex, score, editedLabel, createdAt }
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = process.env.SELECTION_LOG_EXPORT_DIR ?? "./exports";

interface ExportOptions {
  format: "csv" | "json" | "both";
  outputPrefix: string;
  roomId?: string;
  since?: Date;
}

function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);
  const options: ExportOptions = {
    format: "both",
    outputPrefix: path.join(OUTPUT_DIR, `selection-log-${Date.now()}`),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--format":
        const format = args[++i];
        if (format === "csv" || format === "json" || format === "both") {
          options.format = format;
        }
        break;
      case "--output":
        options.outputPrefix = args[++i];
        break;
      case "--room-id":
        options.roomId = args[++i];
        break;
      case "--since":
        options.since = new Date(args[++i]);
        break;
      case "--help":
        console.log("Usage: npx tsx scripts/export-selection-log.ts [--format csv|json|both] [--output <prefix>] [--room-id <roomId>] [--since <ISO date>]");
        process.exit(0);
    }
  }

  return options;
}

function toCSVRow(record: {
  id: string;
  roomId: string;
  concept: string;
  instanceIndex: number;
  score: number;
  editedLabel: string | null;
  createdAt: Date;
}): string {
  const fields = [
    record.id,
    record.roomId,
    record.concept,
    record.instanceIndex.toString(),
    record.score.toString(),
    record.editedLabel ?? "",
    record.createdAt.toISOString(),
  ];
  // Escape fields that contain commas or quotes
  return fields
    .map((f) => {
      if (f.includes(",") || f.includes('"') || f.includes("\n")) {
        return `"${f.replace(/"/g, '""')}"`;
      }
      return f;
    })
    .join(",");
}

async function main() {
  const options = parseArgs();
  const prisma = new PrismaClient();

  try {
    const where: {
      roomId?: string;
      createdAt?: { gte: Date };
    } = {};

    if (options.roomId) {
      where.roomId = options.roomId;
    }
    if (options.since) {
      where.createdAt = { gte: options.since };
    }

    const records = await prisma.selectionLog.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });

    console.log(`Found ${records.length} SelectionLog records to export`);

    if (records.length === 0) {
      console.log("Nothing to export.");
      return;
    }

    // Ensure output directory exists
    const outputDir = path.dirname(options.outputPrefix);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    if (options.format === "csv" || options.format === "both") {
      const csvPath = `${options.outputPrefix}.csv`;
      const csvHeader = "id,roomId,concept,instanceIndex,score,editedLabel,createdAt";
      const csvContent = [
        csvHeader,
        ...records.map(toCSVRow),
      ].join("\n");
      fs.writeFileSync(csvPath, csvContent);
      console.log(`CSV exported to: ${csvPath}`);
    }

    if (options.format === "json" || options.format === "both") {
      const jsonPath = `${options.outputPrefix}.json`;
      const jsonContent = JSON.stringify(
        records.map((r) => ({
          id: r.id,
          roomId: r.roomId,
          concept: r.concept,
          instanceIndex: r.instanceIndex,
          score: r.score,
          editedLabel: r.editedLabel,
          createdAt: r.createdAt.toISOString(),
        })),
        null,
        2
      );
      fs.writeFileSync(jsonPath, jsonContent);
      console.log(`JSON exported to: ${jsonPath}`);
    }

    console.log("\nExport complete.");
    console.log("\nUsage in training pipeline:");
    console.log(`  CSV: import from ${options.outputPrefix}.csv`);
    console.log(`  JSON: import from ${options.outputPrefix}.json`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
