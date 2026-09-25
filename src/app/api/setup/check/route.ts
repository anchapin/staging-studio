import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";

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
      // Unauthenticated — return 200 with setupComplete: false to prevent user enumeration
      return respond({ setupComplete: false });
    }
    userEmail = user.email ?? null;

    const userRow = await prisma.user.findUnique({
      where: { email: user.email },
    });

    if (!userRow) {
      // Authenticated but no Prisma User row — return 200 with setupComplete: false
      return respond({ setupComplete: false });
    }

    return respond({ setupComplete: true });
  } catch (error) {
    console.error(
      JSON.stringify({ event: "setup_check_failed", email: userEmail }),
      error
    );
    // Return 200 with setupComplete: false on error to prevent enumeration
    return respond({ setupComplete: false });
  }
}
