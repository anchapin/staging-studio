import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_MISSING_REQUIRED_FIELDS,
  API_ERROR_INTERNAL_SERVER,
} from "@/lib/api-errors";
import { requireEnvVars } from "@/lib/env";
import {
  hashIp,
  recordFailedAttempt,
  clearRateLimit,
  checkRateLimit,
} from "@/lib/setup-rate-limit";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function GET(request: NextRequest) {
  const cookiesToSet: CookieToSet[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(set: CookieToSet[]) {
          set.forEach((cookie) => {
            request.cookies.set(cookie.name, cookie.value);
            cookiesToSet.push(cookie);
          });
        },
      },
    }
  );

  const respond = (body: Record<string, unknown>, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    cookiesToSet.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options)
    );
    return response;
  };

  // Hoisted so the catch block can correlate failures with the user even
  // when the error fires before the session is resolved.
  let userEmail: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return respond({ exists: false }, { status: 401 });
    }
    userEmail = user.email ?? null;

    // Rate limit GET as well to prevent enumeration attacks (checking
    // whether an email is already registered via timing differences).
    requireEnvVars("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const ipHashed = await hashIp(clientIp);

    const rateLimit = await checkRateLimit(ipHashed);
    if (!rateLimit.allowed) {
      return respond(
        {
          error: "Too many requests",
          message: `Rate limit exceeded. Try again after ${new Date(rateLimit.resetAt).toISOString()}.`,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
        },
        { status: 429 }
      );
    }

    const userRow = await prisma.user.findUnique({
      where: { email: user.email },
    });

    return respond({ exists: !!userRow });
  } catch (error) {
    console.error(
      JSON.stringify({ event: "setup_get_failed", email: userEmail }),
      error
    );
    return respond({ exists: false }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const cookiesToSet: CookieToSet[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(set: CookieToSet[]) {
          set.forEach((cookie) => {
            request.cookies.set(cookie.name, cookie.value);
            cookiesToSet.push(cookie);
          });
        },
      },
    }
  );

  const respond = (body: Record<string, unknown>, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    cookiesToSet.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options)
    );
    return response;
  };

  // Hoisted so the catch block can correlate failures with the user even
  // when the error fires before the session is resolved.
  let userEmail: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return respond({ error: "Unauthorized", message: "You must be signed in to complete setup.", code: API_ERROR_UNAUTHORIZED }, { status: 401 });
    }
    userEmail = user.email ?? null;

    // --- Rate limiting (brute-force protection) ---
    requireEnvVars("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const ipHashed = await hashIp(clientIp);

    const rateLimit = await recordFailedAttempt(ipHashed);
    if (!rateLimit.allowed) {
      return respond(
        {
          error: "Too many requests",
          message: `Rate limit exceeded. Try again after ${new Date(rateLimit.resetAt).toISOString()}.`,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { firmName, ownerName, logoUrl, psychologyPageContent, signoffContent } = body;

    if (!firmName || !ownerName) {
      return respond(
        { error: "Missing required fields", message: "Firm name and owner name are required.", code: API_ERROR_MISSING_REQUIRED_FIELDS },
        { status: 400 }
      );
    }

    const createdUser = await prisma.user.create({
      data: {
        firmName,
        ownerName,
        logoUrl,
        email: user.email,
        psychologyPageContent: psychologyPageContent || null,
        signoffContent: signoffContent || null,
      },
    });

    // Successful setup — clear rate-limit state so the IP starts fresh.
    await clearRateLimit(ipHashed);

    return respond({ success: true, user: createdUser });
  } catch (error) {
    console.error(
      JSON.stringify({ event: "setup_post_failed", email: userEmail }),
      error
    );
    return respond({ error: "Internal server error", message: "Failed to save user setup.", code: API_ERROR_INTERNAL_SERVER }, { status: 500 });
  }
}
