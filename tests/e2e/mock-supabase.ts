import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, createHmac } from "node:crypto";

import {
  E2E_EMAIL,
  E2E_OTHER_EMAIL,
  E2E_OTHER_USER_ID,
  E2E_USER_ID,
  MOCK_SUPABASE_HOST,
  MOCK_SUPABASE_PORT,
} from "./env";
import { stagedResultFixture, stagedResultFixtureB } from "./fixtures";

/**
 * Local mock of the two Supabase surfaces the app touches (issue #165).
 *
 * Auth (GoTrue): the middleware, server components, server actions, and
 * the login page all funnel through `supabase.auth.getUser()` /
 * `signInWithPassword` against `NEXT_PUBLIC_SUPABASE_URL`. The mock mints
 * a real HS256 JWT (self-signed — nothing validates it against a real
 * authority) and answers the exact endpoint/response shapes of
 * @supabase/auth-js 2.x:
 *   POST /auth/v1/token?grant_type=password    → flat session JSON (user inline)
 *   POST /auth/v1/token?grant_type=refresh_token → same
 *   GET  /auth/v1/user                          → user object directly
 *   POST /auth/v1/logout                        → 204
 *
 * Storage: serves both upload flows the app uses:
 *   POST /storage/v1/object/upload/sign/<bucket>/<path> → { url: "...?token=..." }
 *   PUT  /storage/v1/object/upload/sign/<bucket>/<path>?token=… → stores bytes
 *   POST /storage/v1/object/<bucket>/<path>             → stores bytes (plain
 *        upload — the saveInpaintVersion thumbnail path, issue #747; supabase-js
 *        wraps Blob bodies in a multipart/form-data envelope, so the file
 *        part is unwrapped before storing)
 *   GET  /storage/v1/object/public/<bucket>/<path>      → stored bytes
 * Received objects are hashed so specs can prove the browser PUT body and
 * the stored object are byte-identical (the PoC bug stored 0-byte objects).
 *
 * Test inspection endpoints (not part of Supabase's surface):
 *   GET  /__e2e/storage  → [{ bucket, path, size, sha256, contentType }]
 *   POST /__e2e/reset    → clears stored objects
 *
 * Everything answers with permissive CORS headers: the page origin (port
 * 3100) differs from the mock origin (54321), so browser fetches are
 * cross-origin.
 */

export interface StoredObject {
  bucket: string;
  path: string;
  bytes: Buffer;
  contentType: string;
  size: number;
  sha256: string;
}

const JWT_SECRET = "e2e-hmac-secret";

interface MockIdentity {
  id: string;
  email: string;
}

/**
 * Every GoTrue identity the mock can issue a session for (issue #1101).
 * The password-grant endpoint picks one by matching the request body's
 * `email` field against this list, so specs can sign in as the second
 * user without rewriting the existing single-user helpers — `login()`
 * still uses the default identity, `loginAs(page, email)` selects from
 * here.
 *
 * The Prisma `User` row MUST exist for any email a spec passes to
 * `loginAs` — `getAuthedPrismaUser` in `src/lib/api-auth.ts` resolves
 * the row by `user.email`, so a GoTrue session with no matching Prisma
 * row yields a 401 even when the password grant succeeds.
 */
const KNOWN_IDENTITIES: MockIdentity[] = [
  { id: E2E_USER_ID, email: E2E_EMAIL },
  { id: E2E_OTHER_USER_ID, email: E2E_OTHER_EMAIL },
];

function findIdentityByEmail(email: string): MockIdentity | null {
  return KNOWN_IDENTITIES.find((identity) => identity.email === email) ?? null;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function signJwt(user: MockIdentity): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      aud: "authenticated",
      role: "authenticated",
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    })
  );
  const signature = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${claims}`)
    .digest("base64url");
  return `${header}.${claims}.${signature}`;
}

function mockUser(identity: MockIdentity): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: identity.id,
    aud: "authenticated",
    role: "authenticated",
    email: identity.email,
    email_confirmed_at: now,
    phone: "",
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
  };
}

function mockSession(identity: MockIdentity): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    access_token: signJwt(identity),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: nowSeconds + 3600,
    refresh_token: `e2e-refresh-${nowSeconds}-${identity.id}`,
    user: mockUser(identity),
  };
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, apikey, content-type, x-client-info, x-upsert, x-supabase-api-version"
  );
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Reads `email` out of either shape a password grant can arrive in:
 * `application/x-www-form-urlencoded` (real GoTrue, an older supabase-js
 * path) or `application/json` (the path
 * `@supabase/auth-js` 2.x actually takes — issue #1101 hit this when
 * the browser-side signInWithPassword posted JSON and the form parser
 * returned null, which fell through to the default identity).
 * Unknown shapes return null so the caller falls back to its default
 * identity.
 */
function parseEmailFromPasswordBody(body: Buffer): string | null {
  const text = body.toString("utf8");
  if (!text) return null;
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { email?: unknown };
      if (typeof parsed.email === "string") return parsed.email;
    } catch {
      return null;
    }
    return null;
  }
  if (text.includes("=")) {
    const params = new URLSearchParams(text);
    return params.get("email");
  }
  return null;
}

/**
 * Decodes the mock's HS256 JWT from a `Bearer …` header and returns the
 * matching {@link MockIdentity}. The mock signs tokens with a known
 * secret and is the only place we need to crack them open — the app
 * itself trusts whatever Supabase-typed shape comes back, so we never
 * need to validate the signature here. Returns null when the header is
 * absent or the JWT is malformed.
 */
function identityFromBearerHeader(
  authorization: string | string[] | undefined
): MockIdentity | null {
  if (!authorization || typeof authorization !== "string") return null;
  const match = /^Bearer\s+([^.]+)\.([^.]+)\.([^.]+)$/.exec(authorization);
  if (!match) return null;
  try {
    const claimsJson = Buffer.from(match[2], "base64url").toString("utf8");
    const claims = JSON.parse(claimsJson) as { sub?: string; email?: string };
    if (claims.sub) {
      const found = KNOWN_IDENTITIES.find((identity) => identity.id === claims.sub);
      if (found) return found;
    }
    if (claims.email) return findIdentityByEmail(claims.email);
  } catch {
    return null;
  }
  return null;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Extracts the file part from the multipart/form-data envelope supabase-js
 * (storage-js ≥2.x) wraps Blob uploads in: fields `cacheControl` and `""`
 * (the file itself). Node's `Request.formData()` silently drops `name=""`
 * parts, so the envelope is parsed binary-safely off the raw body instead.
 * Returns null when the body is not multipart, letting callers treat the
 * request as a raw-byte upload.
 */
function unwrapMultipartFile(
  contentTypeHeader: string,
  body: Buffer
): { bytes: Buffer; contentType: string } | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
  if (!contentTypeHeader.includes("multipart/form-data") || !boundaryMatch) {
    return null;
  }
  const delimiter = Buffer.from(`--${(boundaryMatch[1] ?? boundaryMatch[2]).trim()}`);
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const next = body.indexOf(delimiter, cursor + delimiter.length);
    if (next === -1) break;
    // Each part sits between two delimiter lines: skip the \r\n after the
    // opening delimiter and trim the \r\n that precedes the next one.
    const part = body.subarray(cursor + delimiter.length + 2, next - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const partHeaders = part.subarray(0, headerEnd).toString("utf8");
      if (/name=""/.test(partHeaders)) {
        const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(partHeaders);
        return {
          bytes: Buffer.from(part.subarray(headerEnd + 4)),
          contentType: typeMatch?.[1].trim() ?? "application/octet-stream",
        };
      }
    }
    cursor = next;
  }
  return null;
}

export class MockSupabase {
  private server: Server | null = null;
  private objects = new Map<string, StoredObject>();

  /** Starts listening; resolves once the socket accepts connections. */
  start(): Promise<void> {
    this.seedStagedFixtures();
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(MOCK_SUPABASE_PORT, MOCK_SUPABASE_HOST, () => resolve());
    });
  }

  stop(): Promise<void> {
    if (!this.server) return Promise.resolve();
    return new Promise((resolve) => this.server!.close(() => resolve()));
  }

  listObjects(): StoredObject[] {
    return [...this.objects.values()];
  }

  /** Registers an object directly (used by global setup for seeded photos). */
  putObject(bucket: string, path: string, bytes: Buffer, contentType: string): void {
    this.objects.set(`${bucket}/${path}`, {
      bucket,
      path,
      bytes,
      contentType,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  reset(): void {
    this.objects.clear();
    this.seedStagedFixtures();
  }

  /** Pre-registers the fake fal.ai results so completed inpaints can render. */
  private seedStagedFixtures(): void {
    const fixtures: Array<{ name: string; bytes: Buffer }> = [
      { name: "e2e-staged.png", bytes: stagedResultFixture() },
      { name: "e2e-staged-b.png", bytes: stagedResultFixtureB() },
    ];
    for (const { name, bytes } of fixtures) {
      this.objects.set(`staged-results/${name}`, {
        bucket: "staged-results",
        path: name,
        bytes,
        contentType: "image/png",
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      cors(res);

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${MOCK_SUPABASE_HOST}`);
      const parts = url.pathname.split("/").filter(Boolean);

      // ---- GoTrue ------------------------------------------------------
      if (parts[0] === "auth" && parts[1] === "v1") {
        await this.handleAuth(req, res, url, parts);
        return;
      }

      // ---- Storage -----------------------------------------------------
      if (parts[0] === "storage" && parts[1] === "v1") {
        this.handleStorage(req, res, parts);
        return;
      }

      // ---- Test inspection ----------------------------------------------
      if (parts[0] === "__e2e") {
        if (parts[1] === "storage" && req.method === "GET") {
          // Rest-destructure omit is the mechanism for stripping `bytes`
          // from the inspection payload; `_bytes` exists only to discard
          // that field, so "unused" is a false positive here.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          json(res, 200, this.listObjects().map(({ bytes: _bytes, ...rest }) => rest));
          return;
        }
        if (parts[1] === "reset" && req.method === "POST") {
          this.reset();
          json(res, 200, { ok: true });
          return;
        }
      }

      json(res, 404, { error: "not_found", path: url.pathname });
    } catch (error) {
      json(res, 500, {
        error: "mock_failure",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleAuth(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    parts: string[]
  ): Promise<void> {
    // POST /auth/v1/token?grant_type=password|refresh_token
    if (parts[2] === "token" && req.method === "POST") {
      const grant = url.searchParams.get("grant_type");
      const body = await readBody(req);
      if (grant === "refresh_token") {
        // Refresh re-issues for whichever identity held the original
        // access_token. supabase-js sends the (still-valid) access_token
        // in the Authorization header alongside the refresh_token in
        // the form-urlencoded body, so we decode the header's JWT to
        // find the matching identity. Falls back to the default identity
        // if no Bearer token was supplied.
        const refreshed =
          identityFromBearerHeader(req.headers.authorization) ?? KNOWN_IDENTITIES[0];
        json(res, 200, mockSession(refreshed));
        return;
      }
      if (grant === "password") {
        // Issue #1101: the password grant accepts EITHER identity. The
        // request body is JSON-encoded as form-urlencoded (supabase-js),
        // so `email=` is the first lookup key. Unknown emails fall back
        // to the default identity to keep the existing helper working
        // (the helper always passes the well-known seeded email).
        const requestedEmail = parseEmailFromPasswordBody(body) ?? E2E_EMAIL;
        const identity = findIdentityByEmail(requestedEmail) ?? KNOWN_IDENTITIES[0];
        json(res, 200, mockSession(identity));
        return;
      }
      json(res, 400, { error: "unsupported_grant_type" });
      return;
    }

    // GET /auth/v1/user — middleware/server components send the Bearer JWT.
    if (parts[2] === "user" && req.method === "GET") {
      const identity = identityFromBearerHeader(req.headers.authorization)
        ?? KNOWN_IDENTITIES[0];
      json(res, 200, mockUser(identity));
      return;
    }

    // POST /auth/v1/logout
    if (parts[2] === "logout" && req.method === "POST") {
      await readBody(req);
      res.statusCode = 204;
      res.end();
      return;
    }

    json(res, 404, { error: "not_found" });
  }

  private handleStorage(
    req: IncomingMessage,
    res: ServerResponse,
    parts: string[]
  ): void {
    // parts: [storage, v1, object, <mode>, ...]
    //   public:       [object, public, <bucket>, ...<path>]
    //   upload/sign:  [object, upload, sign, <bucket>, ...<path>]
    //   plain upload: [object, <bucket>, ...<path>] (POST)
    const mode = parts[3];

    // Signed upload URL mint: the client builds `signedUrl = url + data.url`
    // and extracts the token from the query string.
    if (mode === "upload" && parts[4] === "sign" && req.method === "POST") {
      const signBucket = parts[5];
      const signPath = parts.slice(6).join("/");
      json(res, 200, {
        url: `/object/upload/sign/${signBucket}/${signPath}?token=e2e-upload-token`,
        token: "e2e-upload-token",
        Key: `${signBucket}/${signPath}`,
      });
      return;
    }

    // The signed PUT itself: capture bytes + hash for the byte-identity spec.
    if (mode === "upload" && parts[4] === "sign" && req.method === "PUT") {
      void this.handleSignedPut(req, res, parts[5], parts.slice(6).join("/"));
      return;
    }

    // Plain upload (issue #747): saveInpaintVersion uploads version-history
    // thumbnails with supabase-js `.upload()`, which services as a plain
    // POST /object/<bucket>/<path>. Blob bodies arrive wrapped in a
    // multipart/form-data envelope (unlike the browser's raw-byte PUT to
    // signed URLs above), so the handler unwraps the file part.
    if (req.method === "POST" && mode !== "upload" && mode !== "public") {
      void this.handlePlainUpload(req, res, mode, parts.slice(4).join("/"));
      return;
    }

    // Public object read (what next/image and the UI overlay fetch).
    if (mode === "public" && req.method === "GET") {
      const pubBucket = parts[4];
      const pubPath = parts.slice(5).join("/");
      const stored = this.objects.get(`${pubBucket}/${pubPath}`);
      if (!stored) {
        json(res, 404, { error: "not_found" });
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", stored.contentType);
      res.setHeader("Content-Length", stored.bytes.length);
      res.end(stored.bytes);
      return;
    }

    json(res, 404, { error: "not_found" });
  }

  private async handleSignedPut(
    req: IncomingMessage,
    res: ServerResponse,
    bucket: string,
    objectPath: string
  ): Promise<void> {
    const bytes = await readBody(req);
    const contentType = String(req.headers["content-type"] ?? "application/octet-stream");
    this.storeObject(bucket, objectPath, bytes, contentType);
    this.ackObject(res, bucket, objectPath);
  }

  /**
   * Plain-object upload body: unwrap the file part when the client sent
   * the multipart envelope supabase-js uses for Blob bodies; otherwise
   * store the raw bytes as-is.
   */
  private async handlePlainUpload(
    req: IncomingMessage,
    res: ServerResponse,
    bucket: string,
    objectPath: string
  ): Promise<void> {
    const body = await readBody(req);
    const contentTypeHeader = String(
      req.headers["content-type"] ?? "application/octet-stream"
    );
    const file = unwrapMultipartFile(contentTypeHeader, body);
    this.storeObject(bucket, objectPath, file?.bytes ?? body, file?.contentType ?? contentTypeHeader);
    this.ackObject(res, bucket, objectPath);
  }

  private storeObject(
    bucket: string,
    objectPath: string,
    bytes: Buffer,
    contentType: string
  ): void {
    this.objects.set(`${bucket}/${objectPath}`, {
      bucket,
      path: objectPath,
      bytes,
      contentType,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  /** 200 ack shaped like Supabase's `{ Key }` upload response. */
  private ackObject(res: ServerResponse, bucket: string, objectPath: string): void {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ Key: `${bucket}/${objectPath}` }));
  }
}
