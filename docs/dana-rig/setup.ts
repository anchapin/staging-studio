/**
 * UX-prototype harness setup (NOT part of the repo test suite).
 *
 * Brings up a local stack for persona-driven UX testing without Docker
 * and without real API keys:
 *   1. Local Postgres + `prisma db push`.
 *   2. The repo's mock Supabase (GoTrue auth + Storage) HTTP server.
 *   3. Seed: one Prisma user matching the mock auth identity, one project,
 *      one empty room ("Living Room") — the persona uploads the before
 *      photo and stages it through the real UI.
 *
 * Run from anywhere (set UX_PROTO_REPO to your staging-studio checkout,
 * defaults to the original dev path):
 *   UX_PROTO_REPO=/path/to/staging-studio npx tsx setup.ts
 * Keeps running (mock server); the Next.js dev server is started separately.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const REPO =
  process.env.UX_PROTO_REPO ?? "/home/hatch/workspace/staging-studio";
const asUrl = (p: string) => pathToFileURL(p).href;

// Resolved against the repo so this file can live outside the checkout.
const repoRequire = createRequire(path.join(REPO, "package.json"));
const { PrismaClient } = repoRequire("@prisma/client") as typeof import("@prisma/client");

interface TestHelpers {
  MockSupabase: new () => { start(): Promise<void> };
  E2E_EMAIL: string;
  E2E_USER_ID: string;
}

async function loadTestHelpers(): Promise<TestHelpers> {
  const { MockSupabase } = await import(
    asUrl(path.join(REPO, "tests/e2e/mock-supabase.ts"))
  );
  const { E2E_EMAIL, E2E_USER_ID } = await import(
    asUrl(path.join(REPO, "tests/e2e/env.ts"))
  );
  return { MockSupabase, E2E_EMAIL, E2E_USER_ID };
}

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://uxproto:uxproto@127.0.0.1:5432/staging_studio_ux";

export const UX_PROJECT_ID = "uxprotoproject000000000000proj";
export const UX_ROOM_ID = "uxprotoroom0000000000000000room";

async function pushSchema(): Promise<void> {
  const result = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL },
    cwd: REPO,
  });
  if (result.status !== 0) throw new Error("prisma db push failed");
}

async function seed(helpers: TestHelpers): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  try {
    // Idempotent: wipe previous proto rows.
    await prisma.user.deleteMany({ where: { email: helpers.E2E_EMAIL } });

    await prisma.user.create({
      data: {
        id: helpers.E2E_USER_ID,
        email: helpers.E2E_EMAIL,
        firmName: "Circle G Designs",
        ownerName: "UX Proto",
        projects: {
          create: [
            {
              id: UX_PROJECT_ID,
              propertyAddress: "789 Prototype Lane",
              clientName: "Proto Client",
              targetBuyer: "young professional couple",
              stagingAesthetic: "Warm Transitional",
              rooms: {
                create: [{ id: UX_ROOM_ID, name: "Living Room" }],
              },
            },
          ],
        },
      },
    });
    console.log("[ux-proto] seeded user + project", UX_PROJECT_ID, "room", UX_ROOM_ID);
    console.log("[ux-proto] login:", helpers.E2E_EMAIL, "/ any password (mock auth accepts anything)");
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const helpers = await loadTestHelpers();
  await pushSchema();
  await seed(helpers);
  if (process.env.UX_PROTO_SETUP_ONESHOT === "1") {
    console.log("[ux-proto] oneshot mode: schema pushed + seeded, exiting");
    return;
  }
  const mock = new helpers.MockSupabase();
  await mock.start();
  console.log("[ux-proto] mock supabase up");
  // Keep alive for the dev server session.
  await new Promise(() => {});
}

void main();
