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

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      return respond({ exists: false }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return respond({ exists: false }, { status: 404 });
    }

    return respond({ exists: true });
  } catch {
    return respond({ exists: false }, { status: 500 });
  }
}
