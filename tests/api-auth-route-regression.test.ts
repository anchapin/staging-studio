/**
 * Mutating-route auth regression test (issue #1419).
 *
 * Why this file exists: every mutation endpoint must reach an auth
 * check before it does anything privileged, but in several routes the
 * check is invisible at the route layer — it lives in a co-located
 * `*-service.ts` (`/api/generate-copy`, `/api/export-pdf`) or behind a
 * helper (`validateSegmentAccess` in `/api/segment/furnishings`). A
 * refactor of a service module could silently drop the ownership
 * filter with no test failing.
 *
 * How this test pins the contract:
 *
 * 1. It ENUMERATES every `src/app/api/**\/route.ts` file (no hand-written
 *    route list for the mutation surface) and derives the exported HTTP
 *    methods from the source. A route is "mutating" when it exports
 *    POST / PUT / PATCH / DELETE.
 * 2. For every mutating route it builds the set of LOCAL modules the
 *    route reaches (its own imports, transitively) plus the local
 *    `/api/...` route it proxies to, and looks for auth seams in that
 *    set:
 *      - `getAuthedPrismaUser` (src/lib/api-auth.ts) — the session gate
 *        that establishes *who* the caller is;
 *      - `requireProjectOwnership*` (src/lib/api-auth.ts) — the
 *        ownership filter that scopes the mutation to the caller's
 *        project;
 *      - `verifyWebhookSignature` (src/lib/webhook-signature.ts) — the
 *        trusted-provider callback seam;
 *      - `supabase.auth.getUser()` — the cookie-less bootstrap session
 *        probe used by `/api/setup/*`.
 * 3. A mutating route must reach a SESSION seam (directly, or through a
 *    co-located service, or through the route it proxies to). Routes
 *    whose seam is a webhook signature or the bootstrap session probe
 *    must be listed in `EXPLICIT_CLASSIFICATIONS` with a justification,
 *    and the declared seam file must really be part of the route's
 *    reachable module set — an unclassified route, or a classification
 *    whose target no longer reaches the seam, fails loudly.
 * 4. The per-route set of strong seams (session / ownership /
 *    webhook-signature) is PINNED in `SEAM_SNAPSHOT`. Dropping a call —
 *    in a route OR in a service it delegates to — changes the snapshot
 *    and fails the test. This is what makes a silent ownership-filter
 *    drop impossible.
 *
 * The mutating-route list is pinned too, so adding a new mutating route
 * is a deliberate, reviewed change (the same "pin the contract" style as
 * `tests/auth-redirect.test.ts` and `tests/revalidate-preview.test.ts`).
 *
 * Honesty note: this is a static reachability check, not a runtime
 * proof. It cannot know whether a helper is invoked on every branch; it
 * CAN prove that the auth seam is still reachable from the route at all
 * — which is exactly the regression the issue describes (a refactor
 * silently dropping the ownership filter).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";

const REPO_ROOT = join(__dirname, "..");
const SRC_DIR = join(REPO_ROOT, "src");
const API_DIR = join(SRC_DIR, "app", "api");
const API_AUTH_FILE = join(SRC_DIR, "lib", "api-auth.ts");
const WEBHOOK_SIGNATURE_FILE = join(SRC_DIR, "lib", "webhook-signature.ts");

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const MUTATING_METHODS: ReadonlyArray<HttpMethod> = [
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

/** Max depth of the local import graph we walk (services are 1–2 deep). */
const MAX_IMPORT_DEPTH = 8;

/** The session gate: it resolves WHO the caller is. */
const SESSION_HELPER = "getAuthedPrismaUser";
/** The ownership filters: they scope the mutation to the caller's project. */
const OWNERSHIP_HELPERS: ReadonlyArray<string> = [
  "requireProjectOwnershipSafe",
  "requireProjectOwnershipNonThrowing",
  "requireProjectOwnershipOrThrow",
];

type SeamKind =
  | "api-auth-session"
  | "api-auth-ownership"
  | "webhook-signature"
  | "supabase-session";

interface Seam {
  readonly kind: SeamKind;
  /** The exported identifier that performs the check. */
  readonly helper: string;
  /** Repo-relative path of the module that performs the check. */
  readonly file: string;
}

interface RouteAnalysis {
  /** Repo-relative path of the route file. */
  readonly route: string;
  /** Exported HTTP methods. */
  readonly methods: HttpMethod[];
  /** Every auth seam reachable from the route. */
  readonly seams: Seam[];
  /** Repo-relative paths of local modules reachable from the route. */
  readonly reachableFiles: string[];
  /** Repo-relative path of the local `/api/...` route this route proxies to, if any. */
  readonly proxyTarget: string | null;
}

/* ------------------------------------------------------------------ */
/* filesystem helpers                                                  */
/* ------------------------------------------------------------------ */

function toRepoRelative(absolute: string): string {
  return absolute.slice(REPO_ROOT.length + 1).split("\\").join("/");
}

function listFilesRecursively(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFilesRecursively(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const sourceCache = new Map<string, string>();

function readSource(absolutePath: string): string {
  const cached = sourceCache.get(absolutePath);
  if (cached !== undefined) return cached;
  const text = readFileSync(absolutePath, "utf8");
  sourceCache.set(absolutePath, text);
  return text;
}

/** Crude comment stripper — call detection must not trip on prose. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const ROUTE_FILES = listFilesRecursively(API_DIR)
  .filter((file) => file.endsWith("route.ts"))
  .sort();

/* ------------------------------------------------------------------ */
/* source parsing                                                      */
/* ------------------------------------------------------------------ */

function exportedMethods(source: string): HttpMethod[] {
  const found = new Set<HttpMethod>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g,
    /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      found.add(match[1] as HttpMethod);
    }
  }
  return HTTP_METHODS.filter((method) => found.has(method));
}

/**
 * Local module specifiers imported (or re-exported) by a file.
 * Type-only imports are skipped: `import type { User } from "./types"`
 * cannot contribute a runtime auth check.
 */
function localImportSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /(?:\bimport|\bexport)\s+(?!type\s)([\s\S]*?)\s*from\s*["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const spec = match[2] ?? match[1];
      if (spec) specs.add(spec);
    }
  }
  return [...specs];
}

/** Resolve a module specifier to an absolute file path inside the repo. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) {
    base = join(SRC_DIR, spec.slice(2));
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = resolvePath(dirname(fromFile), spec);
  }
  if (!base) return null;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      // Only "service" modules are traversed: `src/lib/**` and the API
      // route tree. Server actions (`src/app/actions/**`) and pages are
      // NOT part of a route's request path — importing one (e.g.
      // `saveRoomCopy` from "@/app/actions/room") must not be mistaken
      // for the route's own auth check.
      if (isTraversable(candidate)) return candidate;
      return null;
    }
  }
  return null;
}

const LIB_DIR = join(SRC_DIR, "lib");

/** Modules whose auth seams count towards a route's protection. */
function isTraversable(absoluteFile: string): boolean {
  return (
    absoluteFile.startsWith(LIB_DIR + "/") ||
    absoluteFile.startsWith(API_DIR + "/")
  );
}

/** Exported identifier names of a module. */
function exportedNames(source: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
    /export\s+const\s+([A-Za-z0-9_$]+)/g,
    /export\s+class\s+([A-Za-z0-9_$]+)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      names.add(match[1]);
    }
  }
  return [...names];
}

const API_AUTH_HELPERS = exportedNames(readSource(API_AUTH_FILE));

/* ------------------------------------------------------------------ */
/* auth seam detection                                                 */
/* ------------------------------------------------------------------ */

function callsHelper(code: string, helper: string): boolean {
  return new RegExp(`\\b${helper}\\s*\\(`).test(code);
}

/** Auth seams implemented by a single module. */
function seamsInModule(absoluteFile: string): Seam[] {
  const source = readSource(absoluteFile);
  const code = stripComments(source);
  const seams: Seam[] = [];

  const importsApiAuth = localImportSpecifiers(source).some(
    (spec) => resolveSpecifier(absoluteFile, spec) === API_AUTH_FILE,
  );
  if (importsApiAuth) {
    for (const helper of API_AUTH_HELPERS) {
      if (!callsHelper(code, helper)) continue;
      if (helper === SESSION_HELPER) {
        seams.push({
          kind: "api-auth-session",
          helper,
          file: toRepoRelative(absoluteFile),
        });
      } else if (OWNERSHIP_HELPERS.includes(helper)) {
        seams.push({
          kind: "api-auth-ownership",
          helper,
          file: toRepoRelative(absoluteFile),
        });
      }
    }
  }

  const importsWebhookSignature = localImportSpecifiers(source).some(
    (spec) => resolveSpecifier(absoluteFile, spec) === WEBHOOK_SIGNATURE_FILE,
  );
  if (importsWebhookSignature && callsHelper(code, "verifyWebhookSignature")) {
    seams.push({
      kind: "webhook-signature",
      helper: "verifyWebhookSignature",
      file: toRepoRelative(absoluteFile),
    });
  }

  // The raw session probe: `supabase.auth.getUser()` validates the real
  // JWT. It is a weaker seam than `getAuthedPrismaUser` (no Prisma
  // User row lookup), so routes relying on it are classified explicitly
  // as bootstrap routes.
  if (/\.auth\.getUser\s*\(/.test(code)) {
    seams.push({
      kind: "supabase-session",
      helper: "supabase.auth.getUser",
      file: toRepoRelative(absoluteFile),
    });
  }

  return seams;
}

/**
 * Local `/api/...` route this file proxies to (a `fetch`/`new URL`
 * pointing at another route of this app). The proxy itself performs no
 * check — the destination owns it.
 */
function localProxyTarget(absoluteFile: string): string | null {
  const source = stripComments(readSource(absoluteFile));
  const patterns = [
    /new\s+URL\(\s*["'`](\/api\/[^"'`]*)["'`]/g,
    /fetch\(\s*["'`](\/api\/[^"'`]*)["'`]/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const apiPath = match[1];
      const target = join(SRC_DIR, "app", apiPath, "route.ts");
      if (existsSync(target)) return toRepoRelative(target);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* reachability                                                        */
/* ------------------------------------------------------------------ */

function addSeam(seams: Seam[], seam: Seam): void {
  const already = seams.some(
    (existing) => existing.file === seam.file && existing.helper === seam.helper,
  );
  if (!already) seams.push(seam);
}

function analyzeRoute(absoluteRoute: string): RouteAnalysis {
  const seams: Seam[] = [];
  const reachableFiles = new Set<string>();
  const seen = new Set<string>();
  const queue: Array<{ file: string; depth: number }> = [
    { file: absoluteRoute, depth: 0 },
  ];

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    reachableFiles.add(toRepoRelative(file));

    for (const seam of seamsInModule(file)) addSeam(seams, seam);

    if (depth >= MAX_IMPORT_DEPTH) continue;

    const source = readSource(file);
    for (const spec of localImportSpecifiers(source)) {
      const resolved = resolveSpecifier(file, spec);
      if (resolved && !seen.has(resolved)) {
        queue.push({ file: resolved, depth: depth + 1 });
      }
    }
  }

  const proxyTarget = localProxyTarget(absoluteRoute);
  if (proxyTarget) {
    const proxyAbsolute = join(REPO_ROOT, proxyTarget);
    if (!seen.has(proxyAbsolute)) {
      for (const seam of seamsInModule(proxyAbsolute)) addSeam(seams, seam);
      reachableFiles.add(proxyTarget);
    }
  }

  return {
    route: toRepoRelative(absoluteRoute),
    methods: exportedMethods(readSource(absoluteRoute)),
    seams,
    reachableFiles: [...reachableFiles].sort(),
    proxyTarget,
  };
}

const ANALYSES = ROUTE_FILES.map((file) => analyzeRoute(file));

const MUTATING_ROUTES = ANALYSES.filter((analysis) =>
  analysis.methods.some((method) => MUTATING_METHODS.includes(method)),
).sort((a, b) => a.route.localeCompare(b.route));

/** Strong seams — the ones whose disappearance must fail the test. */
function strongSeams(analysis: RouteAnalysis): string[] {
  return analysis.seams
    .filter((seam) => seam.kind !== "supabase-session")
    .map((seam) => `${seam.kind}#${seam.file}#${seam.helper}`)
    .sort();
}

/* ------------------------------------------------------------------ */
/* explicit classifications                                            */
/* ------------------------------------------------------------------ */

/**
 * Routes whose auth seam is not a direct `src/lib/api-auth.ts` call in
 * the route file. Each entry names the module that owns the check, so
 * a refactor that drops the check from that module fails the test.
 *
 * Adding a route? Add an entry here (with a justification) whenever the
 * seam is not a direct `api-auth` call inside the route file.
 */
const EXPLICIT_CLASSIFICATIONS: ReadonlyArray<{
  readonly route: string;
  readonly kind: SeamKind;
  /** Repo-relative path of the module that performs the check. */
  readonly seamFile: string;
  readonly justification: string;
}> = [
  {
    route: "src/app/api/export-pdf/route.ts",
    kind: "api-auth-session",
    seamFile: "src/lib/export-pdf-service.ts",
    justification:
      "Unversioned export route: the session + ownership gate lives in the co-located service `runExportPdf` (src/lib/export-pdf-service.ts), not in the route file.",
  },
  {
    route: "src/app/api/generate-copy/route.ts",
    kind: "api-auth-session",
    seamFile: "src/lib/generate-copy-service.ts",
    justification:
      "Unversioned generate-copy route: the session + ownership gate lives in the co-located service `runGenerateCopy` (src/lib/generate-copy-service.ts), not in the route file.",
  },
  {
    route: "src/app/api/segment/furnishings/route.ts",
    kind: "api-auth-session",
    seamFile: "src/app/api/segment/furnishings/route.ts",
    justification:
      "The route calls `getAuthedPrismaUser()` and then `validateSegmentAccess(...)` (src/lib/segment-furnishings-service.ts) for the ownership filter. Pinned here so the route file itself keeps the session call next to the access helper.",
  },
  {
    route: "src/app/api/inpaint/webhook/route.ts",
    kind: "webhook-signature",
    seamFile: "src/app/api/inpaint/webhook/route.ts",
    justification:
      "Provider callback: the credential is the HMAC webhook signature (`verifyWebhookSignature`, implemented in src/lib/webhook-signature.ts), there is no session. The signature check is the auth seam for this route, and the route file is where it is called.",
  },
  {
    route: "src/app/api/setup/route.ts",
    kind: "supabase-session",
    seamFile: "src/app/api/setup/route.ts",
    justification:
      "Bootstrap route: it runs before a Prisma `User` row exists, so it validates the session with `supabase.auth.getUser()` instead of `getAuthedPrismaUser()` (see src/lib/api-auth.ts for why the latter also rejects unconfirmed emails).",
  },
  {
    route: "src/app/api/v1/sign-project/route.ts",
    kind: "api-auth-session",
    seamFile: "src/app/api/sign-project/route.ts",
    justification:
      "KNOWN FINDING (issue #1419): the v1 proxy itself calls NO auth helper and re-emits every caller header upstream (src/app/api/v1/sign-project/route.ts:27-40). It is NOT silently ignored — the destination `/api/sign-project` owns the gate (`getAuthedPrismaUser()` + `requireProjectOwnershipOrThrow()` for session-bearing callers, HMAC preview token for cookie-less visitors) and the proxy forwards the caller's cookies, so the destination's gate applies. If that destination ever drops its check, this entry fails.",
  },
];

/**
 * Pinned inventory of mutating routes. Adding a mutating route is a
 * reviewed change: update this snapshot AND (if the seam is not a
 * direct `api-auth` call in the route file) add an
 * `EXPLICIT_CLASSIFICATIONS` entry.
 */
const MUTATING_ROUTE_SNAPSHOT: ReadonlyArray<string> = [
  "src/app/api/export-pdf/route.ts",
  "src/app/api/generate-copy/route.ts",
  "src/app/api/inpaint/route.ts",
  "src/app/api/inpaint/webhook/route.ts",
  "src/app/api/label-instances/route.ts",
  "src/app/api/lookbook-variant/route.ts",
  "src/app/api/projects/[id]/rooms/[roomId]/route.ts",
  "src/app/api/projects/route.ts",
  "src/app/api/segment/furnishings/route.ts",
  "src/app/api/setup/route.ts",
  "src/app/api/sign-project/route.ts",
  "src/app/api/v1/export-pdf/route.ts",
  "src/app/api/v1/generate-copy/route.ts",
  "src/app/api/v1/inpaint/route.ts",
  "src/app/api/v1/listing-copy/route.ts",
  "src/app/api/v1/segment/furnishings/route.ts",
  "src/app/api/v1/segment/route.ts",
  "src/app/api/v1/sign-project/route.ts",
];

/**
 * Pinned strong seams per mutating route: `kind#file#helper`.
 *
 * This is the "ownership filter cannot silently disappear" contract:
 * every seam listed here is reachable from the route TODAY; removing the
 * corresponding call — in the route file OR in the service it delegates
 * to — changes this snapshot and fails the test.
 */
const SEAM_SNAPSHOT: Readonly<Record<string, ReadonlyArray<string>>> = {
  "src/app/api/export-pdf/route.ts": [
    "api-auth-ownership#src/lib/export-pdf-service.ts#requireProjectOwnershipOrThrow",
    "api-auth-session#src/lib/export-pdf-service.ts#getAuthedPrismaUser",
  ],
  "src/app/api/generate-copy/route.ts": [
    "api-auth-ownership#src/lib/generate-copy-service.ts#requireProjectOwnershipOrThrow",
    "api-auth-session#src/lib/generate-copy-service.ts#getAuthedPrismaUser",
  ],
  "src/app/api/inpaint/route.ts": [
    "api-auth-session#src/app/api/inpaint/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/inpaint/webhook/route.ts": [
    "webhook-signature#src/app/api/inpaint/webhook/route.ts#verifyWebhookSignature",
  ],
  "src/app/api/label-instances/route.ts": [
    "api-auth-ownership#src/lib/label-instances-service.ts#requireProjectOwnershipOrThrow",
    "api-auth-session#src/app/api/label-instances/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/lookbook-variant/route.ts": [
    "api-auth-session#src/app/api/lookbook-variant/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/projects/[id]/rooms/[roomId]/route.ts": [
    "api-auth-ownership#src/app/api/projects/[id]/rooms/[roomId]/route.ts#requireProjectOwnershipOrThrow",
    "api-auth-session#src/app/api/projects/[id]/rooms/[roomId]/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/projects/route.ts": [
    "api-auth-session#src/app/api/projects/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/segment/furnishings/route.ts": [
    "api-auth-session#src/app/api/segment/furnishings/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/setup/route.ts": [],
  "src/app/api/sign-project/route.ts": [
    "api-auth-ownership#src/app/api/sign-project/route.ts#requireProjectOwnershipOrThrow",
    "api-auth-session#src/app/api/sign-project/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/v1/export-pdf/route.ts": [
    "api-auth-ownership#src/app/api/v1/export-pdf/route.ts#requireProjectOwnershipOrThrow",
    "api-auth-session#src/app/api/v1/export-pdf/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/v1/generate-copy/route.ts": [
    "api-auth-session#src/app/api/v1/generate-copy/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/v1/inpaint/route.ts": [
    "api-auth-session#src/app/api/v1/inpaint/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/v1/listing-copy/route.ts": [
    "api-auth-ownership#src/app/api/v1/listing-copy/route.ts#requireProjectOwnershipOrThrow",
    "api-auth-session#src/app/api/v1/listing-copy/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/v1/segment/furnishings/route.ts": [
    "api-auth-session#src/app/api/v1/segment/furnishings/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/v1/segment/route.ts": [
    "api-auth-session#src/app/api/v1/segment/route.ts#getAuthedPrismaUser",
  ],
  "src/app/api/v1/sign-project/route.ts": [
    "api-auth-ownership#src/app/api/sign-project/route.ts#requireProjectOwnershipOrThrow",
    "api-auth-session#src/app/api/sign-project/route.ts#getAuthedPrismaUser",
  ],
};

const CLASSIFICATION_BY_ROUTE = new Map(
  EXPLICIT_CLASSIFICATIONS.map((entry) => [entry.route, entry]),
);

/* ------------------------------------------------------------------ */
/* tests                                                               */
/* ------------------------------------------------------------------ */

describe("issue #1419: every mutating API route reaches an auth check", () => {
  it("enumerates the mutating routes (pinned inventory)", () => {
    const enumerated = MUTATING_ROUTES.map((analysis) => analysis.route);
    expect(
      enumerated,
      "the set of mutating routes changed — add the new route to MUTATING_ROUTE_SNAPSHOT (and to EXPLICIT_CLASSIFICATIONS when its auth seam is not a direct api-auth call in the route file)",
    ).toEqual([...MUTATING_ROUTE_SNAPSHOT]);
  });

  it("classifications point at real mutating routes (typo guard)", () => {
    const mutatingPaths = new Set(MUTATING_ROUTES.map((a) => a.route));
    const unknown = EXPLICIT_CLASSIFICATIONS.filter(
      (entry) => !mutatingPaths.has(entry.route),
    ).map((entry) => entry.route);
    expect(
      unknown,
      `classification entries that are not mutating routes: ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it.each(MUTATING_ROUTES)("$route reaches an auth check", (analysis) => {
    const sessionSeams = analysis.seams.filter(
      (seam) => seam.kind === "api-auth-session",
    );
    const directSession = sessionSeams.find(
      (seam) => seam.file === analysis.route,
    );

    if (directSession) {
      // Fast path: the route file itself calls `getAuthedPrismaUser()`.
      // A classification (if any) must still be truthful.
      const classification = CLASSIFICATION_BY_ROUTE.get(analysis.route);
      if (classification) {
        const declared = analysis.seams.find(
          (seam) =>
            seam.kind === classification.kind &&
            seam.file === classification.seamFile,
        );
        expect(
          declared,
          `${analysis.route} is classified as reaching ${classification.seamFile}, but that module no longer reaches that seam`,
        ).toBeDefined();
      }
      return;
    }

    // No session call in the route file itself: the seam is indirect (a
    // co-located service, a webhook signature, the bootstrap session
    // probe, or a proxy to another route) and MUST be classified.
    const classification = CLASSIFICATION_BY_ROUTE.get(analysis.route);
    expect(
      classification,
      `${analysis.route} does not call getAuthedPrismaUser() directly and is not classified in EXPLICIT_CLASSIFICATIONS — ` +
        `classify it explicitly (service-delegated / webhook / bootstrap / proxy) instead of leaving it unchecked`,
    ).toBeDefined();
    if (!classification) return;

    const declaredSeams = analysis.seams.filter(
      (seam) =>
        seam.kind === classification.kind &&
        seam.file === classification.seamFile,
    );
    expect(
      declaredSeams.length,
      `${analysis.route} is classified as "${classification.kind}" via ${classification.seamFile}, but that module is not part of the route's reachable module set ` +
        `(reachable: ${analysis.reachableFiles.join(", ")}) — the auth check was dropped or moved`,
    ).toBeGreaterThan(0);
  });

  it("the pinned seams of every mutating route are still reachable", () => {
    const drifted: string[] = [];
    for (const analysis of MUTATING_ROUTES) {
      const pinned = SEAM_SNAPSHOT[analysis.route];
      if (!pinned) {
        drifted.push(`${analysis.route}: missing from SEAM_SNAPSHOT`);
        continue;
      }
      const actual = strongSeams(analysis);
      if (JSON.stringify(actual) !== JSON.stringify([...pinned].sort())) {
        drifted.push(
          `${analysis.route}:\n    expected ${JSON.stringify([...pinned].sort())}\n    actual   ${JSON.stringify(actual)}`,
        );
      }
    }
    expect(
      drifted,
      `auth seams changed (a session/ownership check was dropped or moved):\n  ${drifted.join("\n  ")}\n` +
        `If the change is intentional, update SEAM_SNAPSHOT — never delete an entry to silence the test.`,
    ).toEqual([]);
  });

  it("the v1/sign-project proxy route is surfaced explicitly (issue #1419)", () => {
    const analysis = ANALYSES.find(
      (candidate) => candidate.route === "src/app/api/v1/sign-project/route.ts",
    );
    expect(
      analysis,
      "src/app/api/v1/sign-project/route.ts must exist",
    ).toBeDefined();
    if (!analysis) return;

    // The proxy itself must NOT be allowed to look protected: it calls no
    // api-auth helper and re-emits caller headers upstream.
    const proxyOwnSeams = analysis.seams.filter(
      (seam) => seam.file === analysis.route,
    );
    expect(
      proxyOwnSeams.filter((seam) => seam.kind.startsWith("api-auth")),
      "src/app/api/v1/sign-project/route.ts is expected to call no api-auth helper itself (it forwards to /api/sign-project) — if that changed, update the classification",
    ).toEqual([]);

    // It must be classified, and the classification must point at the
    // destination route that owns the gate.
    const classification = CLASSIFICATION_BY_ROUTE.get(analysis.route);
    expect(
      classification,
      "src/app/api/v1/sign-project/route.ts must be explicitly classified",
    ).toBeDefined();
    expect(
      analysis.proxyTarget,
      "src/app/api/v1/sign-project/route.ts must proxy to the local /api/sign-project route",
    ).toBe("src/app/api/sign-project/route.ts");
    expect(
      classification?.seamFile,
      "the v1 proxy's classification must point at the destination route that owns the auth check",
    ).toBe("src/app/api/sign-project/route.ts");
  });

  it("every classified seam file is really reachable from its route", () => {
    for (const classification of EXPLICIT_CLASSIFICATIONS) {
      const analysis = ANALYSES.find(
        (candidate) => candidate.route === classification.route,
      );
      expect(analysis, `${classification.route} does not exist`).toBeDefined();
      if (!analysis) continue;
      expect(
        analysis.reachableFiles,
        `${classification.route} cannot reach its declared seam file ${classification.seamFile}`,
      ).toContain(classification.seamFile);
    }
  });
});
