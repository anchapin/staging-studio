// Runs the repo's mock Supabase (tests/e2e/mock-supabase.ts) standalone.
// No top-level await: tsx may compile this file as CJS.
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.env.UX_PROTO_REPO ?? "/repo";

async function main(): Promise<void> {
  const mod = (await import(
    pathToFileURL(path.join(REPO, "tests/e2e/mock-supabase.ts")).href
  )) as { MockSupabase: new () => { start(): Promise<void> } };
  const mock = new mod.MockSupabase();
  await mock.start();
  console.log("[dana-rig] mock supabase up on 127.0.0.1:39911 (forwarded to :39912)");
  await new Promise(() => {});
}

void main();
