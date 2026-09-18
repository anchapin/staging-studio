import { execSync, spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

import {
  APP_URL,
  DATABASE_URL,
  E2E_CONCEPT_PROJECT_ID,
  E2E_CONCEPT_ROOM_ID,
  E2E_EDITOR_PROJECT_ID,
  E2E_EDITOR_ROOM_ID,
  E2E_EMAIL,
  E2E_REHEARSAL_PROJECT_ID,
  E2E_REHEARSAL_ROOM_ID,
  E2E_LOOKBOOK_ROOM_ID,
  E2E_UPLOAD_PROJECT_ID,
  E2E_UPLOAD_ROOM_ID,
  E2E_USER_ID,
  MOCK_SUPABASE_HOST,
  MOCK_SUPABASE_PORT,
  POSTGRES_CONTAINER_NAME,
  POSTGRES_IMAGE,
  POSTGRES_PORT,
  roomPhotoPublicUrl,
} from "./env";
import { MockSupabase } from "./mock-supabase";
import { roomPhotoFixture, stagedResultFixture } from "./fixtures";

/**
 * Playwright global setup (issue #165).
 *
 * Brings up a fully local, disposable stack:
 *   1. Dockerized Postgres (fresh container per run) + `prisma db push`.
 *   2. Seeded User → Projects → Rooms rows with FIXED ids so specs can
 *      navigate by URL deterministically. The "editor" and "rehearsal"
 *      rooms are seeded with a before photo served by the mock storage,
 *      which is the prerequisite for the focused staging editor.
 *   3. The mock Supabase (GoTrue auth + Storage) HTTP server, kept alive
 *      for the whole test run (it lives in this process).
 *
 * The Next.js server itself is started later by playwright.config.ts's
 * `webServer`, pointed at the same mock + database via `nextEnv()`.
 */

declare global {
  var __e2eMockSupabase: MockSupabase | undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function docker(args: string, options: { stdio?: "pipe" | "inherit" } = {}): void {
  spawnSync("docker", args.split(/\s+/), { stdio: options.stdio ?? "pipe" });
}

function dockerOutput(args: string): string {
  const result = spawnSync("docker", args.split(/\s+/), { encoding: "utf8" });
  return (result.stdout ?? "").trim();
}

async function ensureDockerPostgres(): Promise<void> {
  const running = dockerOutput(`ps --filter name=${POSTGRES_CONTAINER_NAME} --format {{.Names}}`);
  if (running === POSTGRES_CONTAINER_NAME) {
    docker(`rm -f ${POSTGRES_CONTAINER_NAME}`);
  }

  const imagePresent =
    spawnSync("docker", ["image", "inspect", POSTGRES_IMAGE], { stdio: "pipe" }).status === 0;
  if (!imagePresent) {
    console.log(`[e2e] pulling ${POSTGRES_IMAGE} (one-time)...`);
    execSync(`docker pull ${POSTGRES_IMAGE}`, { stdio: "inherit" });
  }

  spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      POSTGRES_CONTAINER_NAME,
      "-e",
      "POSTGRES_USER=e2e",
      "-e",
      "POSTGRES_PASSWORD=e2e",
      "-e",
      "POSTGRES_DB=staging_studio_e2e",
      "-p",
      `127.0.0.1:${POSTGRES_PORT}:5432`,
      POSTGRES_IMAGE,
    ],
    { stdio: "pipe" }
  );

  const deadline = Date.now() + 60_000;
  for (;;) {
    // Probe over TCP inside the container — pg_isready's default unix
    // socket also "accepts" during the initdb bootstrap phase, before the
    // real server listens, which would race the schema push.
    const ready =
      spawnSync(
        "docker",
        [
          "exec",
          POSTGRES_CONTAINER_NAME,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-p",
          "5432",
          "-U",
          "e2e",
          "-d",
          "staging_studio_e2e",
        ],
        { encoding: "utf8" }
      ).status === 0;
    if (ready) break;
    if (Date.now() > deadline) {
      throw new Error(`Postgres container ${POSTGRES_CONTAINER_NAME} did not become ready in 60s`);
    }
    await sleep(500);
  }
  console.log("[e2e] postgres ready");
}

async function pushSchema(): Promise<void> {
  // The published port can lag the in-container readiness moment by a
  // moment (bootstrap → restart cycle); retry a few times before giving up.
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL },
    });
    if (result.status === 0) return;
    lastError = new Error(
      `prisma db push failed (attempt ${attempt}/5, exit ${result.status})`
    );
    console.error(String(lastError));
    await sleep(2000);
  }
  throw lastError;
}

async function seed(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  try {
    const beforePhotoUrl = roomPhotoPublicUrl(`rooms/${E2E_EDITOR_ROOM_ID}/before-image.png`);
    const conceptBeforePhotoUrl = roomPhotoPublicUrl(
      `rooms/${E2E_CONCEPT_ROOM_ID}/before-image.png`
    );

    await prisma.user.create({
      data: {
        id: E2E_USER_ID,
        email: E2E_EMAIL,
        firmName: "Circle G Designs — E2E",
        ownerName: "E2E Harness",
        projects: {
          create: [
            {
              id: E2E_UPLOAD_PROJECT_ID,
              propertyAddress: "101 Upload Lane",
              clientName: "Upload Client",
              targetBuyer: "young professional couple",
              stagingAesthetic: "Organic Modern Luxury",
              rooms: {
                create: [
                  {
                    id: E2E_UPLOAD_ROOM_ID,
                    name: "Upload Room",
                  },
                ],
              },
            },
            {
              id: E2E_EDITOR_PROJECT_ID,
              propertyAddress: "202 Editor Court",
              clientName: "Editor Client",
              targetBuyer: "growing family",
              stagingAesthetic: "Warm Transitional",
              rooms: {
                create: [
                  {
                    id: E2E_EDITOR_ROOM_ID,
                    name: "Mask Room",
                    beforeImageUrl: beforePhotoUrl,
                  },
                ],
              },
            },
            {
              id: E2E_CONCEPT_PROJECT_ID,
              propertyAddress: "404 Concept Crescent",
              clientName: "Concept Client",
              targetBuyer: "first-time buyers",
              stagingAesthetic: "Vintage Modern",
              rooms: {
                create: [
                  {
                    id: E2E_CONCEPT_ROOM_ID,
                    name: "Concept Room",
                    beforeImageUrl: conceptBeforePhotoUrl,
                  },
                ],
              },
            },
            {
              id: E2E_REHEARSAL_PROJECT_ID,
              propertyAddress: "303 Rehearsal Road",
              clientName: "Rehearsal Client",
              targetBuyer: "empty nesters",
              stagingAesthetic: "Vintage Modern",
              rooms: {
                create: [
                  {
                    id: E2E_REHEARSAL_ROOM_ID,
                    name: "Rehearsal Room",
                  },
                  {
                    id: E2E_LOOKBOOK_ROOM_ID,
                    name: "Lookbook Suite",
                    observedChallenge:
                      "North-facing living room reads dim in listing photos.",
                    recommendation:
                      "Layer warm lamps and lighten textiles to lift the space.",
                    buyerPsychology:
                      "Empty nesters read brightness as low-maintenance comfort.",
                    checklistItems: [
                      {
                        item: "Replace burnt-out bulbs with warm white",
                        category: "Minor Repair",
                        priority: "High",
                      },
                      {
                        item: "Store oversized recliner during showings",
                        category: "DIY/Declutter",
                        priority: "Critical",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log("[e2e] app under test:", APP_URL);
  console.log(`[e2e] mock supabase:  http://${MOCK_SUPABASE_HOST}:${MOCK_SUPABASE_PORT}`);

  ensureDockerPostgres();
  await pushSchema();
  await seed();

  const mock = new MockSupabase();
  // Back the seeded rooms' before-photo URLs with real bytes so the app
  // (and next/image's server-side optimizer) can actually fetch them.
  mock.putObject(
    "room-photos",
    `rooms/${E2E_EDITOR_ROOM_ID}/before-image.png`,
    roomPhotoFixture(),
    "image/png"
  );
  mock.putObject(
    "room-photos",
    `rooms/${E2E_CONCEPT_ROOM_ID}/before-image.png`,
    roomPhotoFixture(),
    "image/png"
  );
  await mock.start();
  // Keep a handle so global-teardown can stop the server (it lives in the
  // same long-lived runner process).
  globalThis.__e2eMockSupabase = mock;

  console.log(
    `[e2e] seeded fixtures: room photo ${roomPhotoFixture().length}B, ` +
      `staged result ${stagedResultFixture().length}B — mock ready`
  );
}

export default main;
