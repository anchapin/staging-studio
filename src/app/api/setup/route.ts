import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_MISSING_REQUIRED_FIELDS,
  API_ERROR_INTERNAL_SERVER,
} from "@/lib/api-errors";
import { createPreflightResponse, withCors } from "@/lib/cors";
import { withNextRouteLogging } from "@/lib/api-logging";
import { trackError } from "@/lib/error-tracking";
import { componentLogger } from "@/lib/logger";

type CookieToSet = { name: string; value: string; options: CookieOptions };

const log = componentLogger("api:setup");

function makeRespond(cookiesToSet: CookieToSet[]) {
  return (body: Record<string, unknown>, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    cookiesToSet.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options)
    );
    return withCors(response);
  };
}

export async function GET(request: NextRequest) {
  return withNextRouteLogging(request, null, async () => {
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

    const respond = makeRespond(cookiesToSet);

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

      const userRow = await prisma.user.findUnique({
        where: { email: user.email },
      });

      return respond({ exists: !!userRow });
    } catch (error) {
      trackError(error, { action: "GET /api/setup", metadata: { userEmail } });
      log.error({ type: "setup_get_failed", userEmail }, "Setup GET failed");
      return respond({ exists: false }, { status: 500 });
    }
  });
}
export const OPTIONS = createPreflightResponse;

export async function POST(request: NextRequest) {
  return withNextRouteLogging(request, null, async () => {
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

    const respond = makeRespond(cookiesToSet);

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

      return respond({ success: true, user: createdUser });
    } catch (error) {
      trackError(error, { action: "POST /api/setup", metadata: { userEmail } });
      log.error({ type: "setup_post_failed", userEmail }, "Setup POST failed");
      return respond({ error: "Internal server error", message: "Failed to save user setup.", code: API_ERROR_INTERNAL_SERVER }, { status: 500 });
    }
  });
}
